"""3D Saathi: build the character in Blender and render signs from sign-library/anim3d/<id>.json.

Saathi is made of smooth parts placed from the motion every frame (no skinning): each arm and finger segment
runs exactly between two tracked joints, so seen from the front the hands match the recorded skeleton. The look
follows the 2D Saathi: deep-blue kurta, white cuffs at the elbow, braid, lighter palms (so the viewer can tell
which way a hand faces).

Run with Blender 4.5 (EEVEE, GPU):
  blender -b --factory-startup -P ml/blender/saathi3d.py -- --mode web    [--only id,id] [--out DIR] [--poster-only]
  blender -b --factory-startup -P ml/blender/saathi3d.py -- --mode camera [--only id,id] [--out DIR]
  web:    480x480 frames framed like the 2D player (for the website videos);
  camera: 640x360 frames framed like the source video (for the recogniser checks).
Writes PNG frames to <out>/<id>/f0000.png ...; encoding is done by ml/tools/render_saathi3d.py.
"""

import argparse
import json
import math
import sys
from pathlib import Path

import bmesh
import bpy
from mathutils import Matrix, Vector

REPO = Path(__file__).resolve().parents[2]
ANIM3D = REPO / "sign-library" / "anim3d"
S = 0.0038  # metres per motion unit (shoulder width 100 units = 0.38 m)
HEAD_SCALE = 1.1  # a little larger than life, as in 2D, so the face reads at small sizes
FINGERS = [[1, 2, 3, 4], [5, 6, 7, 8], [9, 10, 11, 12], [13, 14, 15, 16], [17, 18, 19, 20]]
FINGER_R = [(0.0118, 0.0095), (0.0104, 0.0084), (0.0107, 0.0086), (0.0102, 0.0082), (0.0092, 0.0075)]  # base, tip


def hexcol(h: str, a: float = 1.0):
    """sRGB hex -> linear RGBA."""
    c = [int(h[i : i + 2], 16) / 255 for i in (1, 3, 5)]
    lin = [x / 12.92 if x <= 0.04045 else ((x + 0.055) / 1.055) ** 2.4 for x in c]
    return (*lin, a)


def material(name: str, color: str, rough: float = 0.6, sss: float = 0.0, metal: float = 0.0):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes["Principled BSDF"]
    b.inputs["Base Color"].default_value = hexcol(color)
    b.inputs["Roughness"].default_value = rough
    b.inputs["Metallic"].default_value = metal
    if sss:
        b.inputs["Subsurface Weight"].default_value = sss
        b.inputs["Subsurface Radius"].default_value = (0.6, 0.25, 0.15)
        b.inputs["Subsurface Scale"].default_value = 0.01
    return m


def to_world(x: float, y: float, d: float) -> Vector:
    """Motion units (x right, y down, d away from the camera) -> Blender metres (x right, y away, z up)."""
    return Vector((x * S, d * S, -y * S))


def smooth_obj(obj, subdiv: int = 0):
    for p in obj.data.polygons:
        p.use_smooth = True
    if subdiv:
        mod = obj.modifiers.new("subd", "SUBSURF")
        mod.levels = mod.render_levels = subdiv
    return obj


def link(obj, parent=None):
    bpy.context.scene.collection.objects.link(obj)
    if parent:
        obj.parent = parent
    return obj


def sphere(name, r, mat, seg=24):
    me = bpy.data.meshes.new(name)
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=seg, v_segments=seg // 2 + 2, radius=1)
    bm.to_mesh(me)
    bm.free()
    obj = bpy.data.objects.new(name, me)
    obj.data.materials.append(mat)
    obj.scale = (r, r, r)
    return link(smooth_obj(obj))


