import type { NormalizedLandmark } from "@mediapipe/tasks-vision";

// MediaPipe's hand and face detectors shrink the whole frame to ~128-192 px before searching. When the
// signer is far from the camera (e.g. INCLUDE: full-body 1080p shots, face ~100 px wide), hands and face
// become too small to find. We run pose on the full frame, then run hands/face on square crops around
// the upper body / head and map the landmarks back to full-frame coordinates.

/** Square region in source-video pixels. */
export interface Box {
  x: number;
  y: number;
  size: number;
}

const NOSE = 0;
const LEFT_EYE = 2;
const RIGHT_EYE = 5;
const LEFT_EAR = 7;
const RIGHT_EAR = 8;
const LEFT_SHOULDER = 11;
const RIGHT_SHOULDER = 12;

const visible = (p: NormalizedLandmark | undefined): p is NormalizedLandmark => !!p && (p.visibility ?? 1) > 0.5;

function distPx(a: NormalizedLandmark, b: NormalizedLandmark, w: number, h: number) {
  return Math.hypot((a.x - b.x) * w, (a.y - b.y) * h);
}

/** Upper-body box for hand detection, or null when the person already fills the frame. */
export function bodyBox(pose: NormalizedLandmark[], w: number, h: number): Box | null {
  const ls = pose[LEFT_SHOULDER];
  const rs = pose[RIGHT_SHOULDER];
  if (!visible(ls) || !visible(rs)) return null;
  const size = 3.4 * distPx(ls, rs, w, h); // room for hands raised above the head and down to the hips
  if (size >= 0.9 * Math.min(w, h)) return null;
  const cx = ((ls.x + rs.x) / 2) * w;
  const cy = ((ls.y + rs.y) / 2) * h;
  return { x: cx - size / 2, y: cy - size * 0.45, size };
}

/** Head box for face detection, or null when the face is already large in the frame. */
export function headBox(pose: NormalizedLandmark[], w: number, h: number): Box | null {
  const nose = pose[NOSE];
  if (!visible(nose)) return null;
  const ears = distPx(pose[LEFT_EAR], pose[RIGHT_EAR], w, h);
  const eyes = distPx(pose[LEFT_EYE], pose[RIGHT_EYE], w, h) * 2;
  const size = 2.8 * Math.max(ears, eyes);
  if (size >= 0.45 * Math.min(w, h)) return null;
  return { x: nose.x * w - size / 2, y: nose.y * h - size / 2, size };
}

/** Exponential smoothing so the crop doesn't jitter frame to frame (keeps MediaPipe tracking stable). */
export class BoxSmoother {
  private prev: Box | null = null;

  constructor(private alpha = 0.4) {}

  next(box: Box | null): Box | null {
    if (!box || !this.prev) return (this.prev = box);
    const a = this.alpha;
    const p = this.prev;
    return (this.prev = { x: p.x + a * (box.x - p.x), y: p.y + a * (box.y - p.y), size: p.size + a * (box.size - p.size) });
  }
}

/** Draws a square crop of a frame into a fixed-size canvas; out-of-frame areas are black. */
export class Cropper {
  readonly canvas: OffscreenCanvas | HTMLCanvasElement;
  private ctx: OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D;

  constructor(size: number) {
    // OffscreenCanvas works on the page and in a Web Worker (where there is no document).
    this.canvas = typeof OffscreenCanvas !== "undefined" ? new OffscreenCanvas(size, size) : document.createElement("canvas");
    this.canvas.width = this.canvas.height = size;
    const ctx = this.canvas.getContext("2d") as OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D | null;
    if (!ctx) throw new Error("2D canvas not available");
    this.ctx = ctx;
  }

  draw(src: CanvasImageSource, box: Box, w: number, h: number): OffscreenCanvas | HTMLCanvasElement {
    const s = this.canvas.width;
    const k = s / box.size;
    this.ctx.fillStyle = "#000";
    this.ctx.fillRect(0, 0, s, s);
    const sx = Math.max(0, box.x);
    const sy = Math.max(0, box.y);
    const ex = Math.min(w, box.x + box.size);
    const ey = Math.min(h, box.y + box.size);
    if (ex > sx && ey > sy) {
      this.ctx.drawImage(src, sx, sy, ex - sx, ey - sy, (sx - box.x) * k, (sy - box.y) * k, (ex - sx) * k, (ey - sy) * k);
    }
    return this.canvas;
  }
}

/** Map landmarks detected inside a crop back to full-frame normalised coordinates. */
export function toFrame(points: NormalizedLandmark[], box: Box, w: number, h: number): NormalizedLandmark[] {
  return points.map((p) => ({
    ...p,
    x: (p.x * box.size + box.x) / w,
    y: (p.y * box.size + box.y) / h,
    z: (p.z * box.size) / w, // MediaPipe z uses the same scale as x
  }));
}
