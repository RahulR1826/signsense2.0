"""Load landmark clips (INCLUDE imports + our own recordings) with labels and splits."""

from __future__ import annotations

import csv
import json
import pickle
import re
import zlib
from dataclasses import dataclass, replace
from pathlib import Path

from .features import Sequence

ML_DIR = Path(__file__).resolve().parents[1]
VOCAB_FILE = ML_DIR / "vocabulary.json"
INCLUDE_DIR = ML_DIR / "data" / "include"
RAW_DIR = ML_DIR / "data" / "raw"
CACHE_DIR = ML_DIR / "data" / "cache"
OOV_MANIFEST = INCLUDE_DIR / "oov_manifest.json"

# Must match frontend/lib/landmarks/schema.ts — clips from other extractor versions are skipped.
EXTRACTOR_VERSION = "mp-tasks-1.0.1|hand-f16-v1|pose-lite-f16-v1|face-f16-v1|roi-crop-1|schema-1"
DEFAULT_WEBCAM_ASPECT = 4 / 3
INCLUDE_ASPECT = 1920 / 1080  # every INCLUDE video measured so far (include_dims.py)

# Out-of-vocabulary INCLUDE signs: real ISL signs we don't support. Trained as one "unknown" class so
# the app can reject signs (and sign-like movements) outside its vocabulary.
UNKNOWN = "unknown"


@dataclass
class Sample:
    key: str
    label: str
    source: str  # "include" | "include-oov" | "own"
    split: str  # "train" | "val" | "test" | "own"
    signer: str | None
    seq: Sequence
    group: str | None = None  # for OOV clips: the INCLUDE word (splits are word-disjoint)


def load_vocabulary() -> list[dict]:
    return json.loads(VOCAB_FILE.read_text(encoding="utf-8"))["signs"]


def _video_stem(category: str, word: str, zip_path: str) -> str:
    # Same naming as ml/tools/include_download.py, minus the extension.
    return f"{category}__{word}__{Path(zip_path).stem}".replace(" ", "_")


def _include_splits() -> dict[str, str]:
    """Map video stem -> official INCLUDE split (AI4Bharat/INCLUDE train_test_paths, MIT)."""
    by_path: dict[str, str] = {}
    for split in ("train", "val", "test"):
        for line in (INCLUDE_DIR / "split" / f"include_{split}.txt").read_text(encoding="utf-8").splitlines():
            if line.strip():
                by_path[line.strip()] = split
    stems = {}
    with (INCLUDE_DIR / "index.csv").open(encoding="utf-8") as fh:
        for row in csv.DictReader(fh):
            stems[_video_stem(row["category"], row["word"], row["path"])] = by_path.get(row["path"], "train")
    return stems


def oov_split(word_slug: str) -> str:
    """Deterministic word-disjoint split for OOV words: ~60% train, 20% val, 20% test.

    All clips of one word land in the same split, so test-time 'unknown' words were never seen in training.
    """
    bucket = zlib.crc32(word_slug.encode()) % 10
    return "train" if bucket < 6 else "val" if bucket < 8 else "test"


SESSION_GAP = 10  # camera numbers further apart than this start a new recording session


def camera_number(key: str) -> int | None:
    m = re.search(r"MVI_(\d+)", key)
    return int(m.group(1)) if m else None


def session_groups(samples: list["Sample"], gap: int = SESSION_GAP) -> dict[str, str]:
    """key -> recording-session id. INCLUDE has no signer IDs; consecutive camera numbers (MVI_xxxx) are
    back-to-back takes by one signer, so runs of nearby numbers approximate (signer, session)."""
    numbered = sorted((camera_number(s.key), s.key) for s in samples if camera_number(s.key) is not None)
    out, session, last = {}, None, None
    for n, key in numbered:
        if last is None or n - last > gap:
            session = f"s{n:05d}"
        out[key] = session
        last = n
    for s in samples:
        out.setdefault(s.key, f"k-{s.key}")
    return out


def session_split(samples: list["Sample"]) -> dict[str, str]:
    """key -> train/val/test with whole recording sessions held out (stricter than INCLUDE's take-level split).

    Greedy and deterministic: for each class (fewest sessions first) move one of its sessions to test and
    one to val, as long as every class touched keeps at least one training session. Classes recorded in
    fewer than 3 sessions can't be held out and stay in train (reported by the caller).
    """
    groups = session_groups(samples)
    sess_labels: dict[str, set[str]] = {}
    label_sess: dict[str, set[str]] = {}
    sess_size: dict[str, int] = {}
    for s in samples:
        g = groups[s.key]
        sess_labels.setdefault(g, set()).add(s.label)
        label_sess.setdefault(s.label, set()).add(g)
        sess_size[g] = sess_size.get(g, 0) + 1
    split = {g: "train" for g in sess_labels}

    def train_sessions(label: str) -> int:
        return sum(1 for g in label_sess[label] if split[g] == "train")

    for target in ("test", "val"):
        for label in sorted(label_sess, key=lambda lab: (len(label_sess[lab]), lab)):
            if any(split[g] == target for g in label_sess[label]):
                continue
            # smallest session first, so as little training data as possible is held out
            for g in sorted(label_sess[label], key=lambda g: (sess_size[g], g)):
                if split[g] != "train":
                    continue
                if all(train_sessions(lab) >= 2 for lab in sess_labels[g]):
                    split[g] = target
                    break
    return {s.key: split[groups[s.key]] for s in samples}


