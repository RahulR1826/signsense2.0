"""List every video in the INCLUDE ISL dataset without downloading the 56.8 GB of zips.

Reads only each zip's central directory via HTTP range requests (a few KB per zip) and writes
ml/data/include/index.csv with one row per video: zip, path inside zip, category, word, size, offset.

INCLUDE: https://zenodo.org/records/4010759 (CC BY 4.0) - Sridhar et al., ACM MM 2020.

Usage: python ml/tools/include_index.py
"""

import csv
import io
import json
import time
import urllib.error
import urllib.request
import zipfile
from pathlib import Path

RECORD = "https://zenodo.org/api/records/4010759"
OUT = Path(__file__).resolve().parents[1] / "data" / "include" / "index.csv"
VIDEO_EXT = (".mov", ".mp4", ".avi", ".mkv")


class HttpRangeFile(io.RawIOBase):
    """Seekable read-only file over HTTP range requests (enough for zipfile to read a central directory)."""

    def __init__(self, url: str, size: int):
        self.url, self.size, self.pos = url, size, 0

    def readable(self) -> bool:
        return True

    def seekable(self) -> bool:
        return True

    def tell(self) -> int:
        return self.pos

    def seek(self, offset: int, whence: int = io.SEEK_SET) -> int:
        base = {io.SEEK_SET: 0, io.SEEK_CUR: self.pos, io.SEEK_END: self.size}[whence]
        self.pos = base + offset
        return self.pos

    def read(self, n: int = -1) -> bytes:
        if n < 0 or self.pos + n > self.size:
            n = self.size - self.pos
        if n <= 0:
            return b""
        req = urllib.request.Request(self.url, headers={"Range": f"bytes={self.pos}-{self.pos + n - 1}"})
        for attempt in range(5):
            try:
                with urllib.request.urlopen(req, timeout=60) as res:
                    data = res.read()
                break
            except (urllib.error.HTTPError, urllib.error.URLError, TimeoutError):
                if attempt == 4:
                    raise
                time.sleep(2**attempt)
        self.pos += len(data)
        return data


def main() -> None:
    with urllib.request.urlopen(RECORD) as res:
        files = json.load(res)["files"]
    zips = sorted((f for f in files if f["key"].endswith(".zip")), key=lambda f: f["key"])

    OUT.parent.mkdir(parents=True, exist_ok=True)
    rows = []
    for f in zips:
        url = f["links"]["self"]
        with zipfile.ZipFile(HttpRangeFile(url, f["size"])) as z:
            for info in z.infolist():
                if not info.filename.lower().endswith(VIDEO_EXT):
                    continue
                parts = Path(info.filename).parts  # e.g. Greetings/48. Hello/MVI_0001.MOV
                if len(parts) < 3:
                    continue
                category, word_dir = parts[0], parts[-2]
                word = word_dir.split(". ", 1)[-1].strip()
                rows.append({
                    "zip": f["key"],
                    "path": info.filename,
                    "category": category,
                    "word": word,
                    "size": info.compress_size,
                    "header_offset": info.header_offset,
                })
        print(f"{f['key']}: {sum(r['zip'] == f['key'] for r in rows)} videos")

    with OUT.open("w", newline="", encoding="utf-8") as fh:
        writer = csv.DictWriter(fh, fieldnames=list(rows[0]))
        writer.writeheader()
        writer.writerows(rows)
    print(f"{len(rows)} videos, {len({(r['category'], r['word']) for r in rows})} words -> {OUT}")


if __name__ == "__main__":
    main()
