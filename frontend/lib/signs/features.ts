// TypeScript port of ml/signsense_ml/features.py (FEATURE_VERSION "feat-1"). Must stay numerically
// identical — checked by `npm run check:features` against fixtures generated from the Python code.
// Self-contained (type-only imports) so Node can run the parity check without a bundler.
import type { LandmarkFrame } from "../landmarks/schema";

export const FEATURE_VERSION = "feat-1";
export const SAMPLE_FPS = 15;
export const WINDOW = 48;

const POSE_IDX = [0, 11, 12, 13, 14, 15, 16, 23, 24];
const L_SHOULDER = 11;
const R_SHOULDER = 12;
const N_FACE = 72;
export const FEATURE_DIM = POSE_IDX.length * 2 + 21 * 2 * 4 + N_FACE * 2 + 3;

/** Indices of the source frames nearest to a regular SAMPLE_FPS grid from first to last frame. */
export function resampleIndices(t: number[], fps = SAMPLE_FPS): number[] {
  if (t.length === 0) return [];
  // Same grid as numpy.arange(t0, tLast + 1e-3, step): t0 + i * step, no accumulated rounding.
  const step = 1000 / fps;
  const count = Math.ceil((t[t.length - 1] + 1e-3 - t[0]) / step);
  return Array.from({ length: count }, (_, i) => nearest(t, t[0] + i * step));
}

/** Index of the frame whose time is closest to `g` (first one on ties, like numpy argmin). */
function nearest(t: number[], g: number): number {
  let best = 0;
  for (let i = 1; i < t.length; i++) if (Math.abs(t[i] - g) < Math.abs(t[best] - g)) best = i;
  return best;
}

/**
 * Crop or edge-pad an index list to exactly `window` entries. `start` (as in Python fit_window) is the
 * crop offset for long clips or the amount of padding before short clips; default = centred.
 */
export function fitWindow(idx: number[], window = WINDOW, start?: number): number[] {
  const n = idx.length;
  if (n >= window) {
    const s = start === undefined ? Math.floor((n - window) / 2) : Math.min(Math.max(start, 0), n - window);
    return idx.slice(s, s + window);
  }
  const before = start === undefined ? Math.floor((window - n) / 2) : Math.min(Math.max(start, 0), window - n);
  return [...Array(before).fill(idx[0]), ...idx, ...Array(window - n - before).fill(idx[n - 1])];
}

/** Start offsets for the three test-time windows (earliest, centred, latest) — Python window_starts. */
export function windowStarts(n: number, window = WINDOW): number[] {
  const span = Math.abs(n - window);
  return [0, Math.floor(span / 2), span];
}

function bodyFrames(frames: LandmarkFrame[], aspect: number): { ox: number[]; oy: number[]; scale: number[] } {
  const n = frames.length;
  const ox = new Array<number>(n).fill(NaN);
  const oy = new Array<number>(n).fill(NaN);
  const scale = new Array<number>(n).fill(NaN);
  const valid: number[] = [];
  frames.forEach((f, i) => {
    const p = f.pose;
    if (!p) return;
    const lx = p[L_SHOULDER * 4] * aspect;
    const ly = p[L_SHOULDER * 4 + 1];
    const rx = p[R_SHOULDER * 4] * aspect;
    const ry = p[R_SHOULDER * 4 + 1];
    const s = Math.hypot(lx - rx, ly - ry);
    if (!(s > 1e-4)) return;
    ox[i] = (lx + rx) / 2;
    oy[i] = (ly + ry) / 2;
    scale[i] = s;
    valid.push(i);
  });
  if (valid.length === 0) {
    return { ox: ox.fill(aspect / 2), oy: oy.fill(0.5), scale: scale.fill(0.3) };
  }
  for (let i = 0; i < n; i++) {
    if (Number.isFinite(scale[i])) continue;
    let best = valid[0];
    for (const v of valid) if (Math.abs(v - i) < Math.abs(best - i)) best = v;
    ox[i] = ox[best];
    oy[i] = oy[best];
    scale[i] = scale[best];
  }
  return { ox, oy, scale };
}

/** Feature matrix (WINDOW-or-idx.length rows x FEATURE_DIM) for the selected frames. */
export function frameFeatures(frames: LandmarkFrame[], idx: number[], aspect: number): Float32Array {
  const { ox, oy, scale } = bodyFrames(frames, aspect);
  const out = new Float32Array(idx.length * FEATURE_DIM);
  idx.forEach((fi, row) => {
    const f = frames[fi];
    let k = row * FEATURE_DIM;
    const put = (v: number) => {
      out[k++] = Number.isFinite(v) ? v : 0;
    };
    const body = (arr: number[] | null, points: number[] | number, stride: number) => {
      const list = typeof points === "number" ? Array.from({ length: points }, (_, i) => i) : points;
      for (const i of list) {
        if (!arr) {
          put(0);
          put(0);
          continue;
        }
        put((arr[i * stride] * aspect - ox[fi]) / scale[fi]);
        put((arr[i * stride + 1] - oy[fi]) / scale[fi]);
      }
    };
    const local = (hand: number[] | null) => {
      if (!hand) {
        for (let i = 0; i < 42; i++) put(0);
        return;
      }
      const wx = hand[0] * aspect;
      const wy = hand[1];
      const size = Math.max(Math.hypot(hand[27] * aspect - wx, hand[28] - wy), 1e-4); // point 9 = middle MCP
      for (let i = 0; i < 21; i++) {
        put((hand[i * 3] * aspect - wx) / size);
        put((hand[i * 3 + 1] - wy) / size);
      }
    };
    body(f.pose, POSE_IDX, 4);
    body(f.leftHand, 21, 3);
    body(f.rightHand, 21, 3);
    local(f.leftHand);
    local(f.rightHand);
    body(f.face, N_FACE, 3);
    put(f.leftHand ? 1 : 0);
    put(f.rightHand ? 1 : 0);
    put(f.face ? 1 : 0);
  });
  return out;
}

/** Same as Python sequence_features(): whole clip, centred/edge-padded to WINDOW. */
export function sequenceFeatures(frames: LandmarkFrame[], aspect: number): Float32Array {
  return frameFeatures(frames, fitWindow(resampleIndices(frames.map((f) => f.t))), aspect);
}

/**
 * [3 x WINDOW x FEATURE_DIM] features of one sign segment at the three window placements (Python
 * window_variants). The decision policy averages them and checks that they agree.
 */
export function windowVariants(frames: LandmarkFrame[], aspect: number): Float32Array {
  const idx = resampleIndices(frames.map((f) => f.t));
  const out = new Float32Array(3 * WINDOW * FEATURE_DIM);
  windowStarts(idx.length).forEach((start, v) => {
    out.set(frameFeatures(frames, fitWindow(idx, WINDOW, start), aspect), v * WINDOW * FEATURE_DIM);
  });
  return out;
}
