"""Saathi motion builder (tools/build_sign_animations.py): gap filling and smoothing."""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "tools"))

from build_sign_animations import MAX_GAP, hold_ends, interp_gaps, smooth  # noqa: E402


def test_short_gaps_are_interpolated():
    track = [[0.0], None, None, [3.0]]
    assert interp_gaps(track) == [[0.0], [1.0], [2.0], [3.0]]


def test_long_gaps_and_open_ends_stay_empty():
    long_gap = [[0.0]] + [None] * (MAX_GAP + 1) + [[1.0]]
    assert interp_gaps(long_gap)[1:-1] == [None] * (MAX_GAP + 1)
    assert interp_gaps([None, [1.0], None]) == [None, [1.0], None]


def test_smoothing_keeps_constants_and_gaps():
    track = [[2.0], [2.0], None, [2.0], [2.0]]
    assert smooth(track) == [[2.0], [2.0], None, [2.0], [2.0]]
    out = smooth([[0.0], [0.0], [9.0], [0.0], [0.0]])
    assert 0 < out[2][0] < 9.0  # a one-frame spike is damped


def test_hold_ends_fills_from_nearest_value():
    assert hold_ends([None, [1.0], None, None, [5.0], None]) == [[1.0], [1.0], [1.0], [5.0], [5.0], [5.0]]
