"""Build the text->sign clip library from INCLUDE videos.

For every sign in ml/vocabulary.json that maps to INCLUDE, pick one clip (never from the test split,
so evaluation clips are not shown in the app; good hand tracking, typical length), trim it to the
signing (hands raised) plus a little rest either side, crop to the signer's upper body using the pose
landmarks, and encode a small silent web video + poster.

Output (committed; CC BY 4.0, attribution in sign-library/ATTRIBUTION.md):
  sign-library/videos/<id>.mp4, sign-library/posters/<id>.jpg, sign-library/library.json
and a copy in frontend/public/sign-library/ for the app.

Usage (from ml/): .venv/Scripts/python tools/build_sign_library.py
"""

import json
import shutil
import statistics
import subprocess
import sys
from pathlib import Path

import imageio_ffmpeg

ML_DIR = Path(__file__).resolve().parents[1]
REPO = ML_DIR.parent
sys.path.insert(0, str(ML_DIR))

from signsense_ml import data  # noqa: E402

OUT = REPO / "sign-library"
PUBLIC = REPO / "frontend" / "public" / "sign-library"
SIZE = 480  # square output, px
PAD_S = 0.3
L_SH, R_SH = 11, 12


def active_range(frames: list[dict], aspect: float) -> tuple[int, int] | None:
    """First/last frame where a hand is raised above the rest line (same rule as the live segmenter)."""
    active = []
    for i, f in enumerate(frames):
        p = f["pose"]
        hands = [h for h in (f["leftHand"], f["rightHand"]) if h]
        if not p or not hands:
            continue
        ly, ry = p[L_SH * 4 + 1], p[R_SH * 4 + 1]
        sw = ((p[L_SH * 4] - p[R_SH * 4]) ** 2 * aspect**2 + (ly - ry) ** 2) ** 0.5
        rest = (ly + ry) / 2 + 1.3 * sw
        if any(h[1] < rest for h in hands):
            active.append(i)
    return (active[0], active[-1]) if active else None


def crop_box(frames: list[dict], w: int, h: int) -> tuple[int, int, int]:
    """Square crop (x, y, size) around the upper body, from median shoulder position/width."""
    xs, ys, sws = [], [], []
    for f in frames:
        p = f["pose"]
        if not p:
            continue
        lx, ly, rx, ry = p[L_SH * 4] * w, p[L_SH * 4 + 1] * h, p[R_SH * 4] * w, p[R_SH * 4 + 1] * h
        xs.append((lx + rx) / 2)
        ys.append((ly + ry) / 2)
        sws.append(((lx - rx) ** 2 + (ly - ry) ** 2) ** 0.5)
    cx, cy, sw = statistics.median(xs), statistics.median(ys), statistics.median(sws)
    size = int(min(3.4 * sw, w, h)) // 2 * 2
    x = int(min(max(cx - size / 2, 0), w - size)) // 2 * 2
    y = int(min(max(cy - size * 0.42, 0), h - size)) // 2 * 2
    return x, y, size


def pick_clip(sign: str, splits: dict[str, str]) -> Path | None:
    candidates = []
    for path in sorted((data.INCLUDE_DIR / "landmarks" / sign).glob("*.json")):
        if splits.get(path.stem) == "test":
            continue  # keep test clips unseen everywhere
        rec = json.loads(path.read_text(encoding="utf-8"))
        fr = rec["frames"]
        hand_rate = sum(1 for f in fr if f["leftHand"] or f["rightHand"]) / len(fr)
        candidates.append((hand_rate, len(fr), path))
    if not candidates:
        return None
    median_len = statistics.median(c[1] for c in candidates)
    # Good tracking first, then closest to a typical duration.
    candidates.sort(key=lambda c: (-round(c[0], 1), abs(c[1] - median_len)))
    return candidates[0][2]


def main() -> None:
    ffmpeg = imageio_ffmpeg.get_ffmpeg_exe()
    splits = data._include_splits()
    dims = json.loads((data.INCLUDE_DIR / "video_dims.json").read_text(encoding="utf-8"))
    (OUT / "videos").mkdir(parents=True, exist_ok=True)
    (OUT / "posters").mkdir(parents=True, exist_ok=True)

    entries = []
    for sign in data.load_vocabulary():
        if "include" not in sign:
            continue
        clip = pick_clip(sign["id"], splits)
        if clip is None:
            print("no clip for", sign["id"])
            continue
        rec = json.loads(clip.read_text(encoding="utf-8"))
        d = dims[f"{sign['id']}/{rec['video']}"]
        w, h, fps = d["width"], d["height"], rec["fps"]
        frames = rec["frames"]
        rng = active_range(frames, w / h) or (0, len(frames) - 1)
        start = max(0.0, rng[0] / fps - PAD_S)
        end = min(len(frames) / fps, (rng[1] + 1) / fps + PAD_S)
        x, y, size = crop_box(frames[rng[0] : rng[1] + 1] or frames, w, h)
        src = data.INCLUDE_DIR / "videos" / sign["id"] / rec["video"]
        video_out = OUT / "videos" / f"{sign['id']}.mp4"
        poster_out = OUT / "posters" / f"{sign['id']}.jpg"
        vf = f"crop={size}:{size}:{x}:{y},scale={SIZE}:{SIZE}"
        subprocess.run(
            [ffmpeg, "-y", "-loglevel", "error", "-ss", f"{start:.2f}", "-to", f"{end:.2f}", "-i", str(src),
             "-vf", vf, "-an", "-r", "25", "-c:v", "libx264", "-preset", "slow", "-crf", "27",
             "-pix_fmt", "yuv420p", "-movflags", "+faststart", str(video_out)],
            check=True,
        )
        mid = (start + end) / 2
        subprocess.run(
            [ffmpeg, "-y", "-loglevel", "error", "-ss", f"{mid:.2f}", "-i", str(src), "-frames:v", "1",
             "-vf", vf, "-q:v", "4", str(poster_out)],
            check=True,
        )
        entries.append({
            "id": sign["id"],
            "label": sign["label"],
            "category": sign["category"],
            "video": f"videos/{sign['id']}.mp4",
            "poster": f"posters/{sign['id']}.jpg",
            "duration": round(end - start, 2),
            "source": {"dataset": "INCLUDE", "file": f"{sign['include']['category']}/{sign['include']['word']}/{rec['video']}"},
        })
        print(f"{sign['id']:14} {end - start:4.1f}s  {video_out.stat().st_size / 1e3:6.0f} KB")

    library = {
        "version": 1,
        "language": "ISL",
        "attribution": "Sign videos from INCLUDE (Sridhar, Ganesan, Kumar, Khapra; ACM MM 2020), CC BY 4.0 — https://zenodo.org/records/4010759. Trimmed, cropped and re-encoded.",
        "signs": entries,
    }
    (OUT / "library.json").write_text(json.dumps(library, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")

    if PUBLIC.exists():
        shutil.rmtree(PUBLIC)
    shutil.copytree(OUT, PUBLIC, ignore=shutil.ignore_patterns("*.md", ".gitkeep"))
    total = sum(p.stat().st_size for p in (OUT / "videos").glob("*.mp4"))
    print(f"{len(entries)} signs, {total / 1e6:.1f} MB -> {OUT} and {PUBLIC}")


if __name__ == "__main__":
    main()
