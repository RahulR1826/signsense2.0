"""Download only the INCLUDE videos for the signs in ml/vocabulary.json.

Uses ml/data/include/index.csv (from include_index.py) to fetch each video straight out of the
Zenodo zips with HTTP range requests, so we never download whole 1-2 GB archives.
Resumable: finished videos are skipped (partial downloads use a .part file). CRC32 is verified for every file.

Output: ml/data/include/videos/<sign_id>/<category>__<word>__<file>.MOV
INCLUDE: https://zenodo.org/records/4010759 (CC BY 4.0) - Sridhar et al., ACM MM 2020.

Usage: python ml/tools/include_download.py [--workers 4] [--dry-run]
"""

import argparse
import csv
import http.client
import json
import sys
import re
import struct
import time
import urllib.error
import urllib.request
import zlib
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

ML_DIR = Path(__file__).resolve().parents[1]
INDEX = ML_DIR / "data" / "include" / "index.csv"
VOCAB = ML_DIR / "vocabulary.json"
OUT = ML_DIR / "data" / "include" / "videos"
OOV_MANIFEST = ML_DIR / "data" / "include" / "oov_manifest.json"
FILE_URL = "https://zenodo.org/api/records/4010759/files/{zip}/content"
LOCAL_HEADER = struct.Struct("<IHHHHHIIIHH")  # zip local file header, 30 bytes


def fetch_range(url: str, start: int, length: int) -> bytes:
    req = urllib.request.Request(url, headers={"Range": f"bytes={start}-{start + length - 1}"})
    for attempt in range(6):
        try:
            with urllib.request.urlopen(req, timeout=120) as res:
                data = res.read()
            if len(data) == length:
                return data
            raise IOError(f"short read {len(data)}/{length}")
        except (urllib.error.URLError, http.client.HTTPException, TimeoutError, OSError):
            # Zenodo connections drop on slow links (e.g. IncompleteRead); back off and retry.
            if attempt == 5:
                raise
            time.sleep(2**attempt)
    raise AssertionError("unreachable")


def download(row: dict, dest: Path) -> str:
    url = FILE_URL.format(zip=row["zip"])
    header = LOCAL_HEADER.unpack(fetch_range(url, int(row["header_offset"]), LOCAL_HEADER.size))
    sig, _, _, method, _, _, crc, comp_size, _, name_len, extra_len = header
    if sig != 0x04034B50:
        raise ValueError(f"bad zip header for {row['path']}")
    data_start = int(row["header_offset"]) + LOCAL_HEADER.size + name_len + extra_len
    data = fetch_range(url, data_start, comp_size)
    if method == 8:
        data = zlib.decompress(data, -15)
    elif method != 0:
        raise ValueError(f"unsupported compression {method} for {row['path']}")
    if zlib.crc32(data) != crc:
        raise ValueError(f"CRC mismatch for {row['path']}")
    tmp = dest.with_suffix(dest.suffix + ".part")
    tmp.write_bytes(data)
    tmp.replace(dest)
    return f"{dest.parent.name}/{dest.name} ({len(data) / 1e6:.1f} MB)"


def oov_slug(category: str, word: str) -> str:
    """Folder name for an out-of-vocabulary INCLUDE word, e.g. ('Adjectives', 'loud') -> 'oov-adj-loud'."""
    s = re.sub(r"[^a-z0-9]+", "-", f"{category[:3]}-{word}".lower()).strip("-")
    return f"oov-{s}"[:32].rstrip("-")


def oov_jobs(all_rows: list[dict], vocab_keys: set[tuple[str, str]], per_word: int) -> tuple[list, dict]:
    """N clips of every INCLUDE word that is NOT in our vocabulary: real ISL signs the model must reject.

    'Extra' folders are skipped (no single word label). Clips are spread evenly over each word's files.
    """
    by_word: dict[tuple[str, str], list[dict]] = {}
    for r in all_rows:
        key = (r["category"], r["word"])
        if key in vocab_keys or r["word"].lower() == "extra":
            continue
        by_word.setdefault(key, []).append(r)
    jobs, manifest = [], {}
    for (category, word), rows in sorted(by_word.items()):
        slug = oov_slug(category, word)
        if slug in manifest:
            raise SystemExit(f"OOV slug collision: {slug} for {category}/{word} and {manifest[slug]}")
        manifest[slug] = {"category": category, "word": word}
        rows = sorted(rows, key=lambda r: r["path"])
        step = max(1, len(rows) // per_word)
        for r in rows[::step][:per_word]:
            dest = OUT / slug / f"{category}__{word}__{Path(r['path']).name}".replace(" ", "_")
            jobs.append((r, dest))
    return jobs, manifest


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--workers", type=int, default=4)
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument(
        "--oov-per-word", type=int, default=0,
        help="also fetch N clips of every INCLUDE word outside the vocabulary (negatives for 'unknown sign')",
    )
    parser.add_argument(
        "--oov-only-split", choices=["train", "val", "test"],
        help="only add OOV clips for words in this word-disjoint split (keeps the other splits' clips unchanged)",
    )
    args = parser.parse_args()

    signs = json.loads(VOCAB.read_text(encoding="utf-8"))["signs"]
    wanted = {(s["include"]["category"], s["include"]["word"]): s["id"] for s in signs if "include" in s}
    all_rows = list(csv.DictReader(INDEX.open(encoding="utf-8")))
    rows = [r for r in all_rows if (r["category"], r["word"]) in wanted]

    jobs = []
    for r in rows:
        sign_id = wanted[(r["category"], r["word"])]
        dest = OUT / sign_id / f"{r['category']}__{r['word']}__{Path(r['path']).name}".replace(" ", "_")
        jobs.append((r, dest))

    missing = sorted(wanted.keys() - {(r["category"], r["word"]) for r in rows})
    if missing:
        raise SystemExit(f"words not found in INCLUDE index: {missing}")

    if args.oov_per_word > 0:
        extra, manifest = oov_jobs(all_rows, set(wanted), args.oov_per_word)
        if args.oov_only_split:
            sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
            from signsense_ml.data import oov_split

            extra = [(r, dest) for r, dest in extra if oov_split(dest.parent.name) == args.oov_only_split]
        jobs += extra
        if not args.dry_run:
            OOV_MANIFEST.write_text(json.dumps(manifest, indent=1, sort_keys=True), encoding="utf-8")
        print(f"out-of-vocabulary: {len(manifest)} words, {len(extra)} clips")

    total = sum(int(r["size"]) for r, _ in jobs)
    print(f"{len(wanted)} signs, {len(jobs)} videos, ~{total / 1e9:.2f} GB")
    if args.dry_run:
        return

    todo = []
    for r, dest in jobs:
        dest.parent.mkdir(parents=True, exist_ok=True)
        if dest.is_file() and dest.stat().st_size > 0:
            continue
        todo.append((r, dest))
    print(f"{len(jobs) - len(todo)} already downloaded, {len(todo)} to go")

    failures = 0
    with ThreadPoolExecutor(max_workers=args.workers) as pool:
        futures = {pool.submit(download, r, dest): r for r, dest in todo}
        for i, fut in enumerate(as_completed(futures), 1):
            try:
                print(f"[{i}/{len(todo)}] {fut.result()}", flush=True)
            except Exception as exc:  # keep going; rerun the script to retry failures
                failures += 1
                print(f"[{i}/{len(todo)}] FAILED {futures[fut]['path']}: {exc}", flush=True)
    print(f"done, {failures} failed" + (" - rerun to retry" if failures else ""))


if __name__ == "__main__":
    main()