def cone(name, r1, r2, mat, seg=20):
    """Unit-length tapered cylinder along +Z from z=0 (radius r1) to z=1 (radius r2)."""
    me = bpy.data.meshes.new(name)
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=False, segments=seg, radius1=r1, radius2=r2, depth=1)  # balls cover the ends
    bmesh.ops.translate(bm, verts=bm.verts, vec=(0, 0, 0.5))
    bm.to_mesh(me)
    bm.free()
    obj = bpy.data.objects.new(name, me)
    obj.data.materials.append(mat)
    return link(smooth_obj(obj))


def place_between(obj, a: Vector, b: Vector):
    v = b - a
    length = max(v.length, 1e-5)
    rot = Vector((0, 0, 1)).rotation_difference(v.normalized()).to_matrix().to_4x4()
    obj.matrix_world = Matrix.Translation(a) @ rot @ Matrix.Diagonal((1, 1, length, 1))


class Limb:
    """A tapered segment with a ball at its far end."""

    def __init__(self, name, r1, r2, mat, ball=True):
        self.seg = cone(name, r1, r2, mat)
        self.ball = sphere(name + "_j", r2 * 1.03, mat, 16) if ball else None

    def set(self, a: Vector, b: Vector, show=True):
        place_between(self.seg, a, b)
        self.seg.hide_render = not show
        if self.ball:
            self.ball.location = b
            self.ball.hide_render = not show


class Hand:
    def __init__(self, side: str, mats):
        self.side = side
        self.skin, self.palm_mat = mats["skin"], mats["palm"]
        # Three tapering segments per finger, thick at the root.
        self.fingers = [
            [Limb(f"{side}f{k}{j}", rb + (rt - rb) * j / 3, rb + (rt - rb) * (j + 1) / 3, self.skin) for j in range(3)]
            for k, (rb, rt) in enumerate(FINGER_R)
        ]
        self.knuckles = [sphere(f"{side}k{k}", FINGER_R[k][0], self.skin, 16) for k in range(5)]
        # Palm: a thick pad through the wrist and the five finger roots; palm-side faces get the lighter tint.
        self.ring = [0, 1, 5, 9, 13, 17]
        me = bpy.data.meshes.new(f"{side}palm")
        n = len(self.ring)
        verts = [(0, 0, 0)] * (2 * n)
        faces = [list(range(n))[::-1], list(range(n, 2 * n))] + [[i, (i + 1) % n, n + (i + 1) % n, n + i] for i in range(n)]
        me.from_pydata(verts, [], faces)
        self.palm = bpy.data.objects.new(f"{side}palm", me)
        self.palm.data.materials.append(self.skin)
        self.palm.data.materials.append(self.palm_mat)
        self.palm.data.polygons[1].material_index = 1  # front cap: the palm side
        link(smooth_obj(self.palm))
        bevel = self.palm.modifiers.new("round", "BEVEL")  # rounded edges without shrinking the pad
        bevel.width = 0.007
        bevel.segments = 4
        bevel.limit_method = "NONE"
        self.fist = sphere(f"{side}fist", 1, self.skin, 20)

    def hide(self, hidden: bool):
        for chain in self.fingers:
            for limb in chain:
                limb.seg.hide_render = limb.ball.hide_render = hidden
        for o in self.knuckles + [self.palm]:
            o.hide_render = hidden

    def set(self, pts, elbow: Vector, wrist: Vector):
        if pts is None:
            # Not tracked: a relaxed closed hand along the forearm.
            self.hide(True)
            v = (wrist - elbow).normalized()
            self.fist.hide_render = False
            rot = Vector((0, 0, 1)).rotation_difference(v).to_matrix().to_4x4()
            self.fist.matrix_world = Matrix.Translation(wrist + v * 0.04) @ rot @ Matrix.Diagonal((0.035, 0.028, 0.05, 1))
            return
        self.hide(False)
        self.fist.hide_render = True
        p = [to_world(*pts[i * 3 : i * 3 + 3]) for i in range(21)]
        for k, chain in enumerate(FINGERS):
            root = p[chain[0]] if k else p[0].lerp(p[1], 0.55)
            joints = [root] + [p[i] for i in chain[1:]]
            for j in range(3):
                self.fingers[k][j].set(joints[j], joints[j + 1])
            self.knuckles[k].location = joints[0]
        # Palm normal: towards the palm side (see frontend/lib/signs/palm.ts for the same rule in 2D).
        a, b = p[5] - p[0], p[17] - p[0]
        nrm = a.cross(b).normalized()
        if self.side == "L":
            nrm = -nrm
        t = 0.012
        me = self.palm.data
        for i, idx in enumerate(self.ring):
            q = p[idx] if idx != 1 else p[0].lerp(p[1], 0.7)
            me.vertices[i].co = q - nrm * t  # back
            me.vertices[len(self.ring) + i].co = q + nrm * t  # palm side
        me.update()


