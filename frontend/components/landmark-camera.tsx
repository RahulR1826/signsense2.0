"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

import { drawFrame } from "@/lib/landmarks/draw";
import { LandmarkExtractor, type Delegate, type ModelTimings } from "@/lib/landmarks/extractor";
import type { LandmarkFrame } from "@/lib/landmarks/schema";

export type CameraStatus =
  | { kind: "starting" }
  | { kind: "loading-models" }
  | { kind: "ready"; width: number; height: number }
  | { kind: "error"; message: string };

export interface LandmarkStats {
  fps: number;
  inferMs: number;
  /** Average ms per model over the last window. */
  models: ModelTimings;
  delegate: string;
  leftHand: boolean;
  rightHand: boolean;
  pose: boolean;
  face: boolean;
}

interface Props {
  face: boolean;
  delegate?: Delegate;
  onFrame?: (frame: LandmarkFrame) => void;
  onStats?: (stats: LandmarkStats) => void;
  onStatus?: (status: CameraStatus) => void;
  children?: ReactNode;
}

function cameraErrorMessage(err: unknown): string {
  const name = err instanceof DOMException ? err.name : "";
  if (name === "NotAllowedError") return "Camera permission was denied. Allow camera access in the browser's address bar and reload.";
  if (name === "NotFoundError") return "No camera found. Connect a webcam and reload.";
  if (name === "NotReadableError") return "The camera is in use by another app. Close it and reload.";
  return "Could not start the camera.";
}

/** Webcam with a live landmark overlay. Video and overlay are mirrored for display only. */
export function LandmarkCamera({ face, delegate = "GPU", onFrame, onStats, onStatus, children }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const callbacks = useRef({ onFrame, onStats, onStatus });
  const [status, setStatus] = useState<CameraStatus>({ kind: "starting" });

  useEffect(() => {
    callbacks.current = { onFrame, onStats, onStatus };
  });

  useEffect(() => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    let cancelled = false;
    let stream: MediaStream | null = null;
    let extractor: LandmarkExtractor | null = null;
    let frameHandle = 0;

    const report = (s: CameraStatus) => {
      if (cancelled) return;
      setStatus(s);
      callbacks.current.onStatus?.(s);
    };

    async function start() {
      if (!video || !canvas) return;

      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 30 } },
          audio: false,
        });
      } catch (err) {
        report({ kind: "error", message: cameraErrorMessage(err) });
        return;
      }
      if (cancelled) return stream.getTracks().forEach((t) => t.stop());
      video.srcObject = stream;
      await video.play().catch(() => undefined);

      report({ kind: "loading-models" });
      try {
        extractor = await LandmarkExtractor.create({ face, delegate });
      } catch (err) {
        console.error(err);
        report({ kind: "error", message: "Could not load the landmark models. Run `npm run setup:runtime` and reload." });
        return;
      }
      if (cancelled) return extractor.close();
      report({ kind: "ready", width: video.videoWidth, height: video.videoHeight });

      const t0 = performance.now();
      let frames = 0;
      let inferTotal = 0;
      const modelTotal: ModelTimings = { pose: 0, hand: 0, face: 0 };
      let windowStart = t0;
      let last: LandmarkFrame | null = null;

      const tick = () => {
        if (cancelled || !extractor) return;
        if (canvas.width !== video.videoWidth) {
          canvas.width = video.videoWidth;
          canvas.height = video.videoHeight;
        }
        const before = performance.now();
        last = extractor.detect(video, before - t0);
        inferTotal += performance.now() - before;
        modelTotal.pose += extractor.timings.pose;
        modelTotal.hand += extractor.timings.hand;
        modelTotal.face += extractor.timings.face;
        frames++;
        drawFrame(canvas, last);
        callbacks.current.onFrame?.(last);

        const now = performance.now();
        if (now - windowStart >= 500) {
          callbacks.current.onStats?.({
            fps: (frames * 1000) / (now - windowStart),
            inferMs: inferTotal / frames,
            models: { pose: modelTotal.pose / frames, hand: modelTotal.hand / frames, face: modelTotal.face / frames },
            delegate: extractor.delegate,
            leftHand: !!last.leftHand,
            rightHand: !!last.rightHand,
            pose: !!last.pose,
            face: !!last.face,
          });
          frames = 0;
          inferTotal = 0;
          modelTotal.pose = modelTotal.hand = modelTotal.face = 0;
          windowStart = now;
        }
        frameHandle = video.requestVideoFrameCallback(tick);
      };
      frameHandle = video.requestVideoFrameCallback(tick);
    }

    start();
    return () => {
      cancelled = true;
      video?.cancelVideoFrameCallback(frameHandle);
      stream?.getTracks().forEach((t) => t.stop());
      extractor?.close();
    };
  }, [face, delegate]);

  return (
    <div className="relative aspect-[4/3] w-full overflow-hidden rounded-xl bg-black">
      <div className="absolute inset-0 -scale-x-100">
        <video ref={videoRef} className="absolute inset-0 size-full object-cover" playsInline muted />
        <canvas ref={canvasRef} className="absolute inset-0 size-full object-cover" />
      </div>
      {status.kind !== "ready" && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/70 p-6 text-center text-white">
          {status.kind === "starting" && "Starting camera…"}
          {status.kind === "loading-models" && "Loading landmark models…"}
          {status.kind === "error" && status.message}
        </div>
      )}
      {children}
    </div>
  );
}
