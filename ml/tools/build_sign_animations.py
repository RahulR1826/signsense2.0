"""Build the motion files that drive Saathi, the drawn signer who replaces real people on the website.

For every sign in sign-library/library.json, take the same INCLUDE clip and the same time range as the
dictionary video (build_sign_library.py; if that clip's landmarks show no signing, the best-tracked non-test
clip of the same sign that does), and turn its landmarks into a small JSON motion file:
  - body frame: origin at the signer's median shoulder midpoint, unit = median shoulder width / 100,
    image orientation (x right, y down; the signer faces the viewer, so their right hand is on screen left);
  - short tracking gaps (<= MAX_GAP frames) filled by linear interpolation, then light smoothing;
  - each forearm ends at its hand's wrist when the hand is tracked, so hand and arm stay joined;
  - the face is reduced to a few controls (head position/size/tilt, mouth, brows), never an image.
No video or face pixels are written. Output: sign-library/anim/<id>.json (+ "anim" path in library.json),
copied to frontend/public/sign-library/ by the frontend's setup script.

Usage (from ml/): .venv/Scripts/python tools/build_sign_animations.py
"""

import json
import math
import statistics
import sys
from pathlib import Path

ML_DIR = Path(__file__).resolve().parents[1]
REPO = ML_DIR.parent
sys.path.insert(0, str(ML_DIR))
sys.path.insert(0, str(Path(__file__).resolve().parent))

from build_sign_library import PAD_S, active_range  # noqa: E402
from signsense_ml import data  # noqa: E402

LIB = REPO / "sign-library"
MAX_GAP = 8  # frames (0.32 s at 25 fps)
SMOOTH = (1, 2, 3, 2, 1)

# Pose indices: person's left shoulder/elbow/wrist, then right; nose.
P_LEFT, P_RIGHT, P_NOSE = (11, 13, 15), (12, 14, 16), 0
# Indices into the stored face subset (frontend/lib/landmarks/schema.ts FACE_SUBSET).
F_LIP_TOP_IN, F_LIP_BOT_IN = 35, 25  # 13, 14
F_MOUTH_L, F_MOUTH_R = 10, 0  # 291, 61
F_BROW_L, F_BROW_R = range(40, 50), range(50, 60)
F_EYE_R = (60, 61, 62, 63)  # 33, 133, 159 (upper lid), 145 (lower lid)
F_EYE_L = (64, 65, 66, 67)  # 362, 263, 386, 374
F_FOREHEAD, F_CHIN = 70, 71
F_HEAD3 = (70, 71, 60, 65, 68)  # forehead, chin, right eye outer (33), left eye outer (263), nose tip (1)


def interp_gaps(track: list[list[float] | None]) -> list[list[float] | None]:
    """Fill runs of None no longer than MAX_GAP that have data on both sides."""
    out = list(track)
    i = 0
    while i < len(out):
        if out[i] is not None:
            i += 1
            continue
        j = i
        while j < len(out) and out[j] is None:
            j += 1
        if 0 < i and j < len(out) and j - i <= MAX_GAP:
            a, b = out[i - 1], out[j]
            for k in range(i, j):
                t = (k - i + 1) / (j - i + 1)
                out[k] = [x + (y - x) * t for x, y in zip(a, b)]
        i = j
    return out


def smooth(track: list[list[float] | None]) -> list[list[float] | None]:
    """Centred weighted average over the frames that have data (gaps stay gaps)."""
    half = len(SMOOTH) // 2
    out: list[list[float] | None] = []
    for i, v in enumerate(track):
        if v is None:
            out.append(None)
            continue
        acc, wsum = [0.0] * len(v), 0.0
        for k, w in enumerate(SMOOTH):
            j = i + k - half
            if 0 <= j < len(track) and track[j] is not None:
                acc = [a + w * x for a, x in zip(acc, track[j])]
                wsum += w
        out.append([a / wsum for a in acc])
    return out


def hold_ends(track: list[list[float] | None]) -> list[list[float] | None]:
    """Fill any remaining gaps by holding the nearest value (used for body and face, which never vanish)."""
    known = [i for i, v in enumerate(track) if v is not None]
    if not known:
        return track
    return [v if v is not None else track[min(known, key=lambda k: abs(k - i))] for i, v in enumerate(track)]


