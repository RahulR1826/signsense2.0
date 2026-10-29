import type { LandmarkFrame } from "../landmarks/schema";

// Explicit sign segmentation (decisions.md #9): a sign starts when a hand rises into the signing
// zone and ends when the hands drop back to rest. Each finished segment is classified once, which
// matches the training data (one whole sign per clip) and keeps resting/idle hands from producing words.

const L_SHOULDER = 11;
const R_SHOULDER = 12;

export interface SegmenterOptions {
  /** How long hands must be down before the sign counts as finished. */
  endAfterMs: number;
  /** Frames kept before the start / after the end (the signer at rest, like the training clips). */
  prerollMs: number;
  postrollMs: number;
  minSignMs: number;
  maxSignMs: number;
}

export const DEFAULT_SEGMENTER: SegmenterOptions = {
  endAfterMs: 450,
  prerollMs: 300,
  postrollMs: 250,
  minSignMs: 350,
  maxSignMs: 4000,
};

/** A hand is "signing" when it's visible and its wrist is above the rest line below the shoulders. */
export function isSigning(f: LandmarkFrame, aspect: number): boolean {
  if (!f.leftHand && !f.rightHand) return false;
  const p = f.pose;
  if (!p) return true; // no body seen: fall back to "hands visible"
  const ly = p[L_SHOULDER * 4 + 1];
  const ry = p[R_SHOULDER * 4 + 1];
  const shoulderWidth = Math.hypot((p[L_SHOULDER * 4] - p[R_SHOULDER * 4]) * aspect, ly - ry);
  const restLine = (ly + ry) / 2 + 1.3 * shoulderWidth;
  const raised = (hand: number[] | null) => !!hand && hand[1] < restLine;
  return raised(f.leftHand) || raised(f.rightHand);
}

export type SegmenterState = "idle" | "signing";

export class SignSegmenter {
  private buffer: LandmarkFrame[] = [];
  private start = -1; // t of first signing frame
  private lastActive = -1;
  /** After a too-long cut, hands must come down before another sign can start (no repeats while held up). */
  private needRest = false;
  state: SegmenterState = "idle";
  readonly aspect: number;
  private opts: SegmenterOptions;

  // Plain fields (no parameter properties) so Node's type stripping can run this file in tests.
  constructor(aspect: number, opts: SegmenterOptions = DEFAULT_SEGMENTER) {
    this.aspect = aspect;
    this.opts = opts;
  }

  /** Feed one frame; returns the frames of a finished sign segment, or null. */
  push(f: LandmarkFrame): LandmarkFrame[] | null {
    this.buffer.push(f);
    const active = isSigning(f, this.aspect);

    if (this.state === "idle") {
      // Keep only the pre-roll while waiting.
      while (this.buffer.length > 1 && f.t - this.buffer[0].t > this.opts.prerollMs) this.buffer.shift();
      if (this.needRest) {
        if (!active) this.needRest = false;
        return null;
      }
      if (active) {
        this.state = "signing";
        this.start = f.t;
        this.lastActive = f.t;
      }
      return null;
    }

    if (active) this.lastActive = f.t;
    const ended = f.t - this.lastActive >= this.opts.endAfterMs;
    const tooLong = f.t - this.start >= this.opts.maxSignMs;
    if (!ended && !tooLong) return null;

    const duration = this.lastActive - this.start;
    const cutoff = this.lastActive + this.opts.postrollMs;
    const segment = this.buffer.filter((x) => x.t <= cutoff);
    this.reset(f);
    this.needRest = tooLong && !ended;
    return duration >= this.opts.minSignMs ? segment : null;
  }

  /** Forget any partial sign (recognition paused/stopped, or the call changed). */
  clear() {
    this.state = "idle";
    this.start = -1;
    this.lastActive = -1;
    this.needRest = false;
    this.buffer = [];
  }

  private reset(last: LandmarkFrame) {
    this.state = "idle";
    this.start = -1;
    this.lastActive = -1;
    this.buffer = [last];
  }
}
