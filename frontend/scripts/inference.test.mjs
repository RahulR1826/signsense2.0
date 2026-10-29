// End-to-end offline inference check: real INCLUDE test clips (known signs and unknown, out-of-vocabulary
// signs) -> the published ONNX model in ONNX Runtime Web (same runtime as the browser) -> decision policy.
// Must reproduce the Python results. This proves the browser pipeline matches training; it is NOT a
// measure of real-world accuracy on new people.
// Fixtures: (from ml/) .venv/Scripts/python tools/make_feature_fixtures.py
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import * as ort from "onnxruntime-web";

const { combine, decide, LEGACY_POLICY } = await import("../lib/signs/decision.ts");

const here = path.dirname(fileURLToPath(import.meta.url));
const fixtureFile = path.join(here, "../../ml/data/fixtures/inference_cases.json");
const modelDir = path.join(here, "../public/models/signs");

test("published model reproduces Python logits and decisions", { skip: !existsSync(fixtureFile) && "fixtures not generated" }, async () => {
  const fx = JSON.parse(readFileSync(fixtureFile, "utf8"));
  const config = JSON.parse(readFileSync(path.join(modelDir, "config.json"), "utf8"));
  assert.equal(config.runId, fx.model, "fixtures were generated for a different published model — regenerate them");
  assert.deepEqual(config.classes, fx.classes);
  const policy = config.policy ?? LEGACY_POLICY;

  ort.env.wasm.numThreads = 1;
  const session = await ort.InferenceSession.create(path.join(modelDir, "model.onnx"), { executionProviders: ["wasm"] });
  for (const c of fx.cases) {
    const input = new ort.Tensor("float32", Float32Array.from(c.features), [3, config.window, config.featureDim]);
    const out = await session.run({ features: input });
    const flat = Array.from(out.logits.data);
    const n = config.classes.length;
    const logits = [0, 1, 2].map((v) => flat.slice(v * n, (v + 1) * n));
    logits.forEach((row, v) => row.forEach((x, i) => assert.ok(Math.abs(x - c.expectedLogits[v][i]) < 2e-3, `${c.name} logit ${v},${i}`)));
    const { probs, stable } = combine(logits, policy);
    assert.equal(decide(probs, stable, config.classes, policy), c.expectedDecision, `${c.name} decision`);
  }
});

test("model input contract", () => {
  const config = JSON.parse(readFileSync(path.join(modelDir, "config.json"), "utf8"));
  assert.equal(config.window, 48);
  assert.equal(config.featureDim, 333);
  assert.ok(config.classes.length >= 2);
  assert.equal(new Set(config.classes).size, config.classes.length, "duplicate class ids");
  if (config.policy) {
    assert.ok(config.policy.temperature > 0);
    assert.ok(config.policy.suggestThreshold <= config.policy.acceptThreshold + 1e-9);
    // Project rule: the published model never auto-sends below 95% calibrated confidence.
    assert.ok(config.policy.acceptThreshold >= 0.95, `published accept threshold ${config.policy.acceptThreshold} < 0.95`);
    if (config.policy.unknownLabel) assert.ok(config.classes.includes(config.policy.unknownLabel));
  }
});

test("published model exposes the personal-sign embedding", { skip: !existsSync(path.join(modelDir, "model.onnx")) && "no model" }, async () => {
  const config = JSON.parse(readFileSync(path.join(modelDir, "config.json"), "utf8"));
  assert.ok(config.embeddingDim > 0 && config.personal?.threshold > 0, "config lacks embeddingDim / personal threshold");
  ort.env.wasm.numThreads = 1;
  const session = await ort.InferenceSession.create(path.join(modelDir, "model.onnx"), { executionProviders: ["wasm"] });
  // Copy before sorting: outputNames is ORT's own array, and sorting it in place scrambles the output mapping.
  assert.deepEqual([...session.outputNames].sort(), ["embedding", "logits"]);
  const x = new ort.Tensor("float32", new Float32Array(3 * config.window * config.featureDim), [3, config.window, config.featureDim]);
  const out = await session.run({ features: x });
  assert.deepEqual(out.embedding.dims, [3, config.embeddingDim]);
});
