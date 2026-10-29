// Run: npm run test:signs — Saathi's motion files (sign-library/anim) and palm-facing logic.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const { palmFacing } = await import("../lib/signs/palm.ts");

const lib = path.join(path.dirname(fileURLToPath(import.meta.url)), "../../sign-library");
const library = JSON.parse(readFileSync(path.join(lib, "library.json"), "utf8"));

test("every dictionary sign has a motion file", () => {
  assert.ok(library.signs.length > 0);
  for (const s of library.signs) assert.equal(s.anim, `anim/${s.id}.json`, s.id);
});

test("motion files are well formed and contain no image data", () => {
  for (const s of library.signs) {
    const raw = readFileSync(path.join(lib, s.anim), "utf8");
    assert.ok(raw.length < 60_000, `${s.id} is ${raw.length} bytes`);
    const a = JSON.parse(raw);
    assert.equal(a.id, s.id);
    assert.ok(a.fps > 0 && a.frames.length >= 10, s.id);
    assert.ok(a.poster >= 0 && a.poster < a.frames.length, s.id);
    assert.ok(a.frames.some((f) => f.l || f.r), `${s.id} has no hands`);
    for (const f of a.frames) {
      assert.equal(f.a.length, 12);
      assert.equal(f.f.length, 9);
      assert.ok(f.n === "L" || f.n === "R");
      for (const h of [f.l, f.r]) if (h) assert.equal(h.length, 42);
      for (const v of [...f.a, ...f.f, ...(f.l ?? []), ...(f.r ?? [])]) assert.ok(Number.isInteger(v), `${s.id}: ${v}`);
    }
    assert.ok(!/base64|data:image/.test(raw), `${s.id} embeds image data`);
  }
});

// A hand held up with fingers pointing up; image coordinates (y down), viewer's left = smaller x.
function hand(indexX, pinkyX) {
  const h = new Array(42).fill(0);
  h[1] = 40; // wrist (0, 40)
  h[10] = indexX; // index knuckle (5)
  h[34] = pinkyX; // little-finger knuckle (17)
  return h;
}

test("palm facing: index knuckle towards the body's middle means the palm faces the viewer", () => {
  // The signer's left hand is on the viewer's right; palm forward puts the thumb side (index) on the viewer's left.
  assert.equal(palmFacing(hand(-10, 10), "L"), true);
  assert.equal(palmFacing(hand(10, -10), "L"), false);
  assert.equal(palmFacing(hand(10, -10), "R"), true);
  assert.equal(palmFacing(hand(-10, 10), "R"), false);
});

test("3D Saathi: every recorded video and poster exists and is small", () => {
  for (const s of library.signs) {
    for (const key of ["video3d", "poster3d"]) {
      if (!s[key]) continue;
      const file = path.join(lib, s[key]);
      const size = readFileSync(file).length;
      assert.ok(size > 1000 && size < 400_000, `${s.id} ${key}: ${size} bytes`);
    }
  }
});
