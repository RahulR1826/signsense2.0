import assert from "node:assert/strict";
import { test } from "node:test";

const { textToGloss } = await import("../lib/signs/gloss.ts");

const ids = (text, known) => textToGloss(text, known).map((t) => (t.kind === "sign" ? t.id : `"${t.word}"`));

test("phrases win over single words", () => {
  assert.deepEqual(ids("Good morning, how are you?"), ["good_morning", "how_are_you"]);
  assert.deepEqual(ids("Thank you doctor"), ["thank_you", "doctor"]);
});

test("Hindi and Indian-English words map to signs", () => {
  assert.deepEqual(ids("Amma, dawai le lo"), ["mother", "medicine", '"le"', '"lo"']);
  assert.deepEqual(ids("aaj ghar aao"), ["today", "house", '"aao"']);
});

test("function words are dropped, unknown words kept as text (no fingerspelling)", () => {
  assert.deepEqual(ids("I am going to the hospital"), ["i", '"going"', "hospital"]);
});

test("same sign is not repeated back to back", () => {
  assert.deepEqual(ids("mom mom mummy!"), ["mother"]);
});

test("only signs that exist in the library are used", () => {
  assert.deepEqual(ids("hello doctor", new Set(["hello"])), ["hello", '"doctor"']);
});

test("empty and punctuation-only input", () => {
  assert.deepEqual(ids(""), []);
  assert.deepEqual(ids("?!..."), []);
});
