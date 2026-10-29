"""Rigged 3D Saathi for real-time rendering in the browser (three.js): one GLB with a skeleton and one
animation clip per dictionary sign.

The rig: an armature (spine/neck/head, clavicles, upper arms, forearms, hands, 5 metacarpals + 3 bones per finger
on each hand, and brow / eye / mouth bones), with Saathi's parts attached rigidly to the bones (no skin
deformation: each part moves with exactly one bone).

The clips: for each sign in sign-library/anim3d/<id>.json (landmark motion of the INCLUDE recording), target
empties are animated at the tracked joints and the bones aim at them (Damped Track; the hand's roll from the index
knuckle with Locked Track, which sets palm orientation; the head from forehead/chin/eye points, damped). The result
is baked to keyframes (one action per sign, named by sign id) and exported with the glTF exporter.

Bone lengths are fixed (Saathi's proportions), so a clip reproduces each segment's *direction* from the recording,
not its exact length. Correctness of the resulting signs is NOT established by this script: see
frontend/scripts/saathi-eval.mjs (--rig) for the recogniser check, and docs for what is still unvalidated.

Run (Blender 4.5): blender -b --factory-startup -P ml/blender/saathi_rig.py -- [--only id,id] [--out PATH]
Default output: sign-library/saathi-rig/saathi.glb (+ clips.json listing clips, frame counts and fps).
"""

import argparse
import json
import math
import sys
from pathlib import Path

import bmesh
import bpy
import numpy as np
from mathutils import Matrix, Vector

REPO = Path(__file__).resolve().parents[2]
ANIM3D = REPO / "sign-library" / "anim3d"
OUT_DIR = REPO / "sign-library" / "saathi-rig"
S = 0.0038  # metres per motion unit (shoulder width 100 units = 0.38 m)
FINGERS = [[1, 2, 3, 4], [5, 6, 7, 8], [9, 10, 11, 12], [13, 14, 15, 16], [17, 18, 19, 20]]
FINGER_R = [(0.0118, 0.0095), (0.0104, 0.0084), (0.0107, 0.0086), (0.0102, 0.0082), (0.0092, 0.0075)]
SIDES = {"L": 1.0, "R": -1.0}  # signer's left is on the viewer's right (+x)
# Rest arm lengths = medians of the recorded 3D arm segments (all clips). Clips stretch the arm bones to each frame's
# joint distance (so the hands land where the signer's hands were), capped at MAX_STRETCH for tracking glitches.
UPPER, FORE = 88 * S, 83 * S
MAX_STRETCH = 1.3
NECK_TOP = Vector((0, 0.01, 0.13))
HEAD_SIZE = 0.205 * 1.1  # forehead-to-chin, 10% larger than life as in 2D
HC = NECK_TOP + Vector((0, 0, 0.11))  # head centre
K = HEAD_SIZE / 0.205
# Face parts (offsets from the head centre, before scaling by K): bones pivot at the part they move.
FACE = {"brow_L": (0.031, -0.08, 0.024), "brow_R": (-0.031, -0.08, 0.024), "eye_L": (0.031, -0.08, 0.004),
        "eye_R": (-0.031, -0.08, 0.004), "mouth": (0, -0.083, -0.05)}


def to_world(x, y, d):
    return Vector((x * S, d * S, -y * S))


def hexcol(h):
    c = [int(h[i : i + 2], 16) / 255 for i in (1, 3, 5)]
    return (*[x / 12.92 if x <= 0.04045 else ((x + 0.055) / 1.055) ** 2.4 for x in c], 1.0)


def material(name, color, rough=0.6):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes["Principled BSDF"]
    b.inputs["Base Color"].default_value = hexcol(color)
    b.inputs["Roughness"].default_value = rough
    return m


# ---------------------------------------------------------------- statistics from the motion data
def load_all(only):
    files = sorted(ANIM3D.glob("*.json"))
    return {p.stem: json.loads(p.read_text(encoding="utf-8")) for p in files if not only or p.stem in only}


def hand_points(fr, key):
    h = fr.get(key)
    return None if not h else np.array([[h[i * 3] * S, h[i * 3 + 2] * S, -h[i * 3 + 1] * S] for i in range(21)])


