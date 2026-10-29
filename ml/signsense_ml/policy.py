"""Decision policy: turn model outputs into accept / suggest / reject.

This is the contract with the browser (frontend/lib/signs/decision.ts implements the same rules and is
tested against fixtures produced here). Softmax scores are NOT probabilities of being right, so:
  1. logits are divided by a temperature fitted on validation data (calibration),
  2. the three window placements (features.window_variants) are averaged; if they disagree on the
     top class the prediction is "unstable",
  3. "unknown" (out-of-vocabulary ISL signs) as the top class -> reject,
  4. auto-send ("accept") needs a high calibrated score, a clear margin over the runner-up and stability;
     a medium score only "suggests" the top choices for the signer to confirm; anything else is rejected
     ("No supported sign detected").
Thresholds are chosen on validation data to cap the rate at which unknown signs get auto-sent.
"""

from __future__ import annotations

from dataclasses import asdict, dataclass

import numpy as np

ACCEPT, SUGGEST, REJECT = "accept", "suggest", "reject"


@dataclass
class Policy:
    temperature: float = 1.0
    accept: float = 0.6
    margin: float = 0.0
    suggest: float = 0.0
    unknown_label: str | None = None
    variants: int = 3

    def to_json(self) -> dict:
        return {
            "temperature": self.temperature,
            "acceptThreshold": self.accept,
            "minMargin": self.margin,
            "suggestThreshold": self.suggest,
            "unknownLabel": self.unknown_label,
            "windowVariants": self.variants,
        }

    @classmethod
    def from_json(cls, d: dict | None) -> "Policy":
        if not d:  # models published before calibration existed: the old 0.6-auto-send UI behaviour
            return cls(temperature=1.0, accept=0.6, margin=0.0, suggest=0.0, unknown_label=None, variants=1)
        return cls(d["temperature"], d["acceptThreshold"], d["minMargin"], d["suggestThreshold"], d.get("unknownLabel"), d.get("windowVariants", 3))


def softmax(logits: np.ndarray, temperature: float = 1.0) -> np.ndarray:
    z = logits / temperature
    z = z - z.max(axis=-1, keepdims=True)
    e = np.exp(z)
    return e / e.sum(axis=-1, keepdims=True)


def combine(variant_logits: np.ndarray, policy: Policy) -> tuple[np.ndarray, bool]:
    """[V, C] logits of one clip -> (mean calibrated probabilities [C], all variants agree on the top class)."""
    v = variant_logits[: policy.variants]
    probs = softmax(v, policy.temperature)
    return probs.mean(axis=0), bool(len(set(probs.argmax(axis=1).tolist())) == 1)


def decide(probs: np.ndarray, stable: bool, classes: list[str], policy: Policy) -> str:
    order = np.argsort(-probs)
    top, p1 = order[0], float(probs[order[0]])
    p2 = float(probs[order[1]]) if len(order) > 1 else 0.0
    if policy.unknown_label is not None and classes[top] == policy.unknown_label:
        return REJECT
    if p1 >= policy.accept and p1 - p2 >= policy.margin and stable:
        return ACCEPT
    if p1 >= policy.suggest:
        return SUGGEST
    return REJECT


def fit_temperature(logits: np.ndarray, y: np.ndarray) -> float:
    """Temperature minimising validation negative log-likelihood (grid search; robust on small sets)."""
    best_t, best_nll = 1.0, np.inf
    for t in np.exp(np.linspace(np.log(0.3), np.log(10.0), 200)):
        p = softmax(logits, t)
        nll = -np.log(np.clip(p[np.arange(len(y)), y], 1e-12, 1)).mean()
        if nll < best_nll:
            best_t, best_nll = float(t), nll
    return best_t