def build_character():
    mats = {
        "skin": material("skin", "#b97a52", 0.55, 0.08),
        "palm": material("palm", "#e6b08c", 0.6, 0.08),
        "top": material("kurta", "#1e40af", 0.85),
        "cuff": material("cuff", "#f4f4f2", 0.7),
        "hair": material("hair", "#2a1d17", 0.45),
        "ink": material("ink", "#1b1d2e", 0.3),
        "white": material("eyewhite", "#ffffff", 0.3),
        "lips": material("lips", "#7e2f38", 0.5),
        "mouth": material("mouth", "#4a1d24", 0.8),
        "gold": material("gold", "#e2b04a", 0.3, metal=1.0),
    }
    c = {}
    # Torso (kurta): lofted rings from the shoulders down, in a parent that follows the shoulders.
    c["torso_root"] = link(bpy.data.objects.new("torso_root", None))
    rings = [  # (z below the shoulder line, half width, half depth) in metres
        (0.07, 0.07, 0.06), (0.055, 0.12, 0.08), (0.025, 0.195, 0.1), (-0.03, 0.205, 0.105), (-0.12, 0.19, 0.11),
        (-0.26, 0.17, 0.11), (-0.42, 0.18, 0.115), (-0.75, 0.2, 0.12),
    ]
    me = bpy.data.meshes.new("torso")
    bm = bmesh.new()
    n = 32
    prev = None
    for z, rx, ry in rings:
        ring = [bm.verts.new((rx * math.cos(2 * math.pi * i / n), ry * math.sin(2 * math.pi * i / n), z)) for i in range(n)]
        if prev:
            for i in range(n):
                bm.faces.new((prev[i], prev[(i + 1) % n], ring[(i + 1) % n], ring[i]))
        else:
            bm.faces.new(ring[::-1])
        prev = ring
    bm.faces.new(prev)
    bm.to_mesh(me)
    bm.free()
    torso = link(bpy.data.objects.new("torso", me), c["torso_root"])
    torso.data.materials.append(mats["top"])
    smooth_obj(torso, 2)
    # Collar: a thin white band around the neck opening, and the placket.
    bpy.ops.mesh.primitive_torus_add(major_radius=1, minor_radius=0.085, major_segments=40, minor_segments=10)
    collar = bpy.context.active_object
    collar.name = "collar"
    collar.parent = c["torso_root"]
    collar.scale = (0.072, 0.062, 0.07)
    collar.location = (0, -0.004, 0.068)
    collar.data.materials.append(mats["cuff"])
    smooth_obj(collar)
    placket = cone("placket", 0.004, 0.004, mats["cuff"], 8)
    placket.parent = c["torso_root"]
    placket.matrix_parent_inverse = Matrix()
    place_between(placket, Vector((0, -0.095, 0.0)), Vector((0, -0.103, -0.09)))
    c["neck"] = Limb("neck", 0.058, 0.052, mats["skin"], ball=False)

    # Head: an empty carrying everything on the face; sizes in metres for a 0.2 m forehead-to-chin face.
    head = c["head"] = link(bpy.data.objects.new("head", None))
    skull = sphere("skull", 1, mats["skin"], 32)
    skull.parent = head
    skull.scale = (0.078, 0.088, 0.105)
    hair = sphere("hair", 1, mats["hair"], 32)
    hair.parent = head
    hair.scale = (0.084, 0.093, 0.1)
    hair.location = (0, 0.012, 0.022)
    bun = sphere("hairback", 1, mats["hair"], 24)  # fuller hair at the back
    bun.parent = head
    bun.scale = (0.07, 0.06, 0.08)
    bun.location = (0, 0.05, -0.005)
    for k in range(5):  # braid over the signer's right shoulder, behind
        b = sphere(f"braid{k}", 1, mats["hair"], 16)
        b.parent = head
        b.scale = (0.026, 0.024, 0.03)
        b.location = (-0.06 - k * 0.012, 0.05, -0.08 - k * 0.048)
    for sx in (-1, 1):
        ear = sphere(f"ear{sx}", 1, mats["skin"], 16)
        ear.parent = head
        ear.scale = (0.012, 0.02, 0.026)
        ear.location = (sx * 0.078, 0.005, -0.005)
        ring = sphere(f"earring{sx}", 0.006, mats["gold"], 12)
        ring.parent = head
        ring.location = (sx * 0.08, -0.002, -0.034)
        white = sphere(f"eyew{sx}", 1, mats["white"], 20)
        white.parent = head
        white.scale = (0.016, 0.008, 0.012)
        white.location = (sx * 0.031, -0.077, 0.004)
        iris = sphere(f"eye{sx}", 1, mats["ink"], 20)
        iris.parent = head
        iris.scale = (0.009, 0.006, 0.011)
        iris.location = (sx * 0.031, -0.083, 0.004)
        c[f"eye{sx}"] = (white, iris)
        brow = cone(f"brow{sx}", 0.004, 0.0025, mats["hair"], 10)
        brow.parent = head
        c[f"brow{sx}"] = brow
    nose = sphere("nose", 1, mats["skin"], 16)
    nose.parent = head
    nose.scale = (0.012, 0.014, 0.018)
    nose.location = (0, -0.09, -0.018)
    lips = sphere("lips", 1, mats["lips"], 20)
    lips.parent = head
    c["lips"] = lips
    mouth = sphere("mouth", 1, mats["mouth"], 20)
    mouth.parent = head
    c["mouth"] = mouth

    for side in ("L", "R"):
        c[f"upper{side}"] = Limb(f"upper{side}", 0.047, 0.04, mats["top"])
        c[f"shoulder{side}"] = sphere(f"shoulder{side}", 0.047, mats["top"])
        c[f"cuff{side}"] = Limb(f"cuff{side}", 0.043, 0.038, mats["cuff"], ball=False)
        c[f"fore{side}"] = Limb(f"fore{side}", 0.033, 0.025, mats["skin"])
        c[f"hand{side}"] = Hand(side, mats)
    return c