def hand_basis(p, side):
    """Columns: x (towards the index side), y (wrist -> middle knuckle), n (so that x, y, n is right-handed)."""
    y = p[9] - p[0]
    y /= np.linalg.norm(y)
    n = np.cross(p[5] - p[0], p[17] - p[0])
    n -= y * n.dot(y)
    n /= np.linalg.norm(n)
    x = np.cross(y, n)
    return np.stack([x, y, n], axis=1)


def canonical_hands(anims):
    """Median hand shape per side in hand coordinates, and median finger segment lengths."""
    out = {}
    for side, key in (("L", "l"), ("R", "r")):
        shapes = []
        for a in anims.values():
            for fr in a["frames"]:
                p = hand_points(fr, key)
                if p is None or np.linalg.norm(p[9] - p[0]) < 1e-4:
                    continue
                R = hand_basis(p, side)
                shapes.append((p - p[0]) @ R)
        shapes = np.array(shapes)
        med = np.median(shapes, axis=0)
        seg = {}
        for chain in FINGERS:
            for a_, b_ in zip(chain[:-1], chain[1:]):
                seg[b_] = float(np.median(np.linalg.norm(shapes[:, b_] - shapes[:, a_], axis=1)))
        out[side] = (med, seg)
    return out


# ---------------------------------------------------------------- armature
def rest_layout(hands):
    """Rest (neutral) joint positions: arms hanging, thumbs forward, palms towards the body."""
    j = {"chest": Vector((0, 0, -0.02)), "neck_top": NECK_TOP}
    for side, sx in SIDES.items():
        sh = Vector((0.19 * sx, 0, 0))
        el = sh + Vector((0.02 * sx, 0, -UPPER))
        wr = el + Vector((0.0, -0.02, -FORE))
        j[f"sh_{side}"], j[f"el_{side}"], j[f"wr_{side}"] = sh, el, wr
        med, seg = hands[side]
        # hand coordinates -> world at rest (columns x, y, n): index side forward (-y), middle knuckle down, n along
        # +x. With palm = -n (left) / +n (right), both palms face the body.
        Rw = np.stack([[0, -1, 0], [0, 0, -1], [1, 0, 0]], axis=1).astype(float)
        pts = {i: wr + Vector((Rw @ med[i]).tolist()) for i in range(21)}
        # Straighten each finger along its first segment's direction with the median segment lengths.
        for chain in FINGERS:
            d = (pts[chain[1]] - pts[chain[0]]).normalized()
            for a_, b_ in zip(chain[:-1], chain[1:]):
                pts[b_] = pts[a_] + d * seg[b_]
        for i, v in pts.items():
            j[f"h{i}_{side}"] = v
        j[f"n_{side}"] = Vector((Rw[:, 2]).tolist())
    return j


def build_armature(J):
    arm_data = bpy.data.armatures.new("SaathiRig")
    arm = bpy.data.objects.new("Saathi", arm_data)
    bpy.context.scene.collection.objects.link(arm)
    bpy.context.view_layer.objects.active = arm
    bpy.ops.object.mode_set(mode="EDIT")
    eb = arm_data.edit_bones

    def bone(name, head, tail, parent=None, roll_to=None, connect=False):
        b = eb.new(name)
        b.head, b.tail = head, tail
        if roll_to is not None:
            b.align_roll(roll_to)
        if parent:
            b.parent = eb[parent]
            b.use_connect = connect
        return b

    front = Vector((0, -1, 0))
    bone("root", Vector((0, 0, -0.6)), J["chest"], roll_to=front)
    bone("neck", J["chest"] + Vector((0, 0.01, 0.02)), J["neck_top"], "root", roll_to=front)
    # Head: Y up, Z towards the camera (so X points to the signer's left = +x).
    bone("head", J["neck_top"], J["neck_top"] + Vector((0, 0, 0.12)), "neck", roll_to=front)
    for name, off in FACE.items():  # Y axis up, so location.y lifts and scale.y opens/closes
        c = HC + Vector(off) * K
        bone(name, c, c + Vector((0, 0, 0.02)), "head", roll_to=front)
    for side in SIDES:
        # Arm bones are siblings under the root (not a chain): each is placed at its tracked joint and the upper arm
        # and forearm stretch lengthwise to the next joint, without scaling the bones after them.
        bone(f"clavicle_{side}", J["chest"] + Vector((0, 0, 0.02)), J[f"sh_{side}"], "root", roll_to=front)
        bone(f"upper_{side}", J[f"sh_{side}"], J[f"el_{side}"], "root", roll_to=front)
        bone(f"elbow_{side}", J[f"el_{side}"], J[f"el_{side}"] + Vector((0, 0, -0.03)), "root", roll_to=front)
        bone(f"fore_{side}", J[f"el_{side}"], J[f"wr_{side}"], "root", roll_to=front)
        n = J[f"n_{side}"]
        bone(f"hand_{side}", J[f"wr_{side}"], J[f"h9_{side}"], "root", roll_to=n)
        for k, chain in enumerate(FINGERS):
            bone(f"mc{k}_{side}", J[f"wr_{side}"], J[f"h{chain[0]}_{side}"], f"hand_{side}", roll_to=n)
            parent = f"mc{k}_{side}"
            for s, (a_, b_) in enumerate(zip(chain[:-1], chain[1:])):
                name = f"f{k}{s}_{side}"
                bone(name, J[f"h{a_}_{side}"], J[f"h{b_}_{side}"], parent, roll_to=n, connect=True)
                parent = name
    bpy.ops.object.mode_set(mode="OBJECT")
    return arm


