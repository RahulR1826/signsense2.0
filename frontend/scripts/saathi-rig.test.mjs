// Run: npm run test:signs — the live 3D Saathi: GLB clips, sign -> animation mapping, text -> steps.
// These check structure and mapping only; whether a clip is a correct ISL sign is measured separately
// (scripts/saathi-eval.mjs --rig: the recogniser on rendered clips) and is NOT established by these tests.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const { clipsById, stepsFor, tokensForReceivedSign } = await import("../lib/signs/saathi-rig.ts");
const { textToGloss } = await import("../lib/signs/gloss.ts");

const here = path.dirname(fileURLToPath(import.meta.url));
const rigDir = path.join(here, "../../sign-library/saathi-rig");
const manifest = JSON.parse(readFileSync(path.join(rigDir, "clips.json"), "utf8"));
const library = JSON.parse(readFileSync(path.join(here, "../../sign-library/library.json"), "utf8"));
const config = JSON.parse(readFileSync(path.join(here, "../public/models/signs/config.json"), "utf8"));
const ids = new Set(library.signs.map((s) => s.id));
const labelOf = (id) => library.signs.find((s) => s.id === id)?.label;

function glbJson(file) {
  const b = readFileSync(file);
  assert.equal(b.toString("ascii", 0, 4), "glTF", "not a GLB");
  const len = b.readUInt32LE(12);
  assert.equal(b.toString("ascii", 16, 20), "JSON");
  return JSON.parse(b.toString("utf8", 20, 20 + len));
}
const gltf = glbJson(path.join(rigDir, manifest.model));
const nodeName = (i) => gltf.nodes[i].name;

test("the GLB has a skeleton and one clip per manifest entry", () => {
  assert.ok(gltf.skins?.length >= 1, "no skeleton");
  const names = gltf.animations.map((a) => a.name).sort();
  assert.deepEqual(names, manifest.clips.map((c) => c.clip).sort());
});

test("every clip moves fingers, wrists, elbows, shoulders and head independently", () => {
  const needed = ["head", "brow_L", "brow_R", "mouth"];
  for (const side of ["L", "R"]) {
    needed.push(`clavicle_${side}`, `upper_${side}`, `fore_${side}`, `hand_${side}`);
    for (let k = 0; k < 5; k++) for (let s = 0; s < 3; s++) needed.push(`f${k}${s}_${side}`);
  }
  for (const anim of gltf.animations) {
    const rotated = new Set(anim.channels.filter((c) => c.target.path === "rotation").map((c) => nodeName(c.target.node)));
    const animated = new Set(anim.channels.map((c) => nodeName(c.target.node)));
    for (const n of needed) assert.ok(animated.has(n), `${anim.name}: ${n} not animated`);
    for (const n of needed.filter((x) => !["brow_L", "brow_R", "mouth"].includes(x))) assert.ok(rotated.has(n), `${anim.name}: ${n} has no rotation`);
  }
});

test("every sign the recogniser can send has a Saathi clip, and every clip is a dictionary sign", () => {
  const clips = clipsById(manifest);
  for (const label of config.classes) {
    if (label === config.policy?.unknownLabel) continue;
    assert.ok(clips.has(label), `no clip for recognised sign ${label}`);
  }
  for (const c of manifest.clips) assert.ok(ids.has(c.id), `clip ${c.id} is not a dictionary sign`);
});

test("received signs: only dictionary ids animate; personal or unknown ids are shown as text", () => {
  assert.deepEqual(tokensForReceivedSign(["thank_you"], "Thank you", ids), [{ kind: "sign", id: "thank_you", word: "Thank you" }]);
  assert.deepEqual(tokensForReceivedSign(["personal"], "Amma", ids), [{ kind: "text", word: "Amma" }]);
  assert.deepEqual(tokensForReceivedSign(["not_a_sign"], "x", ids), [{ kind: "text", word: "x" }]);
  assert.deepEqual(tokensForReceivedSign([], "x", ids), [{ kind: "text", word: "x" }]);
});

test("text -> steps: signs with clips animate, other words stay as text (never a substitute sign)", () => {
  const steps = stepsFor(textToGloss("thank you doctor zebra", ids), clipsById(manifest), labelOf);
  assert.deepEqual(steps.map((s) => s.kind), ["sign", "sign", "text"]);
  assert.equal(steps[0].clip, "thank_you");
  assert.equal(steps[2].reason, "no-sign");
  // A dictionary sign whose clip is missing is shown as text, flagged as "no animation".
  const without = new Map([...clipsById(manifest)].filter(([id]) => id !== "doctor"));
  const s2 = stepsFor(textToGloss("doctor", ids), without, labelOf);
  assert.deepEqual(s2, [{ kind: "text", word: "Doctor", reason: "no-animation" }]);
});
