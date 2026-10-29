// Registry for the live 3D Saathi: which dictionary signs have an animation clip in the rigged model
// (sign-library/saathi-rig/saathi.glb, built by ml/blender/saathi_rig.py; clips.json lists the clips).
//
// The chain is: recognised model label (= dictionary sign id, e.g. "thank_you") -> dictionary entry (caption)
// -> clip name in the GLB. A word or label without a clip is shown as text, never as some other sign.
// No imports beyond types: unit-tested in Node (scripts/saathi-rig.test.mjs).

import type { GlossToken } from "./gloss";

export const RIG_BASE = "/sign-library/saathi-rig";

export interface RigClip {
  /** Dictionary sign id (= recognition model label). */
  id: string;
  /** Animation clip name inside the GLB. */
  clip: string;
  frames: number;
  fps: number;
}

export interface RigManifest {
  version: number;
  model: string;
  clips: RigClip[];
}

/** One step of what Saathi shows: a sign with its clip, or a word shown as text (no clip). */
export type SaathiStep =
  | { kind: "sign"; id: string; label: string; clip: string }
  | { kind: "text"; word: string; reason: "no-sign" | "no-animation" };

export function clipsById(manifest: RigManifest): Map<string, RigClip> {
  return new Map(manifest.clips.map((c) => [c.id, c]));
}

/** Gloss tokens (from text or a received sign) -> steps Saathi can show honestly. */
export function stepsFor(tokens: GlossToken[], clips: Map<string, RigClip>, labelOf: (id: string) => string | undefined): SaathiStep[] {
  return tokens.map((t) => {
    if (t.kind !== "sign") return { kind: "text", word: t.word, reason: "no-sign" };
    const clip = clips.get(t.id);
    return clip ? { kind: "sign", id: t.id, label: labelOf(t.id) ?? t.word, clip: clip.clip } : { kind: "text", word: labelOf(t.id) ?? t.word, reason: "no-animation" };
  });
}

/**
 * Tokens for a received sign message. Only an id that is a dictionary sign becomes a sign token; anything else
 * (e.g. a "My signs" personal sign, or an unknown id from an untrusted peer) is shown as its text only.
 */
export function tokensForReceivedSign(gloss: string[], text: string, dictionaryIds: Set<string>): GlossToken[] {
  const known = gloss.filter((g) => dictionaryIds.has(g));
  if (known.length === gloss.length && known.length > 0) return known.map((id) => ({ kind: "sign", id, word: text }));
  return [{ kind: "text", word: text }];
}

let manifestPromise: Promise<RigManifest> | null = null;

export function loadRigManifest(): Promise<RigManifest> {
  manifestPromise ??= fetch(`${RIG_BASE}/clips.json`)
    .then((res) => {
      if (!res.ok) throw new Error(`Saathi animation list not found (${res.status})`);
      return res.json() as Promise<RigManifest>;
    })
    .catch((err) => {
      manifestPromise = null;
      throw err;
    });
  return manifestPromise;
}
