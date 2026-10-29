"""INCLUDE video -> landmark import. The browser does the extraction (same extractor as the webcam);
the backend only lists pending videos, streams them, and stores the resulting landmark files."""

import json
import re
from pathlib import Path

from app.schemas.dataset import LandmarkFrame

VIDEO_NAME = re.compile(r"^[A-Za-z0-9_.()-]{1,120}\.(MOV|mov|mp4|MP4)$")
SIGN_ID = re.compile(r"^[a-z0-9_-]{1,32}$")


def video_path(root: Path, sign: str, file: str) -> Path | None:
    if not SIGN_ID.match(sign) or not VIDEO_NAME.match(file):
        return None
    path = root / "videos" / sign / file
    return path if path.is_file() else None


def landmark_path(root: Path, sign: str, file: str) -> Path:
    return root / "landmarks" / sign / f"{Path(file).stem}.json"


VERSION_FIELD = re.compile(r'"extractorVersion":"([^"]*)"')


def _version_of(path: Path) -> str | None:
    # save() writes extractorVersion before the (large) frames array, so the file head is enough.
    with path.open(encoding="utf-8") as fh:
        match = VERSION_FIELD.search(fh.read(1024))
    return match.group(1) if match else None


def pending(root: Path, extractor_version: str) -> tuple[list[dict[str, str]], int]:
    """Videos without landmarks for this extractor version, and the number already done."""
    todo: list[dict[str, str]] = []
    done = 0
    videos = root / "videos"
    if not videos.is_dir():
        return todo, done
    for sign_dir in sorted(d for d in videos.iterdir() if d.is_dir()):
        for video in sorted(sign_dir.iterdir()):
            if not VIDEO_NAME.match(video.name):
                continue  # skips .part files from an unfinished download
            out = landmark_path(root, sign_dir.name, video.name)
            if out.is_file() and _version_of(out) == extractor_version:
                done += 1
            else:
                todo.append({"sign": sign_dir.name, "file": video.name})
    return todo, done


def save(root: Path, sign: str, file: str, extractor_version: str, fps: float, frames: list[LandmarkFrame]) -> Path:
    out = landmark_path(root, sign, file)
    out.parent.mkdir(parents=True, exist_ok=True)
    record = {
        "source": "INCLUDE",
        "sign": sign,
        "video": file,
        "extractorVersion": extractor_version,
        "fps": fps,
        "frames": [f.model_dump() for f in frames],
    }
    out.write_text(json.dumps(record, separators=(",", ":")), encoding="utf-8")
    return out
