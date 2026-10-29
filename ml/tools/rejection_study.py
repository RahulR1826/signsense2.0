"""Can unknown signs be auto-sent less often without lowering any safeguard?

Takes the published model and its policy as they are, and tests extra gates that may only DOWNGRADE an
automatic send to "ask the signer" (never upgrade anything):

  G1 min-placement  every one of the 3 window placements gives the top class >= t
  G2 unknown-mass   the calibrated probability of "unknown" is <= t
  G3 energy         logsumexp of the mean known-class logits >= t (low energy = unlike training data)
  G4 per-class      the accept threshold is raised for classes that unknown validation clips get mistaken for

Every threshold is chosen on VALIDATION clips only (known val + word-disjoint OOV val), with the rule
"keep >= 98% of the correct automatic sends on validation, then remove as many unknown auto-sends as
possible". The official TEST set (121 known, 141 unknown clips from 47 unseen words) is scored once at the end.

Usage (from ml/): .venv/Scripts/python tools/rejection_study.py
Writes ml/reports/rejection_study.json.
"""

import json
import sys
from pathlib import Path

import numpy as np

ML = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ML))

from signsense_ml import data  # noqa: E402
from signsense_ml.evaluate import run_model  # noqa: E402
from signsense_ml.policy import Policy, combine, decide, softmax  # noqa: E402

MODEL = ML.parent / "frontend" / "public" / "models" / "signs"
KEEP = 0.98  # share of validation correct auto-sends a gate must keep


def load_sets(classes: list[str]):
    known_ids = {c for c in classes if c != data.UNKNOWN}
    known = data.load_include(known_ids)
    oov = data.load_oov()
    pick = lambda xs, split: [s for s in xs if s.split == split]  # noqa: E731
    return {split: (pick(known, split), pick(oov, split)) for split in ("val", "test")}


def per_clip(logits: np.ndarray, classes: list[str], policy: Policy):
    """For each clip: base decision, top class, and the statistics the gates use."""
    unk = classes.index(policy.unknown_label)
    known_cols = [i for i in range(len(classes)) if i != unk]
    rows = []
    for lv in logits:  # [V, C]
        probs, stable = combine(lv, policy)
        top = int(np.argmax(probs))
        pv = np.stack([softmax(l, policy.temperature) for l in lv[: policy.variants]])
        mean_logits = lv[: policy.variants].mean(0) / policy.temperature
        known_logits = mean_logits[known_cols]
        energy = float(np.log(np.exp(known_logits - known_logits.max()).sum()) + known_logits.max())
        rows.append(
            {
                "decision": decide(probs, stable, classes, policy),
                "top": classes[top],
                "min_placement": float(pv[:, top].min()),
                "unknown_mass": float(probs[unk]),
                "energy": energy,
                "p_top": float(probs[top]),
            }
        )
    return rows


def outcome(rows, labels, is_unknown, gate):
    """Counts after applying `gate(row) -> bool` (False = downgrade an accept to 'ask')."""
    c = {"known_auto_correct": 0, "known_auto_wrong": 0, "known_ask": 0, "known_reject": 0, "unknown_auto": 0, "unknown_ask": 0, "unknown_reject": 0, "downgraded": 0}
    for r, y, unk in zip(rows, labels, is_unknown):
        d = r["decision"]
        if d == "accept" and not gate(r):
            d = "suggest"
            c["downgraded"] += 1
        if unk:
            c[{"accept": "unknown_auto", "suggest": "unknown_ask", "reject": "unknown_reject"}[d]] += 1
        elif d == "accept":
            c["known_auto_correct" if r["top"] == y else "known_auto_wrong"] += 1
        else:
            c["known_ask" if d == "suggest" else "known_reject"] += 1
    return c


def choose(rows, labels, is_unknown, make_gate, candidates):
    """Threshold that keeps >= KEEP of validation correct auto-sends and removes the most unknown auto-sends."""
    base = outcome(rows, labels, is_unknown, lambda r: True)
    best = (None, base)
    for t in candidates:
        o = outcome(rows, labels, is_unknown, make_gate(t))
        if o["known_auto_correct"] < KEEP * base["known_auto_correct"]:
            continue
        if o["unknown_auto"] < best[1]["unknown_auto"] or (o["unknown_auto"] == best[1]["unknown_auto"] and best[0] is not None and o["known_auto_correct"] > best[1]["known_auto_correct"]):
            best = (t, o)
    return best