def signing_clip(sign: dict, dims: dict, splits: dict[str, str]) -> tuple[dict, tuple[int, int]] | None:
    """The dictionary clip, or, when its landmarks show no signing (hands never raised), the non-test clip of the
    same sign with the best hand tracking that does."""
    def load(path: Path):
        rec = json.loads(path.read_text(encoding="utf-8"))
        d = dims[f"{sign['id']}/{rec['video']}"]
        return rec, active_range(rec["frames"], d["width"] / d["height"])

    folder = data.INCLUDE_DIR / "landmarks" / sign["id"]
    rec, rng = load(folder / f"{Path(sign['source']['file']).stem}.json")
    if rng:
        return rec, rng
    best = None
    for path in sorted(folder.glob("*.json")):
        if splits.get(path.stem) == "test":
            continue
        rec, rng = load(path)
        if rng:
            fr = rec["frames"]
            hand_rate = sum(1 for f in fr[rng[0] : rng[1] + 1] if f["leftHand"] or f["rightHand"]) / (rng[1] - rng[0] + 1)
            if best is None or hand_rate > best[0]:
                best = (hand_rate, rec, rng)
    if best is None:
        return None
    print(f"  {sign['id']}: dictionary clip shows no signing; using {best[1]['video']}")
    return best[1], best[2]


