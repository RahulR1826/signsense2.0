"""Training-time augmentation on raw landmark sequences (before feature extraction)."""

from __future__ import annotations

from dataclasses import replace

import numpy as np

from .features import L_SHOULDER, R_SHOULDER, Sequence


def _affine(points: np.ndarray, aspect: float, center: np.ndarray, m: np.ndarray, shift: np.ndarray) -> np.ndarray:
    out = points.copy()
    xy = out[..., :2] * [aspect, 1.0]
    xy = (xy - center) @ m.T + center + shift
    out[..., :2] = xy / [aspect, 1.0]
    return out


def augment(seq: Sequence, rng: np.random.Generator) -> Sequence:
    a = seq.aspect
    # Spatial: small rotation / scale / anisotropic stretch / shift around the shoulders.
    ls = seq.pose[:, L_SHOULDER, :2] * [a, 1.0]
    rs = seq.pose[:, R_SHOULDER, :2] * [a, 1.0]
    center = np.nanmean((ls + rs) / 2, axis=0)
    if not np.all(np.isfinite(center)):
        center = np.array([a / 2, 0.5])
    angle = np.deg2rad(rng.uniform(-12, 12))
    scale = rng.uniform(0.85, 1.15)
    stretch = rng.uniform(0.92, 1.08)
    rot = np.array([[np.cos(angle), -np.sin(angle)], [np.sin(angle), np.cos(angle)]])
    m = rot @ np.diag([scale * stretch, scale / stretch])
    shift = rng.normal(0, 0.03, size=2)

    pose, left, right, face = (
        _affine(p, a, center, m, shift) for p in (seq.pose, seq.left, seq.right, seq.face)
    )

    # Per-landmark jitter, like detector noise.
    for p in (pose, left, right, face):
        p[..., :2] += rng.normal(0, 0.003, size=p[..., :2].shape)

    # Randomly lose a hand or the face in a few frames, like real detection dropouts.
    n = len(seq.t)
    for p, rate in ((left, 0.06), (right, 0.06), (face, 0.05)):
        p[rng.random(n) < rate] = np.nan

    # Temporal: play faster/slower.
    t = seq.t * rng.uniform(0.8, 1.25)
    return replace(seq, t=t.astype(np.float32), pose=pose, left=left, right=right, face=face)
