"""Landmark sequence -> fixed-size feature tensor.

This is the contract between training (Python) and live inference (browser, TypeScript port in M6).
Any change here must be mirrored in the browser and bumps FEATURE_VERSION.

Input: per-frame landmarks as produced by frontend/lib/landmarks (schema-1): normalised image coords,
unmirrored, person's own left/right hands.

Per-frame feature vector (FEATURE_DIM = 333), all 2D:
  coordinates are first made isotropic (x * aspect), then expressed relative to the shoulder midpoint
  and divided by the shoulder width ("body frame"), so they don't depend on camera distance/position.
  [  0: 18] pose: nose, shoulders, elbows, wrists, hips (9 points x,y), body frame
  [ 18: 60] left hand 21 points, body frame              (zeros if missing)
  [ 60:102] right hand 21 points, body frame             (zeros if missing)
  [102:144] left hand relative to its wrist / hand size  (handshape; zeros if missing)
  [144:186] right hand relative to its wrist / hand size
  [186:330] face subset 72 points, body frame            (zeros if missing)
  [330:333] presence flags: left hand, right hand, face
Sequence: resampled by nearest frame to SAMPLE_FPS over WINDOW frames (3.2 s). Shorter clips are padded
by repeating the first/last frame (the signer at rest), longer ones are cropped.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np

FEATURE_VERSION = "feat-1"
SAMPLE_FPS = 15
WINDOW = 48

POSE_IDX = [0, 11, 12, 13, 14, 15, 16, 23, 24]
L_SHOULDER, R_SHOULDER = 11, 12
WRIST, MIDDLE_MCP = 0, 9
N_FACE = 72
FEATURE_DIM = len(POSE_IDX) * 2 + 21 * 2 * 4 + N_FACE * 2 + 3


@dataclass
class Sequence:
    """Raw landmarks of one clip as arrays (NaN = missing)."""

    t: np.ndarray  # [N] ms
    pose: np.ndarray  # [N, 33, 4] x, y, z, visibility
    left: np.ndarray  # [N, 21, 3]
    right: np.ndarray  # [N, 21, 3]
    face: np.ndarray  # [N, 72, 3]
    aspect: float  # video width / height

    @classmethod
    def from_frames(cls, frames: list[dict], aspect: float) -> "Sequence":
        def stack(key: str, points: int, dims: int) -> np.ndarray:
            out = np.full((len(frames), points, dims), np.nan, dtype=np.float32)
            for i, f in enumerate(frames):
                if f.get(key) is not None:
                    out[i] = np.asarray(f[key], dtype=np.float32).reshape(points, dims)
            return out

        return cls(
            t=np.asarray([f["t"] for f in frames], dtype=np.float32),
            pose=stack("pose", 33, 4),
            left=stack("leftHand", 21, 3),
            right=stack("rightHand", 21, 3),
            face=stack("face", N_FACE, 3),
            aspect=float(aspect),
        )


# Column groups of the feature vector, for ablation experiments (train.py --drop).
FEATURE_GROUPS: dict[str, list[int]] = {
    "pose": list(range(0, 18)),
    "handshape": list(range(102, 186)),
    "face": list(range(186, 330)) + [332],
}


def resample_indices(t: np.ndarray, fps: float = SAMPLE_FPS) -> np.ndarray:
    """Indices of the source frames nearest to a regular fps grid covering the clip."""
    if len(t) == 0:
        return np.zeros(0, dtype=np.int64)
    grid = np.arange(t[0], t[-1] + 1e-3, 1000.0 / fps)
    return np.abs(t[None, :] - grid[:, None]).argmin(axis=1)


def fit_window(idx: np.ndarray, window: int = WINDOW, start: int | None = None) -> np.ndarray:
    """Crop (centred unless `start` is given) or edge-pad an index list to exactly `window` entries."""
    n = len(idx)
    if n >= window:
        s = (n - window) // 2 if start is None else min(max(start, 0), n - window)
        return idx[s : s + window]
    before = (window - n) // 2 if start is None else min(max(start, 0), window - n)
    return np.concatenate([np.full(before, idx[0]), idx, np.full(window - n - before, idx[-1])])


def _body_frame(pose: np.ndarray, aspect: float) -> tuple[np.ndarray, np.ndarray]:
    """Per-frame origin [N,2] and scale [N] from the shoulders; gaps filled from the nearest valid frame."""
    ls = pose[:, L_SHOULDER, :2] * [aspect, 1.0]
    rs = pose[:, R_SHOULDER, :2] * [aspect, 1.0]
    origin = (ls + rs) / 2
    scale = np.linalg.norm(ls - rs, axis=1)
    valid = np.isfinite(scale) & (scale > 1e-4)
    if not valid.any():
        return np.tile([[aspect / 2, 0.5]], (len(pose), 1)).astype(np.float32), np.full(len(pose), 0.3, np.float32)
    good = np.flatnonzero(valid)
    nearest = good[np.abs(np.arange(len(pose))[:, None] - good[None, :]).argmin(axis=1)]
    return origin[nearest].astype(np.float32), scale[nearest].astype(np.float32)


def frame_features(seq: Sequence, idx: np.ndarray) -> np.ndarray:
    """Feature matrix [len(idx), FEATURE_DIM] for the selected frames."""
    a = seq.aspect
    origin, scale = _body_frame(seq.pose, a)
    origin, scale = origin[idx], scale[idx][:, None, None]

    def body(points: np.ndarray) -> np.ndarray:  # [n, k, >=2] -> [n, k, 2]
        xy = points[idx, :, :2] * [a, 1.0]
        return (xy - origin[:, None, :]) / scale

    def local(hand: np.ndarray) -> np.ndarray:
        xy = hand[idx, :, :2] * [a, 1.0]
        wrist = xy[:, WRIST : WRIST + 1]
        size = np.linalg.norm(xy[:, MIDDLE_MCP] - xy[:, WRIST], axis=1)[:, None, None]
        return (xy - wrist) / np.maximum(size, 1e-4)

    parts = [
        body(seq.pose[:, POSE_IDX]),
        body(seq.left),
        body(seq.right),
        local(seq.left),
        local(seq.right),
        body(seq.face),
    ]
    n = len(idx)
    feats = np.concatenate([p.reshape(n, -1) for p in parts], axis=1)
    flags = np.stack(
        [np.isfinite(seq.left[idx, 0, 0]), np.isfinite(seq.right[idx, 0, 0]), np.isfinite(seq.face[idx, 0, 0])],
        axis=1,
    ).astype(np.float32)
    feats = np.nan_to_num(feats, nan=0.0, posinf=0.0, neginf=0.0)
    return np.concatenate([feats, flags], axis=1).astype(np.float32)


N_VARIANTS = 3


def window_starts(n: int, window: int = WINDOW) -> list[int]:
    """Start offsets for the 3 test-time windows: earliest, centred, latest placement of the clip.

    For clips shorter than the window the offset is the amount of edge padding before the clip.
    Agreement between the three predictions is used as a stability check (policy.py).
    """
    span = abs(n - window)
    return [0, span // 2, span]


def window_variants(seq: Sequence) -> np.ndarray:
    """[N_VARIANTS, WINDOW, FEATURE_DIM] features of one clip at the three placements of window_starts."""
    idx = resample_indices(seq.t)
    return np.stack([frame_features(seq, fit_window(idx, start=s)) for s in window_starts(len(idx))])


def sequence_features(seq: Sequence, start: int | None = None) -> np.ndarray:
    """[WINDOW, FEATURE_DIM] features for a whole clip (centred unless `start` is given)."""
    idx = fit_window(resample_indices(seq.t), start=start)
    return frame_features(seq, idx)
