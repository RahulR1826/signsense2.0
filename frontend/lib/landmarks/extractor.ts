import {
  FaceLandmarker,
  FilesetResolver,
  HandLandmarker,
  PoseLandmarker,
  type NormalizedLandmark,
} from "@mediapipe/tasks-vision";

import { BoxSmoother, Cropper, bodyBox, headBox, toFrame } from "./crop";
import {
  FACE_SUBSET,
  POSE_LEFT_WRIST,
  POSE_RIGHT_WRIST,
  type LandmarkFrame,
} from "./schema";

// MediaPipe's WASM runtime logs routine startup INFO lines through console.error, which the
// Next.js dev overlay reports as errors. Drop exactly those lines; every other error passes through.
const MEDIAPIPE_INFO = /^INFO: Created TensorFlow Lite XNNPACK delegate/;
if (typeof window !== "undefined") {
  const original = console.error;
  console.error = (...args: unknown[]) => {
    if (typeof args[0] === "string" && MEDIAPIPE_INFO.test(args[0])) return;
    original(...args);
  };
}

const WASM_PATH = "/mediapipe/wasm";
const MODEL_PATH = "/mediapipe/models";

export type Delegate = "GPU" | "CPU";

// The WASM runtime only needs loading once per page, even if extractors are recreated.
let filesetPromise: ReturnType<typeof FilesetResolver.forVisionTasks> | null = null;

const round = (v: number) => Math.round(v * 1e5) / 1e5;

function flatten(points: NormalizedLandmark[], withVisibility = false): number[] {
  const out: number[] = [];
  for (const p of points) {
    out.push(round(p.x), round(p.y), round(p.z));
    if (withVisibility) out.push(round(p.visibility ?? 0));
  }
  return out;
}

const dist2 = (a: NormalizedLandmark, b: NormalizedLandmark) => (a.x - b.x) ** 2 + (a.y - b.y) ** 2;

/**
 * Decide which detected hand is the person's left and right.
 * Prefer matching hand wrists to the pose wrists (robust); fall back to MediaPipe's handedness
 * label, which assumes a mirrored image — our input is unmirrored, so the label is swapped.
 */
function assignHands(
  hands: NormalizedLandmark[][],
  labels: string[],
  pose: NormalizedLandmark[] | undefined,
): { left: NormalizedLandmark[] | null; right: NormalizedLandmark[] | null } {
  if (hands.length === 0) return { left: null, right: null };

  if (pose) {
    const lw = pose[POSE_LEFT_WRIST];
    const rw = pose[POSE_RIGHT_WRIST];
    if (hands.length === 1) {
      const w = hands[0][0];
      return dist2(w, lw) <= dist2(w, rw) ? { left: hands[0], right: null } : { left: null, right: hands[0] };
    }
    const [a, b] = hands;
    const straight = dist2(a[0], lw) + dist2(b[0], rw);
    const swapped = dist2(a[0], rw) + dist2(b[0], lw);
    return straight <= swapped ? { left: a, right: b } : { left: b, right: a };
  }

  let left: NormalizedLandmark[] | null = null;
  let right: NormalizedLandmark[] | null = null;
  hands.forEach((h, i) => {
    if (labels[i] === "Left") right ??= h;
    else left ??= h;
  });
  return { left, right };
}

export interface ExtractorOptions {
  face: boolean;
  /** Preferred delegate; GPU falls back to CPU if it fails to initialise. */
  delegate?: Delegate;
}

/** A video element on the page, or a frame transferred to a worker. */
export type FrameSource = HTMLVideoElement | ImageBitmap;

const frameSize = (s: FrameSource): [number, number] =>
  "videoWidth" in s ? [s.videoWidth, s.videoHeight] : [s.width, s.height];

export interface ModelTimings {
  pose: number;
  hand: number;
  face: number;
}

