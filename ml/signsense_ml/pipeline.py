"""One-command, resumable ML workflow: environment -> data -> audit -> train -> evaluate -> compare -> publish -> tests.

    .venv/Scripts/python -m signsense_ml.pipeline               # run (or resume) the whole pipeline
    .venv/Scripts/python -m signsense_ml.pipeline --download    # also fetch missing INCLUDE clips first
    .venv/Scripts/python -m signsense_ml.pipeline --no-publish  # train + compare, never touch the app's model
    .venv/Scripts/python -m signsense_ml.pipeline --restart     # forget saved progress

Progress is saved after every step in ml/reports/pipeline_state.json, so an interrupted run (usage limit,
reboot, crash) continues where it stopped. Nothing here asks a person to record or label anything.

Publishing rule (decided when the first unknown-aware model replaced the original, docs/DEVELOPMENT_LOG.md):
the candidate replaces the published model only if, on the same official test clips, it
  * sends no more wrong words than the published model (known signs sent as the wrong word, and unknown
    signs sent as a word), counted together, and strictly fewer, and
  * loses at most MAX_ACC_DROP of known-sign top-1 accuracy.
Otherwise the published model is kept and the candidate stays in ml/runs/ for inspection.
"""

import argparse
import json
import platform
import re
import shutil
import subprocess
import sys
import time
import urllib.request
from pathlib import Path

ML_DIR = Path(__file__).resolve().parents[1]
REPO = ML_DIR.parent
FRONTEND = REPO / "frontend"
PUBLISHED = FRONTEND / "public" / "models" / "signs"
REPORTS = ML_DIR / "reports"
STATE_FILE = REPORTS / "pipeline_state.json"
INCLUDE = ML_DIR / "data" / "include"
VIDEO_EXT = {".mov", ".mp4"}
MAX_ACC_DROP = 0.02
STEPS = ["environment", "download", "dimensions", "landmarks", "audit", "train", "evaluate", "compare", "publish", "contract_tests"]


def log(msg: str) -> None:
    print(f"[{time.strftime('%H:%M:%S')}] {msg}", flush=True)