# ---------------------------------------------------------------- body parts, attached to bones
def mesh_obj(name, bm, mat, smooth=True, subdiv=0):
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    obj = bpy.data.objects.new(name, me)
    obj.data.materials.append(mat)
    bpy.context.scene.collection.objects.link(obj)
    for p in me.polygons:
        p.use_smooth = smooth
    if subdiv:
        m = obj.modifiers.new("subd", "SUBSURF")
        m.levels = m.render_levels = subdiv
    return obj


def sphere(name, mat, radius_xyz, loc, seg=20):
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=seg, v_segments=seg // 2 + 2, radius=1)
    bmesh.ops.scale(bm, vec=radius_xyz, verts=bm.verts)
    bmesh.ops.translate(bm, vec=loc, verts=bm.verts)
    return mesh_obj(name, bm, mat)


def capsule(name, mat, a, b, r1, r2, seg=16, balls=True):
    """A tapered tube from a to b, with balls at both ends unless balls=False (world coordinates)."""
    v = b - a
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=False, segments=seg, radius1=r1, radius2=r2, depth=v.length)
    bmesh.ops.translate(bm, vec=(0, 0, v.length / 2), verts=bm.verts)
    rot = Vector((0, 0, 1)).rotation_difference(v.normalized()).to_matrix().to_4x4()
    bmesh.ops.transform(bm, matrix=Matrix.Translation(a) @ rot, verts=bm.verts)
    for c, r in ((a, r1), (b, r2)) if balls else ():
        s = bmesh.ops.create_uvsphere(bm, u_segments=seg, v_segments=seg // 2 + 2, radius=r * 1.02)
        bmesh.ops.translate(bm, vec=c, verts=s["verts"])
    return mesh_obj(name, bm, mat)


def attach(obj, arm, bone_name):
    """Parent obj to a bone keeping its rest world placement (rigid attachment)."""
    world = obj.matrix_world.copy()
    obj.parent = arm
    obj.parent_type = "BONE"
    obj.parent_bone = bone_name
    pb = arm.pose.bones[bone_name]
    tail = arm.matrix_world @ pb.matrix @ Matrix.Translation((0, pb.bone.length, 0))
    obj.matrix_parent_inverse = tail.inverted()
    obj.matrix_basis = world


def build_body(arm, J):
    M = {
        "skin": material("skin", "#b97a52", 0.55),
        "palm": material("palm", "#e6b08c", 0.6),
        "top": material("kurta", "#1e40af", 0.85),
        "cuff": material("cuff", "#f4f4f2", 0.7),
        "hair": material("hair", "#2a1d17", 0.45),
        "ink": material("ink", "#1b1d2e", 0.3),
        "white": material("eyewhite", "#ffffff", 0.3),
        "lips": material("lips", "#7e2f38", 0.5),
        "gold": material("gold", "#e2b04a", 0.3),
    }
    # Torso (kurta) on the root bone.
    rings = [(0.07, 0.07, 0.06), (0.055, 0.12, 0.08), (0.025, 0.195, 0.1), (-0.03, 0.205, 0.105), (-0.12, 0.19, 0.11),
             (-0.26, 0.17, 0.11), (-0.42, 0.18, 0.115), (-0.75, 0.2, 0.12)]
    bm = bmesh.new()
    n, prev = 32, None
    for z, rx, ry in rings:
        ring = [bm.verts.new((rx * math.cos(2 * math.pi * i / n), ry * math.sin(2 * math.pi * i / n), z)) for i in range(n)]
        if prev:
            for i in range(n):
                bm.faces.new((prev[i], prev[(i + 1) % n], ring[(i + 1) % n], ring[i]))
        else:
            bm.faces.new(ring[::-1])
        prev = ring
    bm.faces.new(prev)
    attach(mesh_obj("torso", bm, M["top"], subdiv=1), arm, "root")
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=False, segments=32, radius1=0.072, radius2=0.072, depth=0.012)
    bmesh.ops.translate(bm, vec=(0, -0.004, 0.068), verts=bm.verts)
    attach(mesh_obj("collar", bm, M["cuff"]), arm, "root")
    attach(capsule("neck", M["skin"], J["chest"] + Vector((0, 0.01, 0.02)), J["neck_top"] + Vector((0, 0, 0.03)), 0.058, 0.052), arm, "neck")

    # Head parts (head bone). Head centre a little above the neck top.
    hc, k = HC, K
    def hs(name, mat, r, off, bone="head", seg=24):  # noqa: E306
        attach(sphere(name, mat, tuple(x * k for x in r), hc + Vector(off) * k, seg), arm, bone)
    hs("skull", M["skin"], (0.078, 0.088, 0.105), (0, 0, 0), seg=32)
    hs("hair", M["hair"], (0.084, 0.093, 0.1), (0, 0.012, 0.022), seg=32)
    hs("hairback", M["hair"], (0.07, 0.06, 0.08), (0, 0.05, -0.005))
    for i in range(5):
        hs(f"braid{i}", M["hair"], (0.026, 0.024, 0.03), (-0.06 - i * 0.012, 0.05, -0.08 - i * 0.048), seg=16)
    hs("nose", M["skin"], (0.012, 0.014, 0.018), (0, -0.09, -0.018), seg=16)
    for side, sx in (("L", 1), ("R", -1)):
        hs(f"ear_{side}", M["skin"], (0.012, 0.02, 0.026), (sx * 0.078, 0.005, -0.005), seg=16)
        hs(f"earring_{side}", M["gold"], (0.006, 0.006, 0.006), (sx * 0.08, -0.002, -0.034), seg=12)
        hs(f"eyewhite_{side}", M["white"], (0.016, 0.008, 0.012), (sx * 0.031, -0.077, 0.004), f"eye_{side}", 20)
        hs(f"iris_{side}", M["ink"], (0.009, 0.006, 0.011), (sx * 0.031, -0.083, 0.004), f"eye_{side}", 20)
        a = hc + Vector((sx * 0.016, -0.083, 0.026)) * k
        b = hc + Vector((sx * 0.046, -0.076, 0.022)) * k
        attach(capsule(f"brow_{side}", M["hair"], a, b, 0.004 * k, 0.0025 * k, 10), arm, f"brow_{side}")
    hs("lips", M["lips"], (0.022, 0.008, 0.0065), (0, -0.083, -0.05), "mouth", 20)

    for side in SIDES:
        sh, el, wr = J[f"sh_{side}"], J[f"el_{side}"], J[f"wr_{side}"]
        attach(sphere(f"shoulder_{side}", M["top"], (0.047,) * 3, sh), arm, f"clavicle_{side}")
        # Tubes on the stretching bones; round joints on bones that never scale.
        attach(capsule(f"upper_{side}", M["top"], sh, el, 0.047, 0.04, balls=False), arm, f"upper_{side}")
        attach(sphere(f"elbowball_{side}", M["top"], (0.041,) * 3, el), arm, f"elbow_{side}")
        cuff_end = el.lerp(wr, 0.24)
        attach(capsule(f"cuff_{side}", M["cuff"], el, cuff_end, 0.043, 0.038, balls=False), arm, f"fore_{side}")
        attach(capsule(f"fore_{side}", M["skin"], cuff_end, wr, 0.033, 0.025, balls=False), arm, f"fore_{side}")
        attach(sphere(f"cuffball_{side}", M["cuff"], (0.0435,) * 3, el), arm, f"elbow_{side}")
        attach(sphere(f"wristball_{side}", M["skin"], (0.0255,) * 3, wr), arm, f"hand_{side}")
        # Palm: a thick pad through the wrist and the finger roots, palm side lighter.
        nrm = J[f"n_{side}"]
        palm_dir = -nrm if side == "L" else nrm  # see hand_basis / frontend/lib/signs/palm.ts
        ring = [J[f"wr_{side}"], J[f"h0_{side}"].lerp(J[f"h1_{side}"], 0.7)] + [J[f"h{i}_{side}"] for i in (5, 9, 13, 17)]
        bm = bmesh.new()
        back = [bm.verts.new(q - palm_dir * 0.012) for q in ring]
        frontv = [bm.verts.new(q + palm_dir * 0.012) for q in ring]
        f_front = bm.faces.new(frontv)
        f_back = bm.faces.new(back[::-1])
        for i in range(len(ring)):
            bm.faces.new((back[i], back[(i + 1) % len(ring)], frontv[(i + 1) % len(ring)], frontv[i]))
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
        palm = mesh_obj(f"palm_{side}", bm, M["skin"])
        palm.data.materials.append(M["palm"])
        for p in palm.data.polygons:  # the face whose normal points to the palm side gets the palm tint
            if p.normal.dot(palm_dir) > 0.9:
                p.material_index = 1
        bev = palm.modifiers.new("round", "BEVEL")
        bev.width, bev.segments, bev.limit_method = 0.007, 3, "NONE"
        attach(palm, arm, f"hand_{side}")
        for k_, chain in enumerate(FINGERS):
            rb, rt = FINGER_R[k_]
            for s, (a_, b_) in enumerate(zip(chain[:-1], chain[1:])):
                a, b = J[f"h{a_}_{side}"], J[f"h{b_}_{side}"]
                if k_ == 0 and s == 0:
                    a = J[f"wr_{side}"].lerp(a, 0.55)
                obj = capsule(f"finger{k_}{s}_{side}", M["skin"], a, b, rb + (rt - rb) * s / 3, rb + (rt - rb) * (s + 1) / 3, 12)
                attach(obj, arm, f"f{k_}{s}_{side}")
    # Bake modifiers into meshes so the GLB carries exactly what is rendered here.
    return M