def main() -> None:
    cfg = json.loads((MODEL / "config.json").read_text(encoding="utf-8"))
    classes = cfg["classes"]
    policy = Policy.from_json(cfg["policy"])
    sets = load_sets(classes)
    res = {}
    for split, (known, oov) in sets.items():
        logits = run_model(MODEL, known + oov)
        res[split] = {
            "rows": per_clip(logits, classes, policy),
            "labels": [s.label for s in known] + [data.UNKNOWN] * len(oov),
            "is_unknown": [False] * len(known) + [True] * len(oov),
            "n_known": len(known),
            "n_unknown": len(oov),
            "unknown_words": len({s.group for s in oov}),
        }
    v, t = res["val"], res["test"]
    V = (v["rows"], v["labels"], v["is_unknown"])
    T = (t["rows"], t["labels"], t["is_unknown"])

    report = {
        "model": cfg.get("runId"),
        "policy": cfg["policy"],
        "val": {"known": v["n_known"], "unknown": v["n_unknown"], "unknown_words": v["unknown_words"]},
        "test": {"known": t["n_known"], "unknown": t["n_unknown"], "unknown_words": t["unknown_words"]},
        "keep_rule": f">= {KEEP:.0%} of validation correct auto-sends kept",
        "results": {},
    }
    report["results"]["published (no extra gate)"] = {"threshold": None, "val": outcome(*V, lambda r: True), "test": outcome(*T, lambda r: True)}

    gates = {
        "G1 min-placement": (lambda th: (lambda r: r["min_placement"] >= th), np.round(np.arange(0.5, 1.0, 0.01), 3)),
        "G2 unknown-mass": (lambda th: (lambda r: r["unknown_mass"] <= th), np.round(np.arange(0.001, 0.1, 0.002), 4)),
        "G3 energy": (lambda th: (lambda r: r["energy"] >= th), np.round(np.linspace(min(r["energy"] for r in v["rows"]), max(r["energy"] for r in v["rows"]), 80), 3)),
    }
    for name, (make, cands) in gates.items():
        th, val_o = choose(*V, make, cands)
        report["results"][name] = {"threshold": None if th is None else float(th), "val": val_o, "test": outcome(*T, make(th) if th is not None else (lambda r: True))}

    # G4: per-class raised threshold = just above the highest unknown validation clip accepted as that class.
    raise_to = {}
    for r, unk in zip(v["rows"], v["is_unknown"]):
        if unk and r["decision"] == "accept":
            raise_to[r["top"]] = max(raise_to.get(r["top"], 0), r["p_top"] + 1e-4)
    g4 = lambda r: r["p_top"] >= raise_to.get(r["top"], 0)  # noqa: E731
    val_o = outcome(*V, g4)
    base_val = report["results"]["published (no extra gate)"]["val"]
    ok = val_o["known_auto_correct"] >= KEEP * base_val["known_auto_correct"]
    report["results"]["G4 per-class"] = {
        "threshold": {k: round(x, 4) for k, x in raise_to.items()},
        "passes_keep_rule_on_val": ok,
        "val": val_o,
        "test": outcome(*T, g4),
    }

    # Which classes do the test-set false accepts land on (published policy)?
    fa = {}
    for r, unk in zip(t["rows"], t["is_unknown"]):
        if unk and r["decision"] == "accept":
            fa[r["top"]] = fa.get(r["top"], 0) + 1
    report["test_false_accepts_by_predicted_class"] = dict(sorted(fa.items(), key=lambda kv: -kv[1]))

    out = ML / "reports" / "rejection_study.json"
    out.parent.mkdir(exist_ok=True)
    out.write_text(json.dumps(report, indent=2), encoding="utf-8")

    print(f"model {report['model']} | val: {v['n_known']} known, {v['n_unknown']} unknown ({v['unknown_words']} words) | test: {t['n_known']} known, {t['n_unknown']} unknown ({t['unknown_words']} words)")
    print(f"{'rule':28} {'thr':>10} | VAL unk-auto  known-auto | TEST unk-auto  known-auto  wrong  ask  reject")
    for name, r in report["results"].items():
        thr = r["threshold"]
        thr_s = "-" if thr is None else ("per-class" if isinstance(thr, dict) else f"{thr:.4g}")
        vo, to = r["val"], r["test"]
        print(
            f"{name:28} {thr_s:>10} | {vo['unknown_auto']:>4}/{v['n_unknown']:<4} {vo['known_auto_correct']:>4}/{v['n_known']:<4}"
            f" | {to['unknown_auto']:>4}/{t['n_unknown']:<4} {to['known_auto_correct']:>5}/{t['n_known']:<4} {to['known_auto_wrong']:>4} {to['known_ask']:>4} {to['known_reject']:>5}"
        )
    print("test false accepts by predicted class:", report["test_false_accepts_by_predicted_class"])


if __name__ == "__main__":
    main()
