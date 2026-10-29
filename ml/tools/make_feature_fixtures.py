"""Write fixtures that pin the browser implementation to the Python one.

Outputs (ml/data/fixtures/, consumed by the frontend Node tests):
  feature_parity.json   features + 3 window variants for real clips (incl. gaps, short clips, webcam aspect)
  decision_cases.json   decision-policy cases: handcrafted edge cases + random logits
  inference_cases.json  real known-sign and unknown-sign test clips run through the published ONNX model:
                        expected logits and app decisions (checks ONNX Runtime Web gives the same answer)

Usage (from ml/): .venv/Scripts/python tools/make_feature_fixtures.py
"""

import json
import sys
from pathlib import Path

import numpy as np

ML_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ML_DIR))

from signsense_ml import data  # noqa: E402
from signsense_ml.features import (  # noqa: E402
    FEATURE_DIM,
    FEATURE_VERSION,
    WINDOW,
    Sequence,
    sequence_features,
    window_variants,
)
from signsense_ml.policy import Policy, combine, decide  # noqa: E402

OUT = ML_DIR / "data" / "fixtures"
PUBLISHED = ML_DIR.parent / "frontend" / "public" / "models" / "signs"


def drop(frames, key, every):
    """Copy of frames with `key` missing in every n-th frame (exercise gap handling)."""
    return [dict(f, **{key: None}) if i % every == 0 else f for i, f in enumerate(frames)]


def feature_cases() -> list[dict]:
    cases = []
    known = sorted(p for p in (data.INCLUDE_DIR / "landmarks").glob("*/*.json") if not p.parent.name.startswith("oov-"))
    dims = json.loads((data.INCLUDE_DIR / "video_dims.json").read_text(encoding="utf-8"))
    for path in known[:: max(1, len(known) // 3)][:3]:
        rec = json.loads(path.read_text(encoding="utf-8"))
        d = dims.get(f"{path.parent.name}/{rec['video']}")
        aspect = d["width"] / d["height"] if d else data.INCLUDE_ASPECT
        variants = {
            "as-is": rec["frames"],
            "gaps": drop(drop(drop(rec["frames"], "leftHand", 3), "pose", 5), "face", 4),
            "short-webcam-aspect": rec["frames"][: len(rec["frames"]) // 3],
        }
        for name, frames in variants.items():
            a = 4 / 3 if "webcam" in name else aspect
            seq = Sequence.from_frames(frames, aspect=a)
            cases.append({
                "name": f"{path.stem}/{name}",
                "aspect": a,
                "frames": frames,
                "expected": sequence_features(seq).round(6).ravel().tolist(),
                "expectedVariants": window_variants(seq).round(6).ravel().tolist(),
            })
    return cases


def decision_cases() -> list[dict]:
    classes = ["hello", "mother", "doctor", "unknown"]
    pol = Policy(temperature=1.5, accept=0.7, margin=0.2, suggest=0.4, unknown_label="unknown", variants=3)
    legacy = Policy.from_json(None)
    big = [8.0, 0.0, 0.0, 0.0]
    handmade = [
        ("confident and stable -> accept", [big, big, big], pol),
        ("unknown is top -> reject", [[0, 0, 0, 8.0]] * 3, pol),
        ("variants disagree -> not auto-sent", [big, [0, 8.0, 0, 0], big], pol),
        ("two close candidates (margin) -> suggest", [[4.0, 3.8, 0, 0]] * 3, pol),
        ("flat scores -> reject", [[0.1, 0.0, 0.05, 0.0]] * 3, pol),
        ("legacy policy never rejects", [[0.1, 0.0, 0.05, 0.0]] * 3, legacy),
        ("legacy policy auto-sends at 0.6", [[2.0, 0, 0, 0]] * 3, legacy),
    ]
    rng = np.random.default_rng(7)
    rand = [(f"random {i}", rng.normal(0, 2.5, size=(3, 4)).tolist(), pol) for i in range(40)]
    cases = []
    for name, logits, policy in handmade + rand:
        probs, stable = combine(np.array(logits, dtype=np.float64), policy)
        cases.append({
            "name": name,
            "classes": classes if policy.unknown_label else classes[:3] + ["other"],
            "policy": policy.to_json(),
            "logits": logits,
            "expectedProbs": probs.tolist(),
            "expectedStable": stable,
            "expectedDecision": decide(probs, stable, classes if policy.unknown_label else classes[:3] + ["other"], policy),
        })
    return cases


def inference_cases(max_known: int = 8, max_unknown: int = 4) -> dict | None:
    """Real test clips through the published model (expected logits from ONNX Runtime in Python)."""
    if not (PUBLISHED / "model.onnx").is_file():
        return None
    import onnxruntime as ort

    cfg = json.loads((PUBLISHED / "config.json").read_text(encoding="utf-8"))
    classes = cfg["classes"]
    policy = Policy.from_json(cfg.get("policy"))
    known = [s for s in data.load_include(set(classes)) if s.split == "test"]
    known = known[:: max(1, len(known) // max_known)][:max_known]
    unknown = [s for s in data.load_oov() if s.split == "test"][:max_unknown]
    sess = ort.InferenceSession(str(PUBLISHED / "model.onnx"), providers=["CPUExecutionProvider"])
    cases = []
    for s in known + unknown:
        x = window_variants(s.seq).astype(np.float32)
        logits = sess.run(["logits"], {"features": x})[0]
        probs, stable = combine(logits.astype(np.float64), policy)
        cases.append({
            "name": s.key,
            "truth": s.label,
            "features": x.round(6).ravel().tolist(),
            "expectedLogits": logits.round(5).tolist(),
            "expectedDecision": decide(probs, stable, classes, policy),
            "expectedTop": classes[int(np.argmax(probs))],
        })
    return {"model": cfg.get("runId"), "classes": classes, "policy": cfg.get("policy"), "cases": cases}


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    feats = feature_cases()
    (OUT / "feature_parity.json").write_text(
        json.dumps({"featureVersion": FEATURE_VERSION, "window": WINDOW, "featureDim": FEATURE_DIM, "cases": feats}),
        encoding="utf-8",
    )
    dec = decision_cases()
    (OUT / "decision_cases.json").write_text(json.dumps({"cases": dec}), encoding="utf-8")
    inf = inference_cases()
    if inf:
        (OUT / "inference_cases.json").write_text(json.dumps(inf), encoding="utf-8")
    print(f"{len(feats)} feature cases, {len(dec)} decision cases, {len(inf['cases']) if inf else 0} inference cases -> {OUT}")


if __name__ == "__main__":
    main()