# ---------------------------------------------------------------- retargeting constraints
def add_targets(arm, J):
    """Empties at tracked joints, and aim constraints from bones to them."""
    E = {}

    def empty(name, loc):
        e = bpy.data.objects.new(name, None)
        e.location = loc
        bpy.context.scene.collection.objects.link(e)
        E[name] = e
        return e

    for side in SIDES:
        empty(f"T_sh_{side}", J[f"sh_{side}"])
        empty(f"T_el_{side}", J[f"el_{side}"])
        empty(f"T_wr_{side}", J[f"wr_{side}"])
        for i in range(21):
            empty(f"T_h{i}_{side}", J[f"h{i}_{side}"])
    empty("T_head_up", J["neck_top"] + Vector((0, 0, 1)))
    empty("T_head_x", J["neck_top"] + Vector((1, 0, 0)))

    pbs = arm.pose.bones

    def damped(bname, target, influence=1.0):
        c = pbs[bname].constraints.new("DAMPED_TRACK")
        c.target, c.track_axis, c.influence = E[target], "TRACK_Y", influence

    def locked(bname, target, axis, influence=1.0):
        c = pbs[bname].constraints.new("LOCKED_TRACK")
        c.target, c.lock_axis, c.track_axis, c.influence = E[target], "LOCK_Y", axis, influence

    def at(bname, target):
        pbs[bname].constraints.new("COPY_LOCATION").target = E[target]

    def stretch(bname, target):
        c = pbs[bname].constraints.new("STRETCH_TO")
        c.target, c.volume, c.rest_length = E[target], "NO_VOLUME", pbs[bname].bone.length

    for side in SIDES:
        damped(f"clavicle_{side}", f"T_sh_{side}")
        at(f"upper_{side}", f"T_sh_{side}")
        stretch(f"upper_{side}", f"T_el_{side}")
        at(f"elbow_{side}", f"T_el_{side}")
        at(f"fore_{side}", f"T_el_{side}")
        stretch(f"fore_{side}", f"T_wr_{side}")
        at(f"hand_{side}", f"T_wr_{side}")
        damped(f"hand_{side}", f"T_h9_{side}")
        # Palm orientation: turn the hand about its own axis so its x axis points at the index knuckle side.
        pb = pbs[f"hand_{side}"]
        x_axis = (arm.matrix_world @ pb.matrix).to_3x3() @ Vector((1, 0, 0))
        toward_index = J[f"h5_{side}"] - J[f"h9_{side}"]
        locked(f"hand_{side}", f"T_h5_{side}", "TRACK_X" if x_axis.dot(toward_index) > 0 else "TRACK_NEGATIVE_X")
        for k, chain in enumerate(FINGERS):
            for s, b_ in enumerate(chain[1:]):
                damped(f"f{k}{s}_{side}", f"T_h{b_}_{side}")
    damped("head", "T_head_up", 0.6)  # damped: face depth is noisy and a calm head reads better
    locked("head", "T_head_x", "TRACK_X", 0.6)
    return E