def pose(c, fr):
    a = fr["a"]
    j = {
        side: [to_world(*a[o + k * 3 : o + k * 3 + 3]) for k in range(3)]
        for side, o in (("L", 0), ("R", 9))
    }
    sL, sR = j["L"][0], j["R"][0]
    mid = (sL + sR) / 2
    across = sL - sR
    tilt = math.atan2(across.z, across.x)
    width = across.length / 0.38
    c["torso_root"].matrix_world = Matrix.Translation(mid) @ Matrix.Rotation(tilt, 4, "Y").inverted() @ Matrix.Diagonal((width, 1, 1, 1))

    f = fr["f"]
    hx, hy, size = f[0], f[1], f[2]
    centre = to_world(hx, hy, -4)
    scale = size * S / 0.205 * HEAD_SCALE
    if "h" in fr:
        h = fr["h"]
        P = [Vector((h[i * 3] * S, h[i * 3 + 2] * S, -h[i * 3 + 1] * S)) for i in range(5)]
        up = (P[0] - P[1]).normalized()
        right = (P[3] - P[2]).normalized()
        right = (right - up * right.dot(up)).normalized()
        back = up.cross(right)
        rot = Matrix((right, back, up)).transposed().to_4x4()
        # Damp the head turn: face depth is noisy, and a calm head reads better.
        q = Matrix.Identity(3).to_quaternion().slerp(rot.to_quaternion(), 0.6)
        rot = q.to_matrix().to_4x4()
    else:
        rot = Matrix.Rotation(math.radians(-f[3]), 4, "Y")
    c["head"].matrix_world = Matrix.Translation(centre) @ rot @ Matrix.Diagonal((scale, scale, scale, 1))
    chin = c["head"].matrix_world @ Vector((0, 0.0, -0.09))
    c["neck"].set(mid + Vector((0, 0.01, 0.02)), chin)

    # Face controls (same meaning as in 2D): brows relative to neutral, eye openness, mouth.
    clamp = lambda v, lo, hi: max(lo, min(hi, v))  # noqa: E731
    for sx, val in ((1, f[6]), (-1, f[7])):  # +x = viewer's right = signer's left
        lift = clamp(val / 100 * 0.2, -0.006, 0.012)
        brow = c[f"brow{sx}"]
        a_, b_ = Vector((sx * 0.016, -0.083, 0.026 + lift)), Vector((sx * 0.046, -0.076, 0.022 + lift))
        v = b_ - a_
        brow.matrix_parent_inverse = Matrix()
        brow.matrix_basis = Matrix.Translation(a_) @ Vector((0, 0, 1)).rotation_difference(v.normalized()).to_matrix().to_4x4() @ Matrix.Diagonal((1, 1, v.length, 1))
        white, iris = c[f"eye{sx}"]
        open_ = 0.15 if f[8] < 45 else 1.0
        white.scale.z = 0.012 * open_
        iris.scale.z = 0.011 * open_
    mouth_open = clamp((f[4] - 3) / 100 * 0.2, 0, 0.03)
    half = clamp(f[5] / 100 * 0.2 / 2, 0.016, 0.028)
    c["lips"].scale = (half, 0.008, 0.0055 + mouth_open * 0.5)
    c["lips"].location = (0, -0.083, -0.05)
    c["mouth"].scale = (half * 0.8, 0.006, max(mouth_open * 0.5, 0.0001))
    c["mouth"].location = (0, -0.088, -0.05)
    c["mouth"].hide_render = mouth_open < 0.004

    for side, key in (("L", "l"), ("R", "r")):
        s, e, w = j[side]
        pts = fr.get(key)
        if pts:
            w = to_world(*pts[0:3])
        c[f"shoulder{side}"].location = s
        c[f"upper{side}"].set(s, e)
        cuff_end = e.lerp(w, 0.24)
        c[f"cuff{side}"].set(e, cuff_end)
        c[f"fore{side}"].set(cuff_end, w)
        c[f"hand{side}"].set(pts, e, w)


