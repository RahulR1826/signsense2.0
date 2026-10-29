// Run: npm run test:signs   (Node's built-in test runner; Node strips the TypeScript types)
import assert from "node:assert/strict";
import { test } from "node:test";

const { SignSegmenter } = await import("../lib/signs/segmenter.ts");

const ASPECT = 4 / 3;

/** Frame with shoulders at y=0.5 (width 0.2) and the right hand's wrist at `handY` (null = no hand). */
function frame(t, handY) {
  const pose = new Array(33 * 4).fill(0);
  pose[11 * 4] = 0.6;
  pose[11 * 4 + 1] = 0.5;
  pose[12 * 4] = 0.45;
  pose[12 * 4 + 1] = 0.5;
  const hand = handY === null ? null : Array.from({ length: 63 }, (_, i) => (i % 3 === 1 ? handY : 0.5));
  return { t, leftHand: null, rightHand: hand, pose, face: null };
}

function run(timeline) {
  const seg = new SignSegmenter(ASPECT);
  const segments = [];
  let t = 0;
  for (const [ms, handY] of timeline) {
    for (const end = t + ms; t < end; t += 40) {
      const s = seg.push(frame(t, handY));
      if (s) segments.push(s);
    }
  }
  return segments;
}

test("one raised-hand sign produces exactly one segment after the hands drop", () => {
  const segments = run([
    [600, null], // resting, hands out of view
    [1200, 0.45], // signing near the face
    [800, null], // hands down
  ]);
  assert.equal(segments.length, 1);
  const [s] = segments;
  const duration = s[s.length - 1].t - s[0].t;
  assert.ok(duration >= 1200 && duration <= 1200 + 300 + 250 + 80, `duration ${duration}`);
});

test("hands resting low in view never start a sign", () => {
  assert.equal(run([[3000, 0.95]]).length, 0);
});

test("a quick blip shorter than the minimum is ignored", () => {
  assert.equal(run([[400, null], [200, 0.45], [800, null]]).length, 0);
});

test("a short pause inside a sign does not split it", () => {
  const segments = run([[400, null], [600, 0.45], [200, null], [600, 0.45], [800, null]]);
  assert.equal(segments.length, 1);
});

test("signing longer than the maximum is cut into a segment", () => {
  assert.equal(run([[400, null], [5000, 0.45]]).length, 1);
});

test("hands held up for a long time give one segment, not a repeat every few seconds", () => {
  assert.equal(run([[400, null], [12000, 0.45]]).length, 1);
});

test("after a too-long cut, a new sign starts once the hands have come down", () => {
  assert.equal(run([[400, null], [5000, 0.45], [800, null], [1000, 0.45], [800, null]]).length, 2);
});

test("clear() drops a sign in progress", () => {
  const seg = new SignSegmenter(ASPECT);
  let t = 0;
  for (; t < 800; t += 40) seg.push(frame(t, 0.45));
  seg.clear();
  assert.equal(seg.state, "idle");
  let out = null;
  for (; t < 2000; t += 40) out = seg.push(frame(t, null)) ?? out;
  assert.equal(out, null);
});