def fallback_hand(wr, el, side, hands):
    """Untracked hand: the median hand shape, hanging along the forearm."""
    med, _ = hands[side]
    y = (wr - el).normalized()
    fwd = Vector((0, -1, 0))
    x = (fwd - y * fwd.dot(y)).normalized()
    n = x.cross(y)
    R = np.array([x, y, n]).T
    return [wr + Vector((R @ med[i]).tolist()) for i in range(21)]


def animate_targets(E, anim, hands, J):
    frames = anim["frames"]
    head_c = J["neck_top"]
    track = {name: [] for name in E}
    for fr in frames:
        a = fr["a"]
        for side, o in (("L", 0), ("R", 9)):
            sh, el, wr = (to_world(*a[o + k * 3 : o + k * 3 + 3]) for k in range(3))
            # Cap implausible lengths (tracking glitches); the hand moves with its wrist.
            wr_raw = wr.copy()
            if (el - sh).length > UPPER * MAX_STRETCH:
                shift = sh + (el - sh).normalized() * UPPER * MAX_STRETCH - el
                el, wr = el + shift, wr + shift
            if (wr - el).length > FORE * MAX_STRETCH:
                wr = el + (wr - el).normalized() * FORE * MAX_STRETCH
            # Data origin is the median shoulder midpoint = rig origin; shoulders sit at the same height.
            track[f"T_sh_{side}"].append(sh)
            track[f"T_el_{side}"].append(el)
            track[f"T_wr_{side}"].append(wr)
            h = fr.get("l" if side == "L" else "r")
            pts = [to_world(*h[i * 3 : i * 3 + 3]) + (wr - wr_raw) for i in range(21)] if h else fallback_hand(wr, el, side, hands)
            for i in range(21):
                track[f"T_h{i}_{side}"].append(pts[i])
        if "h" in fr:
            P = [Vector((fr["h"][i * 3] * S, fr["h"][i * 3 + 2] * S, -fr["h"][i * 3 + 1] * S)) for i in range(5)]
            up = (P[0] - P[1]).normalized()
            right = (P[3] - P[2]).normalized()
        else:
            up, right = Vector((0, 0, 1)), Vector((1, 0, 0))
        track["T_head_up"].append(head_c + up)
        track["T_head_x"].append(head_c + right)
    for name, vals in track.items():
        e = E[name]
        e.animation_data_clear()
        # keyframe_insert creates the action *and* binds its slot (Blender 4.4+); an action made with
        # actions.new() + fcurves.new() is left without a slot and does not animate the object.
        e.location = vals[0]
        e.keyframe_insert("location", frame=1)
        act = e.animation_data.action
        for fc in act.fcurves:
            if fc.data_path != "location":
                continue
            fc.keyframe_points.add(len(vals) - 1)
            co = []
            for f, v in enumerate(vals):
                co += [f + 1, v[fc.array_index]]
            fc.keyframe_points.foreach_set("co", co)
            for kp in fc.keyframe_points:
                kp.interpolation = "LINEAR"
            fc.update()
    return len(frames)


