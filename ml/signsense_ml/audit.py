"""Automatic dataset audit: file validity, label mapping, class balance, duplicates and split leakage.

Usage (from ml/): .venv/Scripts/python -m signsense_ml.audit   -> prints a summary, writes reports/dataset_audit.json
Used by the pipeline before training; samples listed under "invalid" are excluded from training.
"""

from __future__ import annotations

import csv
import hashlib
import json
from collections import Counter, defaultdict
from pathlib import Path

import numpy as np

from . import data
from .features import WINDOW, sequence_features

REPORTS = data.ML_DIR / "reports"
MIN_FRAMES = 12  # < 0.5 s at 25 fps can't hold a sign
MIN_HAND_SHARE = 0.10  # hands found in <10% of frames: extraction failed (some real signs sit at ~20%)


def _video_ok(path: Path) -> str | None:
    """Cheap corruption check: non-empty and contains an H.264 track header."""
    if path.stat().st_size < 10_000:
        return "file too small"
    with path.open("rb") as fh:
        head = fh.read(4_000_000)
    if b"avc1" not in head and b"moov" not in head:
        return "no video track header found"
    return None


def check_samples(samples: list[data.Sample]) -> dict[str, str]:
    """key -> reason for samples that should not be used."""
    bad = {}
    for s in samples:
        n = len(s.seq.t)
        if n < MIN_FRAMES:
            bad[s.key] = f"only {n} frames"
            continue
        hands = np.isfinite(s.seq.left[:, 0, 0]) | np.isfinite(s.seq.right[:, 0, 0])
        if hands.mean() < MIN_HAND_SHARE:
            bad[s.key] = f"hands visible in only {hands.mean():.0%} of frames"
        elif not np.isfinite(s.seq.pose[:, 11, 0]).any():
            bad[s.key] = "no body pose in any frame"
    return bad


def session_leakage(samples: list[data.Sample]) -> dict:
    """How many recording sessions (camera-number runs, see data.session_of) span more than one split.

    INCLUDE has no signer IDs, but consecutive camera numbers are back-to-back takes by the same signer.
    A session present in both train and test means the test measures 'another take', not a new person.
    """
    sessions = data.session_groups(samples)
    by_session = defaultdict(set)
    for s in samples:
        by_session[sessions[s.key]].add(s.split)
    mixed = [k for k, v in by_session.items() if len(v) > 1]
    return {"sessions": len(by_session), "sessions_spanning_splits": len(mixed),
            "share": round(len(mixed) / max(len(by_session), 1), 3)}


def exact_duplicate_features(samples: list[data.Sample]) -> list[list[str]]:
    """Clips whose landmark arrays are bit-identical (same video imported twice under different names)."""
    groups = defaultdict(list)
    for s in samples:
        h = hashlib.md5(np.nan_to_num(sequence_features(s.seq), nan=0).tobytes()).hexdigest()
        groups[h].append(s.key)
    return [g for g in groups.values() if len(g) > 1]


def exact_duplicate_videos() -> list[list[str]]:
    """Byte-identical video files. MD5s are cached by (size, mtime) so re-runs don't re-read ~18 GB."""
    cache_file = data.CACHE_DIR / "video_md5.json"
    cache = json.loads(cache_file.read_text(encoding="utf-8")) if cache_file.is_file() else {}
    groups = defaultdict(list)
    for f in sorted((data.INCLUDE_DIR / "videos").glob("*/*")):
        if f.suffix.upper() not in (".MOV", ".MP4"):
            continue
        st = f.stat()
        key, stamp = f"{f.parent.name}/{f.name}", f"{st.st_size}:{int(st.st_mtime)}"
        if cache.get(key, {}).get("stamp") != stamp:
            h = hashlib.md5()
            with f.open("rb") as fh:
                for chunk in iter(lambda: fh.read(1 << 20), b""):
                    h.update(chunk)
            cache[key] = {"stamp": stamp, "md5": h.hexdigest()}
        groups[cache[key]["md5"]].append(key)
    data.CACHE_DIR.mkdir(parents=True, exist_ok=True)
    cache_file.write_text(json.dumps(cache), encoding="utf-8")
    return [g for g in groups.values() if len(g) > 1]


