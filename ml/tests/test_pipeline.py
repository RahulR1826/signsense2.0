from signsense_ml import pipeline


def result(acc, known_wrong, unknown_accept, n_known=100, n_unknown=100):
    return {
        "known_classification": {"accuracy": acc},
        "policy_outcomes": {"known": {"n": n_known, "accept_wrong": known_wrong}, "unknown": {"n": n_unknown, "accept": unknown_accept}},
    }


def compare(cand, pub):
    return pipeline.step_compare({"steps": {"evaluate": {"candidate": cand, "published": pub}}}, None)


def test_publishes_when_fewer_wrong_words_and_small_accuracy_drop():
    assert compare(result(0.97, 0, 5), result(0.98, 2, 55))["publish"]


def test_keeps_published_when_accuracy_drops_too_much():
    v = compare(result(0.90, 0, 5), result(0.98, 2, 55))
    assert not v["publish"] and "accuracy" in v["reason"]


def test_keeps_published_when_not_fewer_wrong_words():
    v = compare(result(0.99, 3, 10), result(0.98, 3, 10))
    assert not v["publish"] and "wrong words" in v["reason"]


def test_publishes_first_model():
    assert compare(result(0.5, 10, 10), None)["publish"]


def test_wrong_words_counts_both_kinds():
    assert pipeline.wrong_words(result(0.9, 2, 8)) == 10 / 200


def test_policy_never_auto_sends_below_95_percent():
    """Threshold tuning may only make auto-send stricter than the project's 95% rule."""
    import numpy as np

    from signsense_ml.policy import MIN_ACCEPT, select_policy

    rng = np.random.default_rng(0)
    classes = ["a", "b", "unknown"]
    # Easy data where a low threshold would maximise coverage: the tuner must still stay >= 0.95.
    logits = [rng.normal(0, 0.3, (3, 3)) + np.array([2.0, 0, 0]) for _ in range(40)]
    y = np.zeros(40, dtype=int)
    policy, _ = select_policy(logits, y, np.zeros(40, dtype=bool), classes, 1.0, "unknown")
    assert MIN_ACCEPT == 0.95
    assert policy.accept >= 0.95