def bake(arm, sid, n_frames, anim):
    sc = bpy.context.scene
    sc.frame_start, sc.frame_end = 1, n_frames
    sc.render.fps = round(anim["fps"])
    bpy.context.view_layer.objects.active = arm
    arm.select_set(True)
    bpy.ops.object.mode_set(mode="POSE")
    bpy.ops.pose.select_all(action="SELECT")
    arm.animation_data_create()
    arm.animation_data.action = None
    bpy.ops.nla.bake(frame_start=1, frame_end=n_frames, only_selected=True, visual_keying=True,
                     clear_constraints=False, use_current_action=False, bake_types={"POSE"})
    act = arm.animation_data.action
    act.name = sid
    # Face: brows (lift), eyes (blink) and mouth (open), relative to this signer's neutral (as in 2D).
    pbs = arm.pose.bones
    for f, fr in enumerate(anim["frames"], start=1):
        fv = fr["f"]
        for side, val in (("L", fv[6]), ("R", fv[7])):
            pbs[f"brow_{side}"].location = (0, max(-0.006, min(0.012, val / 100 * 0.2)), 0)
            pbs[f"brow_{side}"].keyframe_insert("location", frame=f)
            s = 0.15 if fv[8] < 45 else 1.0
            pbs[f"eye_{side}"].scale = (1, s, 1)
            pbs[f"eye_{side}"].keyframe_insert("scale", frame=f)
        mo = max(0.0, min(0.03, (fv[4] - 3) / 100 * 0.2))
        pbs["mouth"].scale = (1, 1 + mo * 30, 1)
        pbs["mouth"].keyframe_insert("scale", frame=f)
    act.use_fake_user = True
    track = arm.animation_data.nla_tracks.new()
    track.name = sid
    track.strips.new(sid, 1, act)
    track.mute = True
    arm.animation_data.action = None
    bpy.ops.object.mode_set(mode="OBJECT")


