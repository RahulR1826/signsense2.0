import { HandLandmarker, PoseLandmarker } from "@mediapipe/tasks-vision";

import { HAND_POINTS, type LandmarkFrame } from "./schema";

const HAND_EDGES = HandLandmarker.HAND_CONNECTIONS;
// Upper body only (indices 0-24): legs are irrelevant for signing and usually out of frame.
const POSE_EDGES = PoseLandmarker.POSE_CONNECTIONS.filter((c) => c.start <= 24 && c.end <= 24);

const COLORS = { left: "#f97316", right: "#22c55e", pose: "#38bdf8", face: "#e879f9" };

function point(arr: number[], i: number, stride: number, w: number, h: number): [number, number] {
  return [arr[i * stride] * w, arr[i * stride + 1] * h];
}

function drawGraph(
  ctx: CanvasRenderingContext2D,
  arr: number[],
  count: number,
  stride: number,
  edges: { start: number; end: number }[],
  color: string,
  w: number,
  h: number,
  minVisibility = 0,
) {
  const visible = (i: number) => stride < 4 || arr[i * stride + 3] >= minVisibility;
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = 3;
  for (const { start, end } of edges) {
    if (!visible(start) || !visible(end)) continue;
    const [x1, y1] = point(arr, start, stride, w, h);
    const [x2, y2] = point(arr, end, stride, w, h);
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
  }
  for (let i = 0; i < count; i++) {
    if (!visible(i)) continue;
    const [x, y] = point(arr, i, stride, w, h);
    ctx.beginPath();
    ctx.arc(x, y, 3.5, 0, Math.PI * 2);
    ctx.fill();
  }
}

/** Draw a landmark frame onto a canvas sized like the video (unmirrored coords; mirror via CSS). */
export function drawFrame(canvas: HTMLCanvasElement, frame: LandmarkFrame | null) {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const { width: w, height: h } = canvas;
  ctx.clearRect(0, 0, w, h);
  if (!frame) return;

  if (frame.pose) drawGraph(ctx, frame.pose, 25, 4, POSE_EDGES, COLORS.pose, w, h, 0.5);
  if (frame.leftHand) drawGraph(ctx, frame.leftHand, HAND_POINTS, 3, HAND_EDGES, COLORS.left, w, h);
  if (frame.rightHand) drawGraph(ctx, frame.rightHand, HAND_POINTS, 3, HAND_EDGES, COLORS.right, w, h);
  if (frame.face) {
    ctx.fillStyle = COLORS.face;
    for (let i = 0; i < frame.face.length / 3; i++) {
      ctx.beginPath();
      ctx.arc(frame.face[i * 3] * w, frame.face[i * 3 + 1] * h, 2, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

export const LEGEND = [
  { label: "Left hand", color: COLORS.left },
  { label: "Right hand", color: COLORS.right },
  { label: "Pose", color: COLORS.pose },
  { label: "Face", color: COLORS.face },
] as const;