def build(sign: dict, dims: dict, splits: dict[str, str]) -> dict | None:
    found = signing_clip(sign, dims, splits)
    if found is None:
        return None
    rec, rng = found
    d = dims[f"{sign['id']}/{rec['video']}"]
    w, h, fps = d["width"], d["height"], rec["fps"]
    frames = rec["frames"]
    src_file = str(Path(sign["source"]["file"]).parent / rec["video"]).replace("\\", "/")
    first = max(0, round(rng[0] - PAD_S * fps))
    last = min(len(frames) - 1, round(rng[1] + PAD_S * fps))
    frames = frames[first : last + 1]

    px = lambda arr, i, n: (arr[i * n] * w, arr[i * n + 1] * h)  # noqa: E731

    # Body frame from the median shoulders.
    mids, widths = [], []
    for f in frames:
        if f["pose"]:
            (lx, ly), (rx, ry) = px(f["pose"], 11, 4), px(f["pose"], 12, 4)
            mids.append(((lx + rx) / 2, (ly + ry) / 2))
            widths.append(math.hypot(lx - rx, ly - ry))
    if not widths:
        return None
    ox, oy = statistics.median(m[0] for m in mids), statistics.median(m[1] for m in mids)
    unit = statistics.median(widths) / 100

    def norm(x: float, y: float) -> list[float]:
        return [(x - ox) / unit, (y - oy) / unit]

    arms: dict[str, list] = {"L": [], "R": []}
    depth: dict[str, list] = {"L": [], "R": []}
    hands: dict[str, list] = {"L": [], "R": []}
    face: list = []
    # Depth for the 3D Saathi (MediaPipe z uses the scale of x, i.e. frame widths): pose joints relative to
    # the median shoulder depth; hand points relative to their own wrist; face points relative to the face.
    zd = lambda z: z * w / unit  # noqa: E731
    shoulder_z = [(f["pose"][11 * 4 + 2] + f["pose"][12 * 4 + 2]) / 2 for f in frames if f["pose"]]
    oz = statistics.median(shoulder_z) if shoulder_z else 0.0
    arm_z: dict[str, list] = {"L": [], "R": []}
    hand_z: dict[str, list] = {"L": [], "R": []}
    head3: list = []
    for f in frames:
        p = f["pose"]
        for side, idx, key in (("L", P_LEFT, "leftHand"), ("R", P_RIGHT, "rightHand")):
            arms[side].append(sum((norm(*px(p, i, 4)) for i in idx), []) if p else None)
            depth[side].append([p[idx[2] * 4 + 2]] if p else None)
            arm_z[side].append([zd(p[i * 4 + 2] - oz) for i in idx] if p else None)
            hd = f[key]
            hands[side].append(sum((norm(*px(hd, i, 3)) for i in range(21)), []) if hd else None)
            hand_z[side].append([zd(hd[i * 3 + 2] - hd[2]) for i in range(21)] if hd else None)
        fc = f["face"]
        head3.append(sum(([*norm(*px(fc, i, 3)), zd(fc[i * 3 + 2])] for i in F_HEAD3), []) if fc else None)
        if fc:
            fp = lambda i: norm(*px(fc, i, 3))  # noqa: E731
            top, chin = fp(F_FOREHEAD), fp(F_CHIN)
            size = math.hypot(top[0] - chin[0], top[1] - chin[1])
            roll = math.degrees(math.atan2(chin[0] - top[0], chin[1] - top[1]))
            mouth_open = math.dist(fp(F_LIP_TOP_IN), fp(F_LIP_BOT_IN)) / size
            mouth_wide = math.dist(fp(F_MOUTH_L), fp(F_MOUTH_R)) / size

            def brow(rng_, eye):
                by = statistics.mean(fp(i)[1] for i in rng_)
                ey = (fp(eye[0])[1] + fp(eye[1])[1]) / 2
                return (ey - by) / size

            def eye_open(eye):
                return math.dist(fp(eye[2]), fp(eye[3])) / size

            face.append([(top[0] + chin[0]) / 2, (top[1] + chin[1]) / 2, size, roll, mouth_open, mouth_wide,
                         brow(F_BROW_L, F_EYE_L), brow(F_BROW_R, F_EYE_R), (eye_open(F_EYE_L) + eye_open(F_EYE_R)) / 2])
        else:
            face.append(None)

    for side in ("L", "R"):
        arms[side] = hold_ends(smooth(interp_gaps(arms[side])))
        depth[side] = hold_ends(smooth(interp_gaps(depth[side])))
        hands[side] = smooth(interp_gaps(hands[side]))
        # Pose depth is the noisiest coordinate: smooth it twice.
        arm_z[side] = hold_ends(smooth(smooth(interp_gaps(arm_z[side]))))
        hand_z[side] = smooth(interp_gaps(hand_z[side]))
    head3 = hold_ends(smooth(interp_gaps(head3)))
    face = hold_ends(smooth(interp_gaps(face)))
    if any(v is None for v in face):
        # No face anywhere: place the head above the shoulders from typical proportions.
        face = [[0, -105, 95, 0, 0.02, 0.38, 0.2, 0.2, 0.06]] * len(frames)

    # Neutral face values (median over the clip) so expressions are relative to this signer.
    neutral = [statistics.median(f[k] for f in face) for k in (4, 6, 7, 8)]

    out_frames = []
    for i in range(len(frames)):
        a = {}
        for side in ("L", "R"):
            arm = list(arms[side][i])
            hd = hands[side][i]
            if hd is not None:
                arm[4:6] = hd[0:2]  # forearm ends at the tracked wrist
            a[side] = arm
        fr = {
            "a": [round(v) for v in a["L"] + a["R"]],
            # Which arm is nearer the camera (MediaPipe z: smaller = nearer); drawn last.
            "n": "L" if depth["L"][i][0] < depth["R"][i][0] else "R",
            "f": [round(face[i][0]), round(face[i][1]), round(face[i][2]), round(face[i][3]),
                  round(face[i][4] * 100), round(face[i][5] * 100),
                  round((face[i][6] - neutral[1]) * 100), round((face[i][7] - neutral[2]) * 100),
                  round(face[i][8] / max(neutral[3], 1e-3) * 100)],
        }
        for side, key in (("L", "l"), ("R", "r")):
            if hands[side][i] is not None:
                fr[key] = [round(v) for v in hands[side][i]]
        out_frames.append(fr)

    # Poster: the frame with the most hands raised in the signing space (wrist above chest level), nearest the
    # middle of the signing.
    act = [i - first for i in rng]

    def raised(k: int) -> int:
        fr = out_frames[k]
        return sum(1 for key in ("l", "r") if key in fr and fr[key][1] < 60)

    poster = max(range(len(out_frames)), key=lambda k: (raised(k), -abs(k - (act[0] + act[1]) / 2)))

    # 3D motion (for the Blender Saathi): same x/y as the 2D frames, plus depth d (motion units, + = away from
    # the camera). Hands: d = wrist depth (from the pose) + offset from the wrist (from the hand model).
    # MediaPipe's pose depth is far too large for wrists (the raised "Hello" hand came out four shoulder widths
    # in front of the body), so arm depth comes from fixed bone lengths instead: the depth of each bone is
    # sqrt(length^2 - on-screen length^2), and the pose depth only decides forwards (towards the camera) or back.
    # Lengths: at least typical adult proportions (upper arm 0.8, forearm 0.7 shoulder widths), and at least the
    # longest on-screen length in the clip.
    def bone_len(side: str, j: int, typical: float) -> float:
        seen = []
        for fr in out_frames:
            o = 0 if side == "L" else 6
            seen.append(math.dist(fr["a"][o + j * 2 : o + j * 2 + 2], fr["a"][o + j * 2 + 2 : o + j * 2 + 4]))
        return max(typical, sorted(seen)[int(0.98 * (len(seen) - 1))])

    lengths = {side: (bone_len(side, 0, 80.0), bone_len(side, 1, 70.0)) for side in ("L", "R")}

    def arm_depth(side: str, i: int) -> list[float]:
        o = 0 if side == "L" else 6
        a = out_frames[i]["a"][o : o + 6]
        raw = arm_z[side][i]
        d = [0.0]
        for j, length in enumerate(lengths[side]):
            flat = math.dist(a[j * 2 : j * 2 + 2], a[j * 2 + 2 : j * 2 + 4])
            step = math.sqrt(max(length**2 - flat**2, 0.0))
            back = raw[j + 1] - raw[j] > 0  # pose depth: + = away from the camera
            d.append(d[-1] + (step if back else -step))
        return d

    frames3 = []
    for i, fr in enumerate(out_frames):
        a3 = []
        for side, o in (("L", 0), ("R", 6)):
            xy = fr["a"][o : o + 6]
            dd = arm_depth(side, i)
            a3 += [v for j in range(3) for v in (xy[j * 2], xy[j * 2 + 1], dd[j])]
        f3 = {"a": [round(v, 1) for v in a3], "f": fr["f"]}
        if head3[i] is not None:
            f3["h"] = [round(v, 1) for v in head3[i]]
        for side, key in (("L", "l"), ("R", "r")):
            if key in fr and hand_z[side][i] is not None:
                wrist_d = arm_depth(side, i)[2]
                xy = hands[side][i]
                f3[key] = [round(v, 1) for j in range(21) for v in (xy[j * 2], xy[j * 2 + 1], wrist_d + hand_z[side][i][j])]
        frames3.append(f3)

    anim3d = {
        "version": 1,
        "id": sign["id"],
        "fps": fps,
        "poster": poster,
        "camera": {"w": w, "h": h, "x": round(ox, 1), "y": round(oy, 1), "unit": round(unit, 3)},
        "head3": "forehead, chin, signer's right eye outer, left eye outer, nose tip (x, y, d each; d relative to the face)",
        "source": {"dataset": "INCLUDE", "file": src_file, "frames": [first, last]},
        "frames": frames3,
    }
    return anim3d, {
        "version": 1,
        "id": sign["id"],
        "fps": fps,
        "poster": poster,
        # Where the body frame sat in the source video (px), so a check can re-render Saathi with the same framing.
        "camera": {"w": w, "h": h, "x": round(ox, 1), "y": round(oy, 1), "unit": round(unit, 3)},
        "source": {"dataset": "INCLUDE", "file": src_file, "frames": [first, last]},
        "frames": out_frames,
    }