def run(check_videos: bool = True) -> dict:
    vocab = data.load_vocabulary()
    vocab_ids = {s["id"] for s in vocab}
    known = data.load_include(vocab_ids)
    oov = data.load_oov()
    own = data.load_own(vocab_ids)
    everything = known + oov + own

    # Label mapping: every vocabulary word exists in INCLUDE, has data and a sign clip; OOV words never overlap.
    index_words = {(r["category"], r["word"]) for r in csv.DictReader((data.INCLUDE_DIR / "index.csv").open(encoding="utf-8"))}
    mapped = {s["id"]: (s["include"]["category"], s["include"]["word"]) for s in vocab if "include" in s}
    library = json.loads((data.ML_DIR.parent / "sign-library" / "library.json").read_text(encoding="utf-8"))
    lib_ids = {s["id"] for s in library["signs"]}
    oov_manifest = json.loads(data.OOV_MANIFEST.read_text(encoding="utf-8")) if data.OOV_MANIFEST.is_file() else {}
    oov_words = {(v["category"], v["word"]) for v in oov_manifest.values()}
    per_class = Counter(s.label for s in known)

    labels = {
        "vocabulary_size": len(vocab),
        "mapped_to_include": len(mapped),
        "missing_in_include_index": sorted(i for i, k in mapped.items() if k not in index_words),
        "vocabulary_without_data": sorted(i for i in mapped if per_class[i] == 0),
        "vocabulary_without_sign_clip": sorted(i for i in mapped if i not in lib_ids),
        "sign_clips_without_vocabulary": sorted(lib_ids - vocab_ids),
        "oov_overlapping_vocabulary": sorted(f"{c}/{w}" for c, w in oov_words & set(mapped.values())),
    }

    invalid = check_samples(everything)
    by_split = defaultdict(Counter)
    for s in known:
        by_split[s.split][s.label] += 1
    counts = {split: dict(sorted(c.items())) for split, c in by_split.items()}

    landmark_versions = Counter()
    for f in (data.INCLUDE_DIR / "landmarks").glob("*/*.json"):
        with f.open(encoding="utf-8") as fh:
            head = fh.read(600)
        landmark_versions["current" if data.EXTRACTOR_VERSION in head else "other/old"] += 1

    videos_bad = {}
    if check_videos:
        for f in sorted((data.INCLUDE_DIR / "videos").glob("*/*")):
            if f.suffix.upper() in (".MOV", ".MP4"):
                problem = _video_ok(f)
                if problem:
                    videos_bad[f"{f.parent.name}/{f.name}"] = problem

    report = {
        "extractor_version": data.EXTRACTOR_VERSION,
        "samples": {
            "known_signs": len(known),
            "oov_unknown": len(oov),
            "oov_words": len({s.group for s in oov}),
            "own_recordings_usable": len(own),
        },
        "split_counts_known": {k: sum(v.values()) for k, v in counts.items()},
        "split_counts_oov": dict(Counter(s.split for s in oov)),
        "oov_words_per_split": {sp: len({s.group for s in oov if s.split == sp}) for sp in ("train", "val", "test")},
        "per_class_counts": counts,
        "class_balance": {"min": min(per_class.values()) if per_class else 0, "max": max(per_class.values()) if per_class else 0,
                          "smallest": per_class.most_common()[-3:] if per_class else []},
        "labels": labels,
        "landmark_files_by_version": dict(landmark_versions),
        "invalid_samples": invalid,
        "corrupt_videos": videos_bad,
        "exact_duplicate_videos": exact_duplicate_videos() if check_videos else "skipped",
        "exact_duplicate_landmarks": exact_duplicate_features(known + oov),
        "official_split_session_leakage": session_leakage(known),
        "signer_metadata": "not available in INCLUDE: evaluation cannot be signer-independent; 'own' split is the only unseen-signer test",
    }
    REPORTS.mkdir(parents=True, exist_ok=True)
    (REPORTS / "dataset_audit.json").write_text(json.dumps(report, indent=2), encoding="utf-8")
    return report


def summary(r: dict) -> str:
    lines = [
        f"known-sign clips {r['samples']['known_signs']} | unknown (OOV) clips {r['samples']['oov_unknown']} "
        f"from {r['samples']['oov_words']} words | own recordings usable {r['samples']['own_recordings_usable']}",
        f"known splits {r['split_counts_known']} | OOV splits {r['split_counts_oov']} (words {r['oov_words_per_split']})",
        f"class sizes min {r['class_balance']['min']} max {r['class_balance']['max']}; smallest {r['class_balance']['smallest']}",
        f"invalid samples {len(r['invalid_samples'])} | corrupt videos {len(r['corrupt_videos'])} | "
        f"exact duplicate videos {r['exact_duplicate_videos'] if isinstance(r['exact_duplicate_videos'], str) else len(r['exact_duplicate_videos'])} | "
        f"identical landmark clips {len(r['exact_duplicate_landmarks'])}",
        f"official split: {r['official_split_session_leakage']['sessions_spanning_splits']} of {r['official_split_session_leakage']['sessions']} "
        f"recording sessions span train/val/test (take-level split -> leakage)",
        f"label problems: " + ", ".join(f"{k}={v}" for k, v in r["labels"].items() if isinstance(v, list) and v) or "label problems: none",
        f"landmark files by extractor version: {r['landmark_files_by_version']}",
    ]
    return "\n".join(lines)


if __name__ == "__main__":
    print(summary(run()))
