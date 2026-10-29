"""Render the 3D Saathi for the website: Blender (ml/blender/saathi3d.py --mode web, EEVEE on the GPU) -> PNG frames
-> a small silent H.264 video and a poster per sign in sign-library/saathi3d/, recorded in library.json as
"video3d" / "poster3d". A drawn character performs the motion; no real signer appears.

Usage (from ml/): .venv/Scripts/python tools/render_saathi3d.py [--blender PATH] [--only id,id] [--skip-render]
"""

import argparse
import json
import subprocess
from pathlib import Path

import imageio_ffmpeg

ML_DIR = Path(__file__).resolve().parents[1]
REPO = ML_DIR.parent
LIB = REPO / "sign-library"
FRAMES = ML_DIR / "data" / "cache" / "saathi3d" / "web"
DEFAULT_BLENDER = Path("D:/tools/blender-4.5.15-windows-x64/blender.exe")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--blender", default=str(DEFAULT_BLENDER))
    ap.add_argument("--only", default="")
    ap.add_argument("--skip-render", action="store_true", help="encode frames rendered earlier")
    args = ap.parse_args()

    library = json.loads((LIB / "library.json").read_text(encoding="utf-8"))
    signs = [s for s in library["signs"] if not args.only or s["id"] in args.only.split(",")]
    if not args.skip_render:
        cmd = [args.blender, "-b", "--factory-startup", "-P", str(ML_DIR / "blender" / "saathi3d.py"), "--", "--mode", "web"]
        if args.only:
            cmd += ["--only", args.only]
        subprocess.run(cmd, check=True)

    ffmpeg = imageio_ffmpeg.get_ffmpeg_exe()
    out = LIB / "saathi3d"
    out.mkdir(exist_ok=True)
    for sign in signs:
        anim = json.loads((LIB / "anim3d" / f"{sign['id']}.json").read_text(encoding="utf-8"))
        src = FRAMES / sign["id"]
        video = out / f"{sign['id']}.mp4"
        subprocess.run(
            [ffmpeg, "-y", "-loglevel", "error", "-framerate", str(anim["fps"]), "-i", str(src / "f%04d.png"),
             "-an", "-c:v", "libx264", "-preset", "slow", "-crf", "26", "-pix_fmt", "yuv420p", "-movflags", "+faststart",
             str(video)],
            check=True,
        )
        poster = out / f"{sign['id']}.jpg"
        subprocess.run([ffmpeg, "-y", "-loglevel", "error", "-i", str(src / f"f{anim['poster']:04d}.png"), "-q:v", "4", str(poster)], check=True)
        sign["video3d"] = f"saathi3d/{sign['id']}.mp4"
        sign["poster3d"] = f"saathi3d/{sign['id']}.jpg"
        print(f"{sign['id']:14} {video.stat().st_size / 1e3:5.0f} KB video, {poster.stat().st_size / 1e3:4.0f} KB poster")
    (LIB / "library.json").write_bytes((json.dumps(library, indent=2, ensure_ascii=False) + "\n").encode("utf-8"))


if __name__ == "__main__":
    main()
