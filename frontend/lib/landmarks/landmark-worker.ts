// Web Worker that runs the MediaPipe landmarkers off the page's main thread, so landmark extraction
// (~35 ms per frame) and MediaPipe's one-off GPU set-up (several seconds on the first frame) never
// freeze the call interface. Same LandmarkExtractor code as on the page; frames arrive as ImageBitmaps.
import { LandmarkExtractor } from "./extractor";
import type { LandmarkFrame } from "./schema";

export type WorkerRequest =
  | { type: "init"; face: boolean }
  | { type: "frame"; id: number; bitmap: ImageBitmap; t: number }
  | { type: "close" };

export type WorkerResponse =
  | { type: "ready"; delegate: string; warmupMs: number }
  | { type: "frame"; id: number; frame: LandmarkFrame; ms: number; timings: { pose: number; hand: number; face: number } }
  | { type: "frame-error"; id: number; message: string }
  | { type: "init-error"; message: string };

const scope = self as unknown as {
  onmessage: ((e: MessageEvent<WorkerRequest>) => void) | null;
  postMessage: (m: WorkerResponse) => void;
  close: () => void;
};

let extractor: LandmarkExtractor | null = null;

scope.onmessage = async (e) => {
  const msg = e.data;
  if (msg.type === "init") {
    try {
      extractor = await LandmarkExtractor.create({ face: msg.face });
      // Warm up: the first detection compiles GPU shaders; do it now, on a blank frame, not on the
      // first real frame of the call.
      const w0 = performance.now();
      const blank = new OffscreenCanvas(320, 240);
      blank.getContext("2d")?.fillRect(0, 0, 320, 240);
      extractor.detect(blank.transferToImageBitmap(), 0);
      scope.postMessage({ type: "ready", delegate: extractor.delegate, warmupMs: Math.round(performance.now() - w0) });
    } catch (err) {
      scope.postMessage({ type: "init-error", message: err instanceof Error ? err.message : String(err) });
    }
  } else if (msg.type === "frame") {
    const { id, bitmap, t } = msg;
    try {
      if (!extractor) throw new Error("not initialised");
      const t0 = performance.now();
      const frame = extractor.detect(bitmap, t);
      scope.postMessage({ type: "frame", id, frame, ms: performance.now() - t0, timings: extractor.timings });
    } catch (err) {
      scope.postMessage({ type: "frame-error", id, message: err instanceof Error ? err.message : String(err) });
    } finally {
      bitmap.close();
    }
  } else if (msg.type === "close") {
    extractor?.close();
    extractor = null;
    scope.close();
  }
};