def setup_scene(mode: str):
    sc = bpy.context.scene
    sc.render.engine = "BLENDER_EEVEE_NEXT"
    sc.eevee.taa_render_samples = 24
    sc.view_settings.view_transform = "Standard"
    sc.render.image_settings.file_format = "PNG"
    sc.render.image_settings.color_mode = "RGB"
    world = bpy.data.worlds.new("world")
    sc.world = world
    world.use_nodes = True
    # The camera sees the backdrop colour as is; the lighting uses a dimmer copy (ambient fill).
    nodes, links = world.node_tree.nodes, world.node_tree.links
    out = nodes["World Output"]
    seen = nodes["Background"]
    seen.inputs["Color"].default_value = hexcol("#e3eafb" if mode == "web" else "#e9e6df")
    ambient = nodes.new("ShaderNodeBackground")
    ambient.inputs["Color"].default_value = seen.inputs["Color"].default_value
    ambient.inputs["Strength"].default_value = 0.55
    path = nodes.new("ShaderNodeLightPath")
    mix = nodes.new("ShaderNodeMixShader")
    links.new(path.outputs["Is Camera Ray"], mix.inputs["Fac"])
    links.new(ambient.outputs["Background"], mix.inputs[1])
    links.new(seen.outputs["Background"], mix.inputs[2])
    links.new(mix.outputs["Shader"], out.inputs["Surface"])

    def area(name, loc, energy, size, color="#ffffff"):
        light = bpy.data.lights.new(name, "AREA")
        light.energy = energy
        light.size = size
        light.color = hexcol(color)[:3]
        obj = link(bpy.data.objects.new(name, light))
        obj.location = loc
        obj.rotation_euler = (Vector((0, 0, 0.1)) - Vector(loc)).to_track_quat("-Z", "Y").to_euler()
        return obj

    area("key", (-1.2, -2.2, 1.4), 70, 1.6)
    area("fill", (1.6, -1.8, 0.4), 28, 2.0, "#e8eeff")
    area("rim", (0.6, 1.5, 1.2), 45, 1.0, "#fff1e0")

    cam_data = bpy.data.cameras.new("cam")
    cam_data.lens = 100
    cam_data.sensor_fit = "HORIZONTAL"
    sc.camera = link(bpy.data.objects.new("cam", cam_data))


