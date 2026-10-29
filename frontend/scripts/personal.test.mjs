// Run: npm run test:signs — "My signs" matching and enrolment checks (lib/signs/personal.ts).
import assert from "node:assert/strict";
import { test } from "node:test";

const { matchPersonal, checkEnrolment, cosine, CONSISTENCY_FLOOR } = await import("../lib/signs/personal.ts");
const { meanEmbedding } = await import("../lib/signs/embedding.ts");

const unit = (...v) => {
  const a = Float32Array.from(v);
  const n = Math.hypot(...a);
  return a.map((x) => x / n);
};

const chai = { id: "1", label: "Chai", emoji: "☕", embeddings: [unit(1, 0, 0), unit(0.95, 0.1, 0)] };
const bus = { id: "2", label: "Bus", emoji: null, embeddings: [unit(0, 1, 0)] };

test("the closest personal sign is returned when it clears the threshold", () => {
  const m = matchPersonal(unit(0.99, 0.05, 0), [chai, bus], 0.95);
  assert.equal(m?.label, "Chai");
  assert.ok(m.score > 0.95);
});

test("nothing is matched below the threshold", () => {
  assert.equal(matchPersonal(unit(0.6, 0.6, 0.5), [chai, bus], 0.95), null);
  assert.equal(matchPersonal(unit(1, 0, 0), [], 0.5), null);
});

test("enrolment: consistent takes pass, a different movement is flagged", () => {
  const ok = checkEnrolment([unit(1, 0.05, 0), unit(1, 0, 0.05), unit(0.98, 0.02, 0)], [], 0.95);
  assert.ok(ok.consistent);
  const odd = checkEnrolment([unit(1, 0, 0), unit(1, 0.02, 0), unit(0, 0, 1)], [], 0.95);
  assert.ok(!odd.consistent && odd.worstPair < CONSISTENCY_FLOOR);
});

test("enrolment: a sign too close to another own sign is reported", () => {
  const r = checkEnrolment([unit(1, 0, 0), unit(0.99, 0.02, 0), unit(1, 0.01, 0)], [chai, bus], 0.95);
  assert.equal(r.clashesWith, "Chai");
});

test("meanEmbedding averages the 3 window placements and normalises", () => {
  const e = meanEmbedding(Float32Array.from([1, 0, 0, 1, 1, 1]), 2);
  assert.ok(Math.abs(cosine(e, e) - 1) < 1e-6);
  // mean of [1,0,0] and [1,1,1] is [1, 0.5, 0.5]; normalised by sqrt(1.5)
  const n = Math.sqrt(1.5);
  [1 / n, 0.5 / n, 0.5 / n].forEach((v, i) => assert.ok(Math.abs(e[i] - v) < 1e-6));
});
