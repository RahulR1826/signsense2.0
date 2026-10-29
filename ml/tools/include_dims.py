"""Record width/height of every downloaded INCLUDE video -> ml/data/include/video_dims.json.

Landmarks are normalised to [0,1] separately in x and y, so the aspect ratio is needed to turn them
back into undistorted 2D shapes. Reads the H.264 sample entry (avc1) from the MOV/MP4 header.

Usage: python ml/tools/include_dims.py
"""

import json
import struct
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1] / "data" / "include"


def avc1_size(path: Path) -> tuple[int, int]:
    data = path.read_bytes()
    # "avc1" also appears as a brand in the MP4 'ftyp' box, so take the first occurrence that parses
    # as a plausible visual sample entry: 4 type + 6 reserved + 2 data-ref + 16 pre-defined, then w, h.
    i = data.find(b"avc1")
    while i >= 0:
        w, h = struct.unpack(">HH", data[i + 28 : i + 32])
        if 64 <= w <= 8192 and 64 <= h <= 8192:
            return w, h
        i = data.find(b"avc1", i + 4)
    raise ValueError(f"no avc1 sample entry in {path.name}")


def main() -> None:
    dims = {}
    for video in sorted((ROOT / "videos").glob("*/*")):
        if video.suffix.upper() not in (".MOV", ".MP4"):
            continue
        w, h = avc1_size(video)
        dims[f"{video.parent.name}/{video.name}"] = {"width": w, "height": h}
    out = ROOT / "video_dims.json"
    out.write_text(json.dumps(dims, indent=0), encoding="utf-8")
    sizes = {}
    for d in dims.values():
        key = f"{d['width']}x{d['height']}"
        sizes[key] = sizes.get(key, 0) + 1
    print(f"{len(dims)} videos -> {out}; sizes: {sizes}")


if __name__ == "__main__":
    main()