def outcomes(probs: np.ndarray, stable: np.ndarray, y: np.ndarray, is_unknown: np.ndarray, classes: list[str], policy: Policy) -> dict:
    """Policy outcomes for known-sign clips and unknown (out-of-vocabulary) clips."""
    known_idx = [i for i, c in enumerate(classes) if c != policy.unknown_label]
    res = {"known": {"n": 0, "accept_correct": 0, "accept_wrong": 0, "suggest_contains_true": 0, "suggest_without_true": 0, "reject": 0},
           "unknown": {"n": 0, "accept": 0, "suggest": 0, "reject": 0}}
    for p, st, yi, unk in zip(probs, stable, y, is_unknown):
        d = decide(p, bool(st), classes, policy)
        if unk:
            res["unknown"]["n"] += 1
            res["unknown"][d] += 1
            continue
        res["known"]["n"] += 1
        pred = int(np.argmax(p))
        if d == ACCEPT:
            res["known"]["accept_correct" if pred == yi else "accept_wrong"] += 1
        elif d == SUGGEST:
            top3 = [k for k in np.argsort(-p) if k in known_idx][:3]
            res["known"]["suggest_contains_true" if yi in top3 else "suggest_without_true"] += 1
        else:
            res["known"]["reject"] += 1
    k, u = res["known"], res["unknown"]
    accepted = k["accept_correct"] + k["accept_wrong"]
    res["rates"] = {
        "known_auto_sent_correct": k["accept_correct"] / max(k["n"], 1),
        "known_auto_sent_wrong": k["accept_wrong"] / max(k["n"], 1),
        "auto_send_precision": k["accept_correct"] / max(accepted, 1),
        "known_needs_confirmation": (k["suggest_contains_true"] + k["suggest_without_true"]) / max(k["n"], 1),
        "known_rejected": k["reject"] / max(k["n"], 1),
        "unknown_false_acceptance": u["accept"] / max(u["n"], 1) if u["n"] else None,
        "unknown_shown_as_suggestion": u["suggest"] / max(u["n"], 1) if u["n"] else None,
        "unknown_rejected": u["reject"] / max(u["n"], 1) if u["n"] else None,
    }
    return res


# Project rule: a sign is only ever sent automatically at >= 95% calibrated confidence (plus whole-clip agreement).
# Threshold tuning may make this stricter, never looser.
MIN_ACCEPT = 0.95


def select_policy(probs_logits: list[np.ndarray], y: np.ndarray, is_unknown: np.ndarray, classes: list[str],
                  temperature: float, unknown_label: str | None, max_far: float = 0.02, max_suggest_far: float = 0.25,
                  min_precision: float = 0.97) -> tuple[Policy, dict]:
    """Choose accept / margin / suggest thresholds on validation data.

    accept+margin: (accept >= MIN_ACCEPT) the highest share of correctly auto-sent known signs such that at most `max_far` of
    unknown clips and at most 1-`min_precision` of auto-sent known signs are wrong.
    suggest: the lowest score that keeps unknown clips shown as suggestions under `max_suggest_far`.
    """
    base = Policy(temperature=temperature, unknown_label=unknown_label)
    combined = [combine(v, base) for v in probs_logits]
    probs = np.stack([c[0] for c in combined])
    stable = np.array([c[1] for c in combined])
    best, best_cov = None, -1.0
    for accept in np.arange(MIN_ACCEPT, 0.991, 0.01):
        for margin in (0.0, 0.1, 0.2, 0.3, 0.4):
            pol = Policy(temperature, float(round(accept, 2)), margin, 1.01, unknown_label)
            r = outcomes(probs, stable, y, is_unknown, classes, pol)["rates"]
            far = r["unknown_false_acceptance"] or 0.0
            if far <= max_far and r["auto_send_precision"] >= min_precision and r["known_auto_sent_correct"] > best_cov:
                best, best_cov = pol, r["known_auto_sent_correct"]
    if best is None:  # nothing meets the targets: never auto-send
        best = Policy(temperature, 1.01, 0.0, 1.01, unknown_label)
    for suggest in np.arange(0.05, best.accept + 1e-9, 0.01):
        pol = Policy(temperature, best.accept, best.margin, float(round(suggest, 2)), unknown_label)
        r = outcomes(probs, stable, y, is_unknown, classes, pol)["rates"]
        if (r["unknown_shown_as_suggestion"] or 0.0) + (r["unknown_false_acceptance"] or 0.0) <= max_suggest_far:
            best = pol
            break
    return best, outcomes(probs, stable, y, is_unknown, classes, best)


def as_dict(p: Policy) -> dict:
    return asdict(p)