/** Runs MediaPipe hand + pose (+ face) landmarkers on video frames. Independent of React and the call. */
export class LandmarkExtractor {
  readonly delegate: Delegate;
  /** Milliseconds spent in each model on the last detect() call. */
  timings: ModelTimings = { pose: 0, hand: 0, face: 0 };
  private lastTs = -1;
  private handCrop = new Cropper(512);
  private faceCrop = new Cropper(256);
  private handBoxes = new BoxSmoother();
  private faceBoxes = new BoxSmoother();

  private constructor(
    private hand: HandLandmarker,
    private pose: PoseLandmarker,
    private face: FaceLandmarker | null,
    delegate: Delegate,
  ) {
    this.delegate = delegate;
  }

  static async create(options: ExtractorOptions): Promise<LandmarkExtractor> {
    filesetPromise ??= FilesetResolver.forVisionTasks(WASM_PATH);
    const fileset = await filesetPromise;
    const build = async (delegate: Delegate) => {
      const base = (model: string) => ({ modelAssetPath: `${MODEL_PATH}/${model}`, delegate });
      const [hand, pose, face] = await Promise.all([
        HandLandmarker.createFromOptions(fileset, {
          baseOptions: base("hand_landmarker.task"),
          runningMode: "VIDEO",
          numHands: 2,
        }),
        PoseLandmarker.createFromOptions(fileset, {
          baseOptions: base("pose_landmarker_lite.task"),
          runningMode: "VIDEO",
          numPoses: 1,
        }),
        options.face
          ? FaceLandmarker.createFromOptions(fileset, {
              baseOptions: base("face_landmarker.task"),
              runningMode: "VIDEO",
              numFaces: 1,
            })
          : Promise.resolve(null),
      ]);
      return new LandmarkExtractor(hand, pose, face, delegate);
    };
    if (options.delegate === "CPU") return build("CPU");
    try {
      return await build("GPU");
    } catch (err) {
      console.warn("MediaPipe GPU delegate failed, falling back to CPU", err);
      return build("CPU");
    }
  }

  /** Extract landmarks for one frame. `t` is stored in the frame as-is. */
  detect(video: FrameSource, t: number): LandmarkFrame {
    // MediaPipe requires strictly increasing timestamps.
    const ts = Math.max(performance.now(), this.lastTs + 1);
    this.lastTs = ts;

    const [w, h] = frameSize(video);

    const t0 = performance.now();
    const posePoints = this.pose.detectForVideo(video, ts).landmarks[0];
    const t1 = performance.now();

    // Hands and face run on crops around the body/head when the person is small in the frame.
    const handBox = this.handBoxes.next(posePoints ? bodyBox(posePoints, w, h) : null);
    const handRes = this.hand.detectForVideo(handBox ? this.handCrop.draw(video, handBox, w, h) : video, ts);
    const hands = handBox ? handRes.landmarks.map((l) => toFrame(l, handBox, w, h)) : handRes.landmarks;
    const t2 = performance.now();

    let facePoints: NormalizedLandmark[] | undefined;
    if (this.face) {
      const faceBox = this.faceBoxes.next(posePoints ? headBox(posePoints, w, h) : null);
      const faceRes = this.face.detectForVideo(faceBox ? this.faceCrop.draw(video, faceBox, w, h) : video, ts);
      const raw = faceRes.faceLandmarks[0];
      facePoints = raw && faceBox ? toFrame(raw, faceBox, w, h) : raw;
    }
    this.timings = { pose: t1 - t0, hand: t2 - t1, face: this.face ? performance.now() - t2 : 0 };

    const labels = handRes.handedness.map((hd) => hd[0]?.categoryName ?? "");
    const { left, right } = assignHands(hands, labels, posePoints);

    return {
      t: Math.round(t),
      leftHand: left ? flatten(left) : null,
      rightHand: right ? flatten(right) : null,
      pose: posePoints ? flatten(posePoints, true) : null,
      face: facePoints ? flatten(FACE_SUBSET.map((i) => facePoints[i])) : null,
    };
  }

  close() {
    this.hand.close();
    this.pose.close();
    this.face?.close();
  }
}
