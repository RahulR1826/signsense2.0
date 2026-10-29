// Decision policy — TypeScript twin of ml/signsense_ml/policy.py (fixtures: npm run test:signs).
// Turns the model's logits for the three window variants into one of:
//   accept  -> confident: auto-send after a short, cancellable countdown
//   suggest -> unsure: show the top choices, the signer must pick (never sent automatically)
//   reject  -> "No supported sign detected" (unknown sign, or too uncertain): nothing is sent
// Self-contained (no runtime imports) so Node can run the tests directly.

export type Decision = "accept" | "suggest" | "reject";

export interface DecisionPolicy {
  temperature: number;
  acceptThreshold: number;
  minMargin: number;
  suggestThreshold: number;
  unknownLabel: string | null;
  windowVariants: number;
}

/** Models published before calibration existed behaved like this (auto-send at 0.6, never reject). */
export const LEGACY_POLICY: DecisionPolicy = {
  temperature: 1,
  acceptThreshold: 0.6,
  minMargin: 0,
  suggestThreshold: 0,
  unknownLabel: null,
  windowVariants: 1,
};

export function softmax(logits: ArrayLike<number>, temperature = 1): number[] {
  const z = Array.from(logits, (v) => v / temperature);
  const max = Math.max(...z);
  const e = z.map((v) => Math.exp(v - max));
  const sum = e.reduce((a, b) => a + b, 0);
  return e.map((v) => v / sum);
}

const argmax = (xs: number[]) => xs.reduce((best, v, i) => (v > xs[best] ? i : best), 0);

/** Mean calibrated probabilities over the variants, and whether all variants agree on the top class. */
export function combine(variantLogits: number[][], policy: DecisionPolicy): { probs: number[]; stable: boolean } {
  const used = variantLogits.slice(0, Math.max(1, policy.windowVariants));
  const probs = used.map((l) => softmax(l, policy.temperature));
  const mean = probs[0].map((_, c) => probs.reduce((s, p) => s + p[c], 0) / probs.length);
  const tops = new Set(probs.map(argmax));
  return { probs: mean, stable: tops.size === 1 };
}

export function decide(probs: number[], stable: boolean, classes: string[], policy: DecisionPolicy): Decision {
  const order = probs.map((p, i) => [p, i] as const).sort((a, b) => b[0] - a[0]);
  const [p1, top] = order[0];
  const p2 = order.length > 1 ? order[1][0] : 0;
  if (policy.unknownLabel !== null && classes[top] === policy.unknownLabel) return "reject";
  if (p1 >= policy.acceptThreshold && p1 - p2 >= policy.minMargin && stable) return "accept";
  if (p1 >= policy.suggestThreshold) return "suggest";
  return "reject";
}

export interface Ranked {
  label: string;
  prob: number;
}

/** Supported signs ranked by probability ("unknown" removed — it is never offered as a choice). */
export function rankKnown(probs: number[], classes: string[], policy: DecisionPolicy): Ranked[] {
  return probs
    .map((prob, i) => ({ label: classes[i], prob }))
    .filter((r) => r.label !== policy.unknownLabel)
    .sort((a, b) => b.prob - a.prob);
}