def run(cmd: list[str], cwd: Path = ML_DIR, check: bool = True) -> subprocess.CompletedProcess:
    log("$ " + " ".join(str(c) for c in cmd))
    proc = subprocess.run(cmd, cwd=cwd, text=True, encoding="utf-8", errors="replace", stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
    tail = proc.stdout.strip().splitlines()[-8:]
    for line in tail:
        print("    " + line)
    if check and proc.returncode != 0:
        raise RuntimeError(f"command failed ({proc.returncode}): {' '.join(map(str, cmd))}")
    return proc


def npm() -> str:
    return "npm.cmd" if platform.system() == "Windows" else "npm"


# --- steps ----------------------------------------------------------------------------------------

def step_environment(state: dict, args) -> dict:
    import numpy
    import onnx
    import onnxruntime
    import torch

    pinned = {}
    for line in (ML_DIR / "requirements.txt").read_text(encoding="utf-8").splitlines():
        m = re.match(r"^([A-Za-z0-9_.-]+)==([^\s;]+)", line.strip())
        if m:
            pinned[m.group(1).lower()] = m.group(2)
    have = {"torch": torch.__version__, "numpy": numpy.__version__, "onnx": onnx.__version__, "onnxruntime": onnxruntime.__version__}
    mismatched = {k: (v, pinned[k]) for k, v in have.items() if k in pinned and v != pinned[k]}
    if mismatched:
        log(f"WARNING: versions differ from requirements.txt: {mismatched}")
    return {"python": sys.version.split()[0], "versions": have, "mismatched": mismatched,
            "cuda": torch.cuda.is_available(), "gpu": torch.cuda.get_device_name(0) if torch.cuda.is_available() else None,
            "node": shutil.which("node") is not None}


def step_download(state: dict, args) -> dict:
    if not args.download:
        return {"skipped": "pass --download to fetch missing INCLUDE clips"}
    run([sys.executable, "tools/include_download.py", "--oov-per-word", str(args.oov_per_word), "--workers", "8"])
    return {"done": True}


def videos() -> list[Path]:
    return [p for p in (INCLUDE / "videos").glob("*/*") if p.suffix.lower() in VIDEO_EXT]


def step_dimensions(state: dict, args) -> dict:
    dims_file = INCLUDE / "video_dims.json"
    dims = json.loads(dims_file.read_text(encoding="utf-8")) if dims_file.exists() else {}
    missing = [p for p in videos() if f"{p.parent.name}/{p.name}" not in dims and p.name not in dims]
    if missing or not dims:
        run([sys.executable, "tools/include_dims.py"])
    return {"videos": len(videos()), "newly_measured": len(missing)}


def missing_landmarks() -> list[Path]:
    from signsense_ml.data import EXTRACTOR_VERSION

    out = []
    for v in videos():
        lm = INCLUDE / "landmarks" / v.parent.name / f"{v.stem}.json"
        if not lm.exists():
            out.append(v)
            continue
        with lm.open(encoding="utf-8") as f:  # the version is in the first few hundred bytes
            m = re.search(r'"extractorVersion":\s*"([^"]*)"', f.read(1024))
        if not m or m.group(1) != EXTRACTOR_VERSION:
            out.append(v)
    return out


def reachable(url: str) -> bool:
    try:
        with urllib.request.urlopen(url, timeout=5):
            return True
    except Exception:
        return False


def step_landmarks(state: dict, args) -> dict:
    todo = missing_landmarks()
    if not todo:
        return {"missing": 0}
    log(f"{len(todo)} videos need landmarks")
    if not (reachable("http://localhost:3000") and reachable("http://localhost:8000/api/health")):
        raise RuntimeError("Landmarks are extracted in the browser (same MediaPipe as the app). Start the dev servers "
                           "(frontend :3000, backend :8000 with ENABLE_DEV_TOOLS=true), then rerun this command.")
    for attempt in range(1, 6):  # the extractor is resumable; repeat until nothing is left
        run(["node", "scripts/extract-landmarks.mjs"], cwd=FRONTEND, check=False)
        todo = missing_landmarks()
        if not todo:
            return {"missing": 0, "rounds": attempt}
    raise RuntimeError(f"{len(todo)} videos still have no landmarks after 5 rounds (see the extractor output)")


def step_audit(state: dict, args) -> dict:
    from signsense_ml import audit

    report = audit.run()
    print(audit.summary(report))
    return {"report": str(REPORTS / "dataset_audit.json")}


def step_train(state: dict, args) -> dict:
    tag = f"pipeline-{time.strftime('%Y%m%d')}"
    proc = run([sys.executable, "-m", "signsense_ml.train", "--model", args.model, "--protocol", "official", "--tag", tag])
    m = re.search(r"run dir: (.+)", proc.stdout)
    if not m:
        raise RuntimeError("training finished without printing its run dir")
    return {"run_dir": m.group(1).strip()}


def step_evaluate(state: dict, args) -> dict:
    from signsense_ml.evaluate import brief, evaluate_model

    cand = Path(state["steps"]["train"]["run_dir"])
    out = {}
    for name, model_dir in [("candidate", cand), ("published", PUBLISHED)]:
        if not (model_dir / "model.onnx").exists():
            out[name] = None
            continue
        r = evaluate_model(model_dir, "official")
        (REPORTS / f"pipeline_eval_{name}.json").write_text(json.dumps(r, indent=2), encoding="utf-8")
        log(brief(r))
        out[name] = r
    return out


def wrong_words(r: dict) -> float:
    """Share of test clips that auto-send a wrong word (a known sign sent as another word, or an unknown sign sent as a word)."""
    o = r["policy_outcomes"]
    return (o["known"]["accept_wrong"] + o["unknown"].get("accept", 0)) / max(1, o["known"]["n"] + o["unknown"]["n"])


def step_compare(state: dict, args) -> dict:
    ev = state["steps"]["evaluate"]
    cand, pub = ev["candidate"], ev["published"]
    if pub is None:
        return {"publish": True, "reason": "no model is published yet"}
    acc_c = cand["known_classification"]["accuracy"]
    acc_p = pub["known_classification"]["accuracy"]
    ww_c, ww_p = wrong_words(cand), wrong_words(pub)
    reasons = []
    if ww_c >= ww_p:
        reasons.append(f"does not send fewer wrong words ({ww_c:.3f} vs {ww_p:.3f} per clip)")
    if acc_p - acc_c > MAX_ACC_DROP:
        reasons.append(f"known accuracy drops {acc_p - acc_c:.3f} (> {MAX_ACC_DROP})")
    verdict = {"publish": not reasons, "candidate_wrong_words": round(ww_c, 4), "published_wrong_words": round(ww_p, 4),
               "candidate_accuracy": acc_c, "published_accuracy": acc_p,
               "reason": "better on wrong words, accuracy within tolerance" if not reasons else "; ".join(reasons)}
    log(("PUBLISH: " if verdict["publish"] else "KEEP published model: ") + verdict["reason"])
    return verdict


def step_publish(state: dict, args) -> dict:
    if not state["steps"]["compare"]["publish"]:
        return {"published": False, "reason": "candidate did not beat the published model"}
    if args.no_publish:
        return {"published": False, "reason": "--no-publish"}
    run_dir = state["steps"]["train"]["run_dir"]
    run([sys.executable, "tools/publish_model.py", run_dir])
    run([sys.executable, "tools/make_feature_fixtures.py"])  # contract tests are tied to the published model
    return {"published": True, "run_dir": run_dir}


def step_contract_tests(state: dict, args) -> dict:
    run([sys.executable, "-m", "pytest", "-q"])
    run([npm(), "run", "test:signs"], cwd=FRONTEND)
    run([npm(), "run", "check:features"], cwd=FRONTEND)
    return {"passed": True}


# --- driver ---------------------------------------------------------------------------------------

def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--download", action="store_true", help="fetch missing INCLUDE clips (needs internet, ~18 GB total)")
    ap.add_argument("--oov-per-word", type=int, default=3)
    ap.add_argument("--model", choices=["cnn", "gru"], default="cnn")
    ap.add_argument("--no-publish", action="store_true")
    ap.add_argument("--restart", action="store_true", help="ignore saved progress")
    args = ap.parse_args()

    REPORTS.mkdir(parents=True, exist_ok=True)
    state = {"started": time.strftime("%Y-%m-%d %H:%M:%S"), "steps": {}}
    if STATE_FILE.exists() and not args.restart:
        state = json.loads(STATE_FILE.read_text(encoding="utf-8"))
        if state.get("finished"):
            log("previous pipeline run finished; starting a new one (use the report in ml/reports/)")
            state = {"started": time.strftime("%Y-%m-%d %H:%M:%S"), "steps": {}}
        elif state["steps"]:
            log(f"resuming after: {', '.join(state['steps'])}")

    for name in STEPS:
        if name in state["steps"]:
            continue
        log(f"== {name}")
        try:
            state["steps"][name] = globals()[f"step_{name}"](state, args)
        except Exception as exc:  # save progress, explain, stop; the next run resumes here
            state["failed"] = {"step": name, "error": str(exc)}
            STATE_FILE.write_text(json.dumps(state, indent=2), encoding="utf-8")
            log(f"STOPPED at {name}: {exc}")
            sys.exit(1)
        state.pop("failed", None)
        STATE_FILE.write_text(json.dumps(state, indent=2), encoding="utf-8")

    state["finished"] = time.strftime("%Y-%m-%d %H:%M:%S")
    STATE_FILE.write_text(json.dumps(state, indent=2), encoding="utf-8")
    report = REPORTS / f"pipeline_{time.strftime('%Y%m%d-%H%M%S')}.json"
    report.write_text(json.dumps(state, indent=2), encoding="utf-8")
    log(f"done -> {report}")


if __name__ == "__main__":
    main()
