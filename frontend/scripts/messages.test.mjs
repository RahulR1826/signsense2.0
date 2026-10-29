// Run: npm run test:signs — validation of peer-to-peer call messages (everything received is untrusted).
import assert from "node:assert/strict";
import { test } from "node:test";

const { parseMessage } = await import("../lib/call/messages.ts");

const sign = { type: "sign", id: "abc123", gloss: ["hello"], text: "Hello", confidence: 0.97, at: 1, via: "auto" };

test("a valid sign message parses", () => {
  assert.deepEqual(parseMessage(sign), sign);
});

test("an older sign message without `via` is treated as auto", () => {
  const old = { ...sign };
  delete old.via;
  assert.equal(parseMessage(old).via, "auto");
});

test("chosen signs keep their source", () => {
  assert.equal(parseMessage({ ...sign, via: "chosen" }).via, "chosen");
});

test("malformed or hostile sign messages are rejected", () => {
  for (const bad of [
    { ...sign, via: "model" },
    { ...sign, confidence: 1.5 },
    { ...sign, confidence: Number.NaN },
    { ...sign, text: "   " },
    { ...sign, text: "x".repeat(501) },
    { ...sign, gloss: "hello" },
    { ...sign, gloss: Array(21).fill("a") },
    { ...sign, id: 7 },
    null,
    "sign",
  ]) {
    assert.equal(parseMessage(bad), null, JSON.stringify(bad)?.slice(0, 60));
  }
});

test("unknown message types are ignored", () => {
  assert.equal(parseMessage({ type: "exec", code: "alert(1)" }), null);
});
