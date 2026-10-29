"""Evaluate any exported model (a run folder or the published app model) under one protocol.

Usage (from ml/):
  .venv/Scripts/python -m signsense_ml.evaluate --model ../frontend/public/models/signs
  .venv/Scripts/python -m signsense_ml.evaluate --model runs/<run> --protocol session

Reports classification quality on known signs AND what the app would actually do with each clip under the
model's decision policy (auto-send / ask the signer / reject), including how often signs outside the
vocabulary (INCLUDE words never used in training) would be auto-sent as a supported sign.
"""

from __future__ import annotations

import argparse
import json
import time
from pathlib import Path

import numpy as np

from . import data
from .features import window_variants
from .policy import Policy, combine, outcomes
from .report import evaluate as classification_report

PROTOCOLS = ("official", "session")


def load_eval_sets(protocol: str, classes: list[str]) -> tuple[list[data.Sample], list[data.Sample]]:
    """(known-sign test clips, out-of-vocabulary test clips) for a protocol.

    official: INCLUDE's take-level split (comparable with the paper; leaks sessions, see audit).
    session:  whole recording sessions held out (data.session_split) — stricter.
    OOV test words are word-disjoint from OOV training words in both protocols.
    """
    known_ids = {c for c in classes if c != data.UNKNOWN}
    known = [s for s in data.load_include(known_ids)]
    if protocol == "session":
        split = data.session_split(known)
        for s in known:
            s.split = split[s.key]
    oov = [s for s in data.load_oov() if s.split == "test"]
    return [s for s in known if s.split == "test"], oov


def run_model(model_dir: Path, samples: list[data.Sample]) -> np.ndarray:
    """[N, V, C] logits for the three window variants of every clip (ONNX Runtime, CPU)."""
    import onnxruntime as ort

    sess = ort.InferenceSession(str(model_dir / "model.onnx"), providers=["CPUExecutionProvider"])
    if not samples:
        return np.zeros((0, 3, len(json.loads((model_dir / "config.json").read_text())["classes"])), np.float32)
    x = np.stack([window_variants(s.seq) for s in samples])  # [N, V, W, F]
    n, v = x.shape[:2]
    logits = sess.run(["logits"], {"features": x.reshape(n * v, *x.shape[2:]).astype(np.float32)})[0]
    return logits.reshape(n, v, -1)


def latency_ms(model_dir: Path, repeats: int = 50) -> float:
    import onnxruntime as ort

    so = ort.SessionOptions()
    so.intra_op_num_threads = 1
    sess = ort.InferenceSession(str(model_dir / "model.onnx"), so, providers=["CPUExecutionProvider"])
    cfg = json.loads((model_dir / "config.json").read_text())
    x = np.random.default_rng(0).standard_normal((3, cfg["window"], cfg["featureDim"])).astype(np.float32)
    for _ in range(5):
        sess.run(None, {"features": x})
    t0 = time.perf_counter()
    for _ in range(repeats):
        sess.run(None, {"features": x})
    return (time.perf_counter() - t0) / repeats * 1000


def evaluate_model(model_dir: Path, protocol: str = "official") -> dict:
    cfg = json.loads((model_dir / "config.json").read_text(encoding="utf-8"))
    classes: list[str] = cfg["classes"]
    policy = Policy.from_json(cfg.get("policy"))
    known, oov = load_eval_sets(protocol, classes)
    logits = run_model(model_dir, known + oov)
    combined = [combine(l, policy) for l in logits]
    probs = np.stack([c[0] for c in combined]) if combined else np.zeros((0, len(classes)))
    stable = np.array([c[1] for c in combined])
    unknown_idx = classes.index(policy.unknown_label) if policy.unknown_label in classes else -1
    y = np.array([classes.index(s.label) for s in known] + [unknown_idx] * len(oov))
    is_unknown = np.array([False] * len(known) + [True] * len(oov))

    # Classification quality among the supported signs only (unknown column removed).
    known_cols = [i for i, c in enumerate(classes) if c != policy.unknown_label]
    kp = probs[: len(known)][:, known_cols]
    ky = np.array([known_cols.index(i) for i in y[: len(known)]])
    known_classes = [classes[i] for i in known_cols]
    result = {
        "model": cfg.get("runId") or model_dir.name,
        "protocol": protocol,
        "classes": len(classes),
        "has_unknown_class": unknown_idx >= 0,
        "policy": policy.to_json(),
        "n_known_test": len(known),
        "n_unknown_test": len(oov),
        "n_unknown_test_words": len({s.group for s in oov}),
        "known_classification": classification_report(kp, ky, known_classes) if len(known) else None,
        "policy_outcomes": outcomes(probs, stable, y, is_unknown, classes, policy),
        "latency_ms_per_decision_cpu1": round(latency_ms(model_dir), 2),
        "model_size_mb": round((model_dir / "model.onnx").stat().st_size / 1e6, 2),
    }
    return result


def brief(r: dict) -> str:
    kc = r["known_classification"] or {}
    rates = r["policy_outcomes"]["rates"]
    far = rates["unknown_false_acceptance"]
    return (
        f"{r['model']} [{r['protocol']}] known n={r['n_known_test']}: acc {kc.get('accuracy', 0):.3f} macro-F1 {kc.get('macro_f1', 0):.3f} | "
        f"auto-sent correct {rates['known_auto_sent_correct']:.2f}, wrong {rates['known_auto_sent_wrong']:.2f}, "
        f"ask {rates['known_needs_confirmation']:.2f}, rejected {rates['known_rejected']:.2f} | "
        f"unknown n={r['n_unknown_test']} ({r['n_unknown_test_words']} words): auto-sent {('%.2f' % far) if far is not None else 'n/a'} | "
        f"{r['latency_ms_per_decision_cpu1']} ms, {r['model_size_mb']} MB"
    )


def main() -> None:
    p = argparse.ArgumentParser()
    p.add_argument("--model", default=str(data.ML_DIR.parent / "frontend" / "public" / "models" / "signs"))
    p.add_argument("--protocol", choices=PROTOCOLS, default="official")
    p.add_argument("--out", help="write the full result JSON here")
    a = p.parse_args()
    r = evaluate_model(Path(a.model), a.protocol)
    if a.out:
        Path(a.out).write_text(json.dumps(r, indent=2), encoding="utf-8")
    print(brief(r))


if __name__ == "__main__":
    main()
