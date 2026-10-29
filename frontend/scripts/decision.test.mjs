// Decision policy (lib/signs/decision.ts) must match ml/signsense_ml/policy.py exactly.
// Fixtures: (from ml/) .venv/Scripts/python tools/make_feature_fixtures.py
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const { combine, decide, rankKnown, softmax, LEGACY_POLICY } = await import("../lib/signs/decision.ts");

const here = path.dirname(fileURLToPath(import.meta.url));
const fixtureFile = path.join(here, "../../ml/data/fixtures/decision_cases.json");

test("python decision fixtures match", { skip: !existsSync(fixtureFile) && "fixtures not generated" }, () => {
  const { cases } = JSON.parse(readFileSync(fixtureFile, "utf8"));
  assert.ok(cases.length >= 40);
  for (const c of cases) {
    const { probs, stable } = combine(c.logits, c.policy);
    probs.forEach((p, i) => assert.ok(Math.abs(p - c.expectedProbs[i]) < 1e-9, `${c.name}: prob ${i}`));
    assert.equal(stable, c.expectedStable, `${c.name}: stability`);
    assert.equal(decide(probs, stable, c.classes, c.policy), c.expectedDecision, c.name);
  }
});

const POLICY = { temperature: 1, acceptThreshold: 0.7, minMargin: 0.2, suggestThreshold: 0.4, unknownLabel: "unknown", windowVariants: 3 };
const CLASSES = ["water", "help", "unknown"];

test("unknown as the top class is never sent", () => {
  const { probs, stable } = combine([[0, 0, 9], [0, 0, 9], [0, 0, 9]], POLICY);
  assert.equal(decide(probs, stable, CLASSES, POLICY), "reject");
});

test("ambiguous predictions are suggested, not auto-sent", () => {
  const { probs, stable } = combine([[3, 2.9, -5], [3, 2.9, -5], [3, 2.9, -5]], POLICY);
  assert.equal(decide(probs, stable, CLASSES, POLICY), "suggest");
});

test("unstable windows block auto-send even with a high score", () => {
  const { probs, stable } = combine([[9, 0, 0], [0, 9, 0], [9, 0, 0]], POLICY);
  assert.equal(stable, false);
  assert.notEqual(decide(probs, stable, CLASSES, POLICY), "accept");
});

test("low confidence is rejected", () => {
  const { probs, stable } = combine([[0.1, 0, 0.05], [0.1, 0, 0.05], [0.1, 0, 0.05]], POLICY);
  assert.equal(decide(probs, stable, CLASSES, POLICY), "reject");
});

test("ranked choices never offer 'unknown'", () => {
  const ranked = rankKnown(softmax([0, 1, 9]), CLASSES, POLICY);
  assert.deepEqual(ranked.map((r) => r.label), ["help", "water"]);
});

test("legacy policy (models without calibration) keeps the old behaviour", () => {
  const { probs, stable } = combine([[0.1, 0, 0.05]], LEGACY_POLICY);
  assert.equal(decide(probs, stable, ["a", "b", "c"], LEGACY_POLICY), "suggest");
});

test("published policy: every auto-send has a large lead over the runner-up and agreeing placements", () => {
  const config = JSON.parse(readFileSync(path.join(here, "../public/models/signs/config.json"), "utf8"));
  const policy = config.policy;
  assert.ok(policy, "published model must carry a calibrated policy");
  // Probabilities sum to 1, so p1 >= accept implies p1 - p2 >= 2*accept - 1; require a real lead either way.
  const impliedMargin = Math.max(policy.minMargin, 2 * policy.acceptThreshold - 1);
  assert.ok(impliedMargin >= 0.5, `accept ${policy.acceptThreshold} / margin ${policy.minMargin} allow near-ties to auto-send`);
  const n = config.classes.length;
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 2000; i++) {
    const logits = [0, 1, 2].map(() => Array.from({ length: n }, () => (rnd() - 0.5) * 20));
    const { probs, stable } = combine(logits, policy);
    if (decide(probs, stable, config.classes, policy) !== "accept") continue;
    const [p1, p2] = [...probs].sort((a, b) => b - a);
    assert.ok(stable, "accepted although the 3 window placements disagreed");
    assert.ok(p1 - p2 >= impliedMargin - 1e-9, `accepted with margin ${p1 - p2}`);
    assert.notEqual(config.classes[probs.indexOf(p1)], policy.unknownLabel);
  }
});