def frame_camera(mode: str, anim):
    """web: the 2D player's view; camera: the source video's view of the signer."""
    sc = bpy.context.scene
    cam = sc.camera
    cam_data = cam.data
    if mode == "web":
        sc.render.resolution_x = sc.render.resolution_y = 480
        x0, x1, y0, y1 = -140, 140, -160, 120  # the 2D viewBox
    else:
        cm = anim["camera"]
        sc.render.resolution_x, sc.render.resolution_y = 640, round(640 * cm["h"] / cm["w"])
        x0, x1 = -cm["x"] / cm["unit"], (cm["w"] - cm["x"]) / cm["unit"]
        y0, y1 = -cm["y"] / cm["unit"], (cm["h"] - cm["y"]) / cm["unit"]
    half_w = (x1 - x0) / 2 * S
    cx, cz = (x0 + x1) / 2 * S, -(y0 + y1) / 2 * S
    if mode == "camera":
        # The motion's x/y already are a camera's projection: an orthographic view reproduces it exactly
        # (a perspective camera would add a second perspective and move forward hands).
        cam_data.type = "ORTHO"
        cam_data.ortho_scale = 2 * half_w
        dist = 5.0
    else:
        cam_data.type = "PERSP"
        dist = half_w / math.tan(math.atan(cam_data.sensor_width / 2 / cam_data.lens))
    cam.location = (cx, -dist, cz)
    cam.rotation_euler = (math.radians(90), 0, 0)


def main():
    argv = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    ap = argparse.ArgumentParser()
    ap.add_argument("--mode", choices=["web", "camera"], default="web")
    ap.add_argument("--only", default="")
    ap.add_argument("--out", default=str(REPO / "ml" / "data" / "cache" / "saathi3d"))
    ap.add_argument("--poster-only", action="store_true")
    args = ap.parse_args(argv)

    ids = [p.stem for p in sorted(ANIM3D.glob("*.json"))]
    if args.only:
        ids = [i for i in ids if i in set(args.only.split(","))]
    bpy.ops.wm.read_factory_settings(use_empty=True)
    setup_scene(args.mode)
    chars = build_character()
    for sid in ids:
        anim = json.loads((ANIM3D / f"{sid}.json").read_text(encoding="utf-8"))
        frame_camera(args.mode, anim)
        out = Path(args.out) / args.mode / sid
        out.mkdir(parents=True, exist_ok=True)
        frames = [anim["poster"]] if args.poster_only else range(len(anim["frames"]))
        for k in frames:
            pose(chars, anim["frames"][k])
            bpy.context.scene.render.filepath = str(out / ("poster.png" if args.poster_only else f"f{k:04d}.png"))
            bpy.ops.render.render(write_still=True)
        print(f"rendered {sid}: {len(frames)} frames -> {out}", flush=True)


main()
