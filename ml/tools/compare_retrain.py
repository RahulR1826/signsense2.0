"""Milestone 1: compare the published model with the candidates retrained on all 931 OOV training clips.

Same evaluator (signsense_ml.evaluate), same test clips, same decision policy rules (each model's own calibrated
temperature; accept threshold 0.95 + all-window agreement, unchanged). Two protocols:
  official: INCLUDE's take-level test split (121 known clips) + 141 clips of 47 unseen OOV words;
  session:  whole recording sessions held out (110 known clips) + the same OOV test words — the honest one.
Writes reports/retrain_comparison.json and prints a summary table.

Usage (from ml/): .venv/Scripts/python tools/compare_retrain.py
"""

import json
import statistics
import sys
from pathlib import Path

ML_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ML_DIR))

from signsense_ml.evaluate import evaluate_model  # noqa: E402

PUBLISHED = ML_DIR.parent / "frontend" / "public" / "models" / "signs"
PUBLISHED_SESSION_TWIN = ML_DIR / "runs" / "20261021-002954-cnn-session"  # published settings, session split


def summary(r: dict) -> dict:
    k, u, rates = r["policy_outcomes"]["known"], r["policy_outcomes"]["unknown"], r["policy_outcomes"]["rates"]
    return {
        "known_n": k["n"],
        "accuracy": r["known_classification"]["accuracy"],
        "macro_f1": r["known_classification"]["macro_f1"],
        "auto_sent_correct": rates["known_auto_sent_correct"],
        "auto_sent_wrong": rates["known_auto_sent_wrong"],
        "needs_confirmation": rates["known_needs_confirmation"],
        "known_rejected": rates["known_rejected"],  # false rejection of a supported sign
        "unknown_n": u["n"],
        "unknown_auto_sent": rates["unknown_false_acceptance"],
        "unknown_suggested": rates["unknown_shown_as_suggestion"],
        "unknown_rejected": rates["unknown_rejected"],
        "mean_conf_correct": r["known_classification"].get("mean_confidence_correct"),
        "mean_conf_wrong": r["known_classification"].get("mean_confidence_wrong"),
        "latency_ms": r["latency_ms_per_decision_cpu1"],
        "size_mb": r["model_size_mb"],
    }


def per_class(r: dict) -> dict:
    return {c: round(v["recall"], 3) for c, v in r["known_classification"]["per_class"].items()}


def mean_sd(rows: list[dict], key: str) -> str:
    vals = [x[key] for x in rows]
    return f"{statistics.mean(vals):.3f} ± {statistics.pstdev(vals):.3f}" if len(vals) > 1 else f"{vals[0]:.3f}"


def main() -> None:
    out = {"published": {}, "candidates": {}}
    pub_off = evaluate_model(PUBLISHED, "official")
    pub_ses = evaluate_model(PUBLISHED_SESSION_TWIN, "session")
    out["published"] = {
        "official": summary(pub_off), "session": summary(pub_ses),
        "per_class_official": per_class(pub_off), "per_class_session": per_class(pub_ses),
    }
    for variant in ("all", "nogift"):
        runs_off = sorted(ML_DIR.glob(f"runs/*-oov931-{variant}-s[0-9]"))
        runs_ses = sorted(ML_DIR.glob(f"runs/*-oov931-{variant}-session-s0"))
        off = [evaluate_model(d, "official") for d in runs_off if (d / "model.onnx").exists()]
        ses = [evaluate_model(d, "session") for d in runs_ses if (d / "model.onnx").exists()]
        out["candidates"][variant] = {
            "runs_official": [d.name for d in runs_off], "runs_session": [d.name for d in runs_ses],
            "official": [summary(r) for r in off], "session": [summary(r) for r in ses],
            "per_class_official": [per_class(r) for r in off], "per_class_session": [per_class(r) for r in ses],
        }
    (ML_DIR / "reports" / "retrain_comparison.json").write_text(json.dumps(out, indent=2), encoding="utf-8")

    keys = ["accuracy", "auto_sent_correct", "auto_sent_wrong", "needs_confirmation", "known_rejected", "unknown_auto_sent", "unknown_suggested", "latency_ms", "size_mb"]
    print(f"{'model':28} {'protocol':9} " + " ".join(f"{k[:12]:>16}" for k in keys))
    for proto in ("official", "session"):
        print(f"{'published':28} {proto:9} " + " ".join(f"{out['published'][proto][k]:16.3f}" for k in keys))
        for variant, c in out["candidates"].items():
            if c[proto]:
                print(f"{'oov931-' + variant + f' (n={len(c[proto])})':28} {proto:9} " + " ".join(f"{mean_sd(c[proto], k):>16}" for k in keys))


if __name__ == "__main__":
    main()