def main() -> None:
    dims = json.loads((data.INCLUDE_DIR / "video_dims.json").read_text(encoding="utf-8"))
    library = json.loads((LIB / "library.json").read_text(encoding="utf-8"))
    splits = data._include_splits()
    (LIB / "anim").mkdir(exist_ok=True)
    (LIB / "anim3d").mkdir(exist_ok=True)  # depth too; drives the 3D Saathi in Blender (not served)
    for sign in library["signs"]:
        built = build(sign, dims, splits)
        if built is None:
            print("no signing clip for", sign["id"])
            continue
        anim3d, anim = built
        (LIB / "anim3d" / f"{sign['id']}.json").write_bytes(json.dumps(anim3d, separators=(",", ":")).encode("utf-8"))
        out = LIB / "anim" / f"{sign['id']}.json"
        out.write_bytes(json.dumps(anim, separators=(",", ":")).encode("utf-8"))
        sign["anim"] = f"anim/{sign['id']}.json"
        n = anim["frames"]
        hand_rate = sum(("l" in f) or ("r" in f) for f in n) / len(n)
        print(f"{sign['id']:14} {len(n):3d} frames  hands {hand_rate:4.0%}  {out.stat().st_size / 1e3:5.1f} KB")
    library["attribution"] = (
        "Saathi's sign motions are derived from body and hand landmarks of INCLUDE videos (Sridhar, Ganesan, "
        "Kumar, Khapra; ACM MM 2020), CC BY 4.0 — https://zenodo.org/records/4010759. No video of the signers is shown."
    )
    (LIB / "library.json").write_bytes((json.dumps(library, indent=2, ensure_ascii=False) + "\n").encode("utf-8"))


if __name__ == "__main__":
    main()
