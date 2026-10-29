import numpy as np

from signsense_ml.augment import augment
from signsense_ml.features import FEATURE_DIM, WINDOW, Sequence, fit_window, resample_indices, sequence_features


def make_frames(n=70, fps=25, left=True, right=True, seed=0):
    rng = np.random.default_rng(seed)
    frames = []
    for i in range(n):
        pose = np.zeros((33, 4))
        pose[:, :2] = rng.uniform(0.3, 0.7, size=(33, 2))
        pose[:, 3] = 1.0
        pose[11, :2] = [0.55, 0.5]  # person's left shoulder (appears on image right)
        pose[12, :2] = [0.45, 0.5]
        frames.append({
            "t": i * 1000 / fps,
            "pose": pose.ravel().tolist(),
            "leftHand": rng.uniform(0.4, 0.6, size=63).tolist() if left else None,
            "rightHand": rng.uniform(0.4, 0.6, size=63).tolist() if right else None,
            "face": rng.uniform(0.45, 0.55, size=216).tolist(),
        })
    return frames


def transform(frames, scale, dx, dy):
    """Simulate the same person closer/further and elsewhere in the frame."""
    out = []
    for f in frames:
        g = dict(f)
        for key, stride in (("pose", 4), ("leftHand", 3), ("rightHand", 3), ("face", 3)):
            if f[key] is None:
                continue
            a = np.asarray(f[key]).reshape(-1, stride).copy()
            a[:, 0] = (a[:, 0] - 0.5) * scale + 0.5 + dx
            a[:, 1] = (a[:, 1] - 0.5) * scale + 0.5 + dy
            g[key] = a.ravel().tolist()
        out.append(g)
    return out


def test_shape_and_dim():
    x = sequence_features(Sequence.from_frames(make_frames(), aspect=16 / 9))
    assert x.shape == (WINDOW, FEATURE_DIM)
    assert np.isfinite(x).all()


def test_invariant_to_camera_distance_and_position():
    frames = make_frames()
    a = sequence_features(Sequence.from_frames(frames, aspect=4 / 3))
    b = sequence_features(Sequence.from_frames(transform(frames, scale=0.6, dx=0.1, dy=-0.05), aspect=4 / 3))
    np.testing.assert_allclose(a, b, atol=1e-4)


def test_missing_hand_is_zero_with_flag_off():
    x = sequence_features(Sequence.from_frames(make_frames(left=False), aspect=4 / 3))
    assert np.all(x[:, 18:60] == 0) and np.all(x[:, 102:144] == 0)
    assert np.all(x[:, 330] == 0) and np.all(x[:, 331] == 1) and np.all(x[:, 332] == 1)


def test_resample_25fps_to_15fps():
    t = np.arange(70) * 40.0  # 2.8 s at 25 fps
    idx = resample_indices(t)
    assert abs(len(idx) - 42) <= 1
    assert np.all(np.diff(idx) >= 0)


def test_fit_window_pads_with_edge_frames_and_crops_centre():
    short = fit_window(np.arange(10), window=16)
    assert len(short) == 16 and short[0] == 0 and short[-1] == 9
    long = fit_window(np.arange(100), window=16)
    assert list(long) == list(range(42, 58))


def test_augment_keeps_shapes_and_missing_values():
    seq = Sequence.from_frames(make_frames(right=False), aspect=16 / 9)
    out = augment(seq, np.random.default_rng(1))
    assert out.pose.shape == seq.pose.shape
    assert np.isnan(out.right).all()
    assert sequence_features(out).shape == (WINDOW, FEATURE_DIM)