class _SeqCache:
    """Parsed landmark files keyed by (path, size, mtime) — avoids re-reading ~1,400 JSON files every run.

    Stores compact float32 arrays (a Sequence with aspect 1) plus the few metadata fields we need, not the
    raw JSON (Python float lists would take several GB of RAM)."""

    def __init__(self) -> None:
        self.path = CACHE_DIR / f"sequences-{zlib.crc32(EXTRACTOR_VERSION.encode()):08x}.pkl"
        self.items: dict[str, tuple[tuple[int, int], dict]] = {}
        if self.path.is_file():
            try:
                self.items = pickle.loads(self.path.read_bytes())
            except Exception:
                self.items = {}
        self.dirty = False

    def record(self, path: Path) -> dict:
        st = path.stat()
        stamp = (st.st_size, int(st.st_mtime))
        hit = self.items.get(str(path))
        if hit and hit[0] == stamp:
            return hit[1]
        raw = json.loads(path.read_text(encoding="utf-8"))
        rec = {
            "video": raw.get("video"),
            "extractorVersion": raw.get("extractorVersion"),
            "seq": Sequence.from_frames(raw["frames"], aspect=1.0),
        }
        self.items[str(path)] = (stamp, rec)
        self.dirty = True
        return rec

    def save(self) -> None:
        if self.dirty:
            CACHE_DIR.mkdir(parents=True, exist_ok=True)
            self.path.write_bytes(pickle.dumps(self.items, protocol=pickle.HIGHEST_PROTOCOL))
            self.dirty = False


_cache: _SeqCache | None = None


def _records(paths: list[Path]):
    global _cache
    _cache = _cache or _SeqCache()
    for path in paths:
        yield path, _cache.record(path)
    _cache.save()


def _dims() -> dict:
    f = INCLUDE_DIR / "video_dims.json"
    return json.loads(f.read_text(encoding="utf-8")) if f.is_file() else {}


def load_include(signs: set[str]) -> list[Sample]:
    splits = _include_splits()
    dims = _dims()
    paths = [p for p in sorted((INCLUDE_DIR / "landmarks").glob("*/*.json")) if p.parent.name in signs]
    samples = []
    for path, rec in _records(paths):
        if rec.get("extractorVersion") != EXTRACTOR_VERSION:
            continue
        sign = path.parent.name
        d = dims.get(f"{sign}/{rec['video']}")
        aspect = d["width"] / d["height"] if d else INCLUDE_ASPECT
        seq = replace(rec["seq"], aspect=aspect)
        samples.append(Sample(path.stem, sign, "include", splits.get(path.stem, "train"), None, seq))
    return samples


def load_oov() -> list[Sample]:
    """Out-of-vocabulary INCLUDE clips (downloaded with include_download.py --oov-per-word), label UNKNOWN."""
    if not OOV_MANIFEST.is_file():
        return []
    manifest = json.loads(OOV_MANIFEST.read_text(encoding="utf-8"))
    dims = _dims()
    paths = [p for p in sorted((INCLUDE_DIR / "landmarks").glob("oov-*/*.json")) if p.parent.name in manifest]
    samples = []
    for path, rec in _records(paths):
        if rec.get("extractorVersion") != EXTRACTOR_VERSION:
            continue
        slug = path.parent.name
        d = dims.get(f"{slug}/{rec['video']}")
        aspect = d["width"] / d["height"] if d else INCLUDE_ASPECT
        seq = replace(rec["seq"], aspect=aspect)
        samples.append(Sample(path.stem, UNKNOWN, "include-oov", oov_split(slug), None, seq, group=slug))
    return samples


def load_own(signs: set[str]) -> list[Sample]:
    """Our own recordings (recorder page). Used as a real-world, unseen-signer test set."""
    samples = []
    for path in sorted(RAW_DIR.glob("*/*/*.json")):
        sign, signer = path.parent.parent.name, path.parent.name
        if sign not in signs:
            continue
        rec = json.loads(path.read_text(encoding="utf-8"))
        if rec.get("extractorVersion") != EXTRACTOR_VERSION:
            continue
        aspect = rec["width"] / rec["height"] if rec.get("width") else DEFAULT_WEBCAM_ASPECT
        samples.append(Sample(path.stem, sign, "own", "own", signer, Sequence.from_frames(rec["frames"], aspect)))
    return samples