def main():
    argv = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    ap = argparse.ArgumentParser()
    ap.add_argument("--only", default="")
    ap.add_argument("--out", default=str(OUT_DIR / "saathi.glb"))
    args = ap.parse_args(argv)
    only = set(args.only.split(",")) if args.only else None

    bpy.ops.wm.read_factory_settings(use_empty=True)
    anims = load_all(only)
    all_for_stats = load_all(None)
    hands = canonical_hands(all_for_stats)
    J = rest_layout(hands)
    arm = build_armature(J)
    build_body(arm, J)
    E = add_targets(arm, J)
    clips = []
    for sid, anim in anims.items():
        n = animate_targets(E, anim, hands, J)
        bake(arm, sid, n, anim)
        clips.append({"id": sid, "clip": sid, "frames": n, "fps": anim["fps"], "source": anim["source"]})
        print(f"baked {sid}: {n} frames", flush=True)
    # Export only the rig and its parts (not the target empties), with every baked action as a clip.
    for e in E.values():
        bpy.data.objects.remove(e)
    for pb in arm.pose.bones:
        for c in list(pb.constraints):
            pb.constraints.remove(c)
        pb.location, pb.rotation_quaternion, pb.scale = (0, 0, 0), (1, 0, 0, 0), (1, 1, 1)
    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    bpy.ops.export_scene.gltf(
        filepath=str(out), export_format="GLB", export_apply=True, export_animations=True,
        export_animation_mode="ACTIONS", export_force_sampling=True, export_frame_range=False,
        export_anim_slide_to_zero=True, export_def_bones=False, export_optimize_animation_size=True,
        export_yup=True, export_materials="EXPORT",
    )
    (out.parent / "clips.json").write_text(json.dumps({"version": 1, "model": out.name, "clips": clips}, indent=2), encoding="utf-8")
    print(f"exported {out} ({out.stat().st_size / 1e6:.2f} MB), {len(clips)} clips", flush=True)


main()
