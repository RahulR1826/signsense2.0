import type { LandmarkFrame } from "./schema";
import type { WorkerRequest, WorkerResponse } from "./landmark-worker";

export interface DetectResult {
  frame: LandmarkFrame;
  ms: number;
  timings: { pose: number; hand: number; face: number };
}

/**
 * Page-side handle to the landmark worker. One frame at a time: detect() rejects with "busy" if the
 * previous frame hasn't come back, so a slow frame is skipped rather than queued (no growing backlog).
 */
export class LandmarkWorkerClient {
  readonly delegate: string;
  readonly warmupMs: number;
  private pending: { id: number; resolve: (r: DetectResult) => void; reject: (e: Error) => void } | null = null;
  private nextId = 1;

  private constructor(
    private worker: Worker,
    ready: { delegate: string; warmupMs: number },
  ) {
    this.delegate = ready.delegate;
    this.warmupMs = ready.warmupMs;
    worker.onmessage = (e: MessageEvent<WorkerResponse>) => {
      const m = e.data;
      const p = this.pending;
      if (!p || (m.type !== "frame" && m.type !== "frame-error") || m.id !== p.id) return;
      this.pending = null;
      if (m.type === "frame") p.resolve({ frame: m.frame, ms: m.ms, timings: m.timings });
      else p.reject(new Error(m.message));
    };
    worker.onerror = (e) => {
      this.pending?.reject(new Error(e.message || "landmark worker crashed"));
      this.pending = null;
    };
  }

  static create(face: boolean): Promise<LandmarkWorkerClient> {
    const worker = new Worker(new URL("./landmark-worker.ts", import.meta.url), { type: "module" });
    return new Promise((resolve, reject) => {
      worker.onmessage = (e: MessageEvent<WorkerResponse>) => {
        if (e.data.type === "ready") resolve(new LandmarkWorkerClient(worker, e.data));
        else if (e.data.type === "init-error") {
          worker.terminate();
          reject(new Error(e.data.message));
        }
      };
      worker.onerror = (e) => {
        worker.terminate();
        reject(new Error(e.message || "landmark worker failed to start"));
      };
      worker.postMessage({ type: "init", face } satisfies WorkerRequest);
    });
  }

  get busy() {
    return this.pending !== null;
  }

  /** Takes ownership of `bitmap` (transferred to the worker). */
  detect(bitmap: ImageBitmap, t: number): Promise<DetectResult> {
    if (this.pending) {
      bitmap.close();
      return Promise.reject(new Error("busy"));
    }
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending = { id, resolve, reject };
      this.worker.postMessage({ type: "frame", id, bitmap, t } satisfies WorkerRequest, [bitmap]);
    });
  }

  close() {
    this.pending?.reject(new Error("closed"));
    this.pending = null;
    this.worker.postMessage({ type: "close" } satisfies WorkerRequest);
    // Give the worker a moment to release GPU resources, then make sure it is gone.
    setTimeout(() => this.worker.terminate(), 500);
  }
}
