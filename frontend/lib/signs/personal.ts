// "My signs": a user's own signs, matched by the model's pooled representation (cosine similarity).
// Method and threshold come from ml/tools/personal_study.py (val-chosen; reported in the model config).
// A personal match is only ever offered as a suggestion the signer taps — never sent automatically.

/**
 * Two takes of the same sign below this similarity are probably different movements. 5th percentile of
 * same-word pairs on INCLUDE validation words (median 0.91; different words: median 0.73), measured
 * 2026-10-27 with the published model. Mostly cross-signer pairs, so the same person should clear it easily.
 */
export const CONSISTENCY_FLOOR = 0.57;

export interface PersonalSignRef {
  id: string;
  label: string;
  emoji: string | null;
  /** One L2-normalised embedding per recorded sample. */
  embeddings: Float32Array[];
}

export interface PersonalMatch {
  id: string;
  label: string;
  emoji: string | null;
  score: number;
}

export function cosine(a: Float32Array, b: Float32Array): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
}

/** Best personal sign for `embedding` if its closest sample reaches `threshold`; otherwise null. */
export function matchPersonal(embedding: Float32Array, signs: PersonalSignRef[], threshold: number): PersonalMatch | null {
  let best: PersonalMatch | null = null;
  for (const s of signs) {
    let score = -1;
    for (const e of s.embeddings) score = Math.max(score, cosine(embedding, e));
    if (!best || score > best.score) best = { id: s.id, label: s.label, emoji: s.emoji, score };
  }
  return best && best.score >= threshold ? best : null;
}

/**
 * Enrolment checks on the embeddings of a new sign's samples:
 *  - consistent: every sample is close to the others (otherwise the takes were probably different movements)
 *  - not a duplicate of another personal sign
 */
export function checkEnrolment(
  samples: Float32Array[],
  others: PersonalSignRef[],
  threshold: number,
): { consistent: boolean; worstPair: number; clashesWith: string | null } {
  let worst = 1;
  for (let i = 0; i < samples.length; i++) for (let j = i + 1; j < samples.length; j++) worst = Math.min(worst, cosine(samples[i], samples[j]));
  let clash: string | null = null;
  for (const o of others) {
    const hits = samples.filter((s) => o.embeddings.some((e) => cosine(s, e) >= threshold)).length;
    if (hits * 2 > samples.length) clash = o.label;
  }
  return { consistent: worst >= CONSISTENCY_FLOOR, worstPair: worst, clashesWith: clash };
}
