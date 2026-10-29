"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { LandmarkWorkerClient } from "@/lib/landmarks/landmark-worker-client";
import type { LandmarkFrame } from "@/lib/landmarks/schema";
import { SignClassifier, type SignDecision } from "@/lib/signs/classifier";
import { windowVariants } from "@/lib/signs/features";
import type { PersonalMatch } from "@/lib/signs/personal";
import { SignSegmenter, isSigning } from "@/lib/signs/segmenter";

// The model works on 15 fps sequences, so extracting faster only costs CPU/GPU the call needs.
const EXTRACT_EVERY_MS = 1000 / 15;
// One bad frame must not stop recognition; this many failures in a row means something is really broken.
const MAX_FRAME_ERRORS = 30;

export type RecognitionStatus = "off" | "loading" | "ready" | "paused" | "error";

/**
 * What the recogniser currently sees, for the signer's feedback:
 *   no-person   no body in view
 *   no-hands    body seen, hands not visible
 *   hands-down  hands visible but resting (a sign starts when a hand rises)
 *   signing     collecting a sign
 *   recognising sign finished, model running
 */
export type RecognitionPhase = "no-person" | "no-hands" | "hands-down" | "signing" | "recognising";

export interface SignResult extends SignDecision {
  id: number;
  /** The landmark frames of this sign and the camera aspect ratio (used to record "My signs" takes). */
  segment: LandmarkFrame[];
  aspect: number;
  /** Set when the result is the user's own sign (see lib/signs/personal.ts); always a suggestion. */
  personal?: PersonalMatch;
}

export interface RecognitionStats {
  modelLoadMs: number | null;
  extractorInitMs: number | null;
  /** MediaPipe's first-frame GPU set-up, done in the worker while loading. */
  warmupMs: number | null;
  /** Frames skipped because the previous one was still being processed. */
  framesSkipped: number;
  /** Every phase shown so far, and how often processing was paused (exact, for the end-to-end checks). */
  phasesSeen: RecognitionPhase[];
  pauses: number;
  delegate: string | null;
  framesProcessed: number;
  /** Mean MediaPipe time per frame over the last ~2 s, and its split by model. */
  detectMs: number;
  detectSplitMs: { pose: number; hand: number; face: number };
  /** performance.now() when the loop started processing frames (to separate start-up from steady state). */
  readyAt: number | null;
  decideMs: number | null;
  segments: number;
  frameErrors: number;
  /** Loops started since the page loaded: 1 per enable; more running at once would be a bug. */
  loopsStarted: number;
  loopsRunning: number;
}

// Loaded once per page (it's ~3.5 MB); a failure is not cached so Retry can load it again.
let classifierPromise: Promise<SignClassifier> | null = null;
/** The page-wide sign model (loaded once; shared by recognition and "My signs"). */
export function loadClassifier(): Promise<SignClassifier> {
  classifierPromise ??= SignClassifier.load().catch((err) => {
    classifierPromise = null;
    throw err;
  });
  return classifierPromise;
}

// Background warm-up (the practice page starts it when it opens): the classifier and one hand-tracking worker
// load while the user reads the page, and the next recogniser that starts takes that worker instead of making
// its own, so there is still exactly one pipeline. MediaPipe's first GPU set-up takes seconds; this hides it.
let warmExtractor: Promise<LandmarkWorkerClient> | null = null;

export function prewarmRecognition(): void {
  loadClassifier().catch(() => undefined); // a failure is reported (and retried) when recognition starts
  if (!warmExtractor) {
    const p = LandmarkWorkerClient.create(true);
    warmExtractor = p;
    p.catch(() => {
      if (warmExtractor === p) warmExtractor = null;
    });
  }
}

/** Close a warmed worker nobody took (e.g. the user left without turning the camera on). */
export function releasePrewarmed(): void {
  const p = warmExtractor;
  warmExtractor = null;
  p?.then((e) => e.close()).catch(() => undefined);
}

function takeExtractor(): Promise<LandmarkWorkerClient> {
  const p = warmExtractor;
  warmExtractor = null;
  return p ? p.catch(() => LandmarkWorkerClient.create(true)) : LandmarkWorkerClient.create(true);
}

const stats: RecognitionStats = {
  modelLoadMs: null,
  extractorInitMs: null,
  warmupMs: null,
  framesSkipped: 0,
  phasesSeen: [],
  pauses: 0,
  delegate: null,
  framesProcessed: 0,
  detectMs: 0,
  detectSplitMs: { pose: 0, hand: 0, face: 0 },
  readyAt: null,
  decideMs: null,
  segments: 0,
  frameErrors: 0,
  loopsStarted: 0,
  loopsRunning: 0,
};
if (typeof window !== "undefined") {
  // Counters only (no landmarks, video or text): read by the browser checks (scripts/live-call-e2e.mjs).
  (window as unknown as { __signRecognition: RecognitionStats }).__signRecognition = stats;
}

function phaseOf(f: LandmarkFrame, aspect: number): RecognitionPhase {
  if (!f.pose) return f.leftHand || f.rightHand ? "signing" : "no-person";
  if (!f.leftHand && !f.rightHand) return "no-hands";
  return isSigning(f, aspect) ? "signing" : "hands-down";
}

/**
 * Sign recognition on the camera stream that is also being sent in the call. Runs entirely in this
 * browser: MediaPipe landmarks (in a Web Worker, so the call UI stays responsive) -> sign segmenter ->
 * ONNX classifier -> decision policy. No video or landmarks leave the device for it.
 *
 * `enabled`: load the models and watch the camera. `active`: actually process frames — e.g. false while
 * the call is reconnecting, so nothing is recognised that couldn't be delivered, without throwing away
 * the loaded models. Exactly one processing loop runs per enabled hook.
 */
export function useSignRecognition(
  stream: MediaStream | null,
  enabled: boolean,
  active: boolean,
  onResult: (r: SignResult) => void,
) {
  const [status, setStatus] = useState<RecognitionStatus>("off");
  const [error, setError] = useState<string | null>(null);
  const [phase, setPhase] = useState<RecognitionPhase>("no-person");
  const [attempt, setAttempt] = useState(0);
  const callback = useRef(onResult);
  const activeRef = useRef(active);

  useEffect(() => {
    callback.current = onResult;
    activeRef.current = active;
  });

  const track = stream?.getVideoTracks()[0] ?? null;

  useEffect(() => {
    if (!enabled || !track) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- reflect being switched off
      setStatus("off");
      return;
    }
    let cancelled = false;
    let extractor: LandmarkWorkerClient | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let nextId = 1;
    let running = false;
    const video = document.createElement("video");
    video.muted = true;
    video.playsInline = true;
    video.srcObject = new MediaStream([track]);

    setStatus("loading");
    setError(null);

    (async () => {
      try {
        const t0 = performance.now();
        const modelP = loadClassifier().then((c) => {
          stats.modelLoadMs ??= Math.round(performance.now() - t0);
          return c;
        });
        const extP = takeExtractor().then((e) => {
          stats.extractorInitMs = Math.round(performance.now() - t0);
          stats.warmupMs = e.warmupMs;
          return e;
        });
        // Close the extractor even if the model fails, so GPU resources aren't leaked.
        const [extResult, modelResult] = await Promise.allSettled([extP, modelP]);
        if (extResult.status === "fulfilled") extractor = extResult.value;
        if (modelResult.status === "rejected") {
          console.error(modelResult.reason);
          throw new Error("The sign model couldn't be loaded.");
        }
        if (extResult.status === "rejected") {
          console.error(extResult.reason);
          throw new Error("Hand tracking couldn't start in this browser.");
        }
        const classifier = modelResult.value;
        const ext = extractor!;
        if (cancelled) return;
        stats.delegate = ext.delegate;
        await video.play();
        if (cancelled) return;

        const settings = track.getSettings();
        const aspect = (settings.width ?? video.videoWidth) / (settings.height ?? video.videoHeight) || 4 / 3;
        const segmenter = new SignSegmenter(aspect);
        let wasActive = false;
        let lastPhase: RecognitionPhase | null = null;
        let errorsInRow = 0;
        let pending = 0; // classifications in flight
        let detectTotal = 0;
        let detectCount = 0;
        const split = { pose: 0, hand: 0, face: 0 };
        let windowStart = performance.now();
        const showPhase = (p: RecognitionPhase) => {
          if (p === lastPhase) return;
          setPhase((lastPhase = p));
          if (!stats.phasesSeen.includes(p)) stats.phasesSeen.push(p);
        };

        stats.loopsStarted++;
        stats.readyAt = performance.now();
        stats.loopsRunning++;
        running = true;
        setStatus(activeRef.current ? "ready" : "paused");

        let failed = false;
        const onFrame = (frame: LandmarkFrame) => {
          const segment = segmenter.push(frame);
          showPhase(segmenter.state === "signing" ? "signing" : pending > 0 ? "recognising" : phaseOf(frame, aspect));
          if (!segment) return;
          stats.segments++;
          pending++;
          showPhase("recognising");
          const c0 = performance.now();
          classifier
            .decide(windowVariants(segment, aspect))
            .then((d) => {
              stats.decideMs = Math.round((performance.now() - c0) * 10) / 10;
              if (!cancelled && activeRef.current) callback.current({ id: nextId++, ...d, segment, aspect });
            })
            .catch((err) => {
              stats.frameErrors++;
              console.error("sign classification failed", err);
            })
            .finally(() => {
              pending--;
            });
        };

        // A plain timer, not requestVideoFrameCallback: this <video> is never on screen, and Chrome
        // doesn't reliably fire frame callbacks for detached videos.
        const start = performance.now();
        const tick = () => {
          if (cancelled) return;
          const now = performance.now();
          const isActive = activeRef.current;
          if (isActive !== wasActive) {
            // Paused (e.g. reconnecting) or resumed: never finish a sign that started before the gap.
            segmenter.clear();
            if (wasActive && !isActive) stats.pauses++;
            wasActive = isActive;
            setStatus(isActive ? "ready" : "paused");
          }
          if (isActive && video.videoWidth > 0 && video.readyState >= 2) {
            if (ext.busy) {
              stats.framesSkipped++; // previous frame still in the worker: skip, don't queue
            } else {
              const t = now - start;
              createImageBitmap(video)
                .then((bitmap) => ext.detect(bitmap, t))
                .then(({ frame, ms, timings }) => {
                  if (cancelled || !activeRef.current) return;
                  detectTotal += ms;
                  detectCount++;
                  split.pose += timings.pose;
                  split.hand += timings.hand;
                  split.face += timings.face;
                  stats.framesProcessed++;
                  errorsInRow = 0;
                  onFrame(frame);
                })
                .catch((err: Error) => {
                  if (cancelled || err.message === "busy" || err.message === "closed") return;
                  stats.frameErrors++;
                  if (++errorsInRow >= MAX_FRAME_ERRORS) {
                    console.error(err);
                    failed = true;
                    if (running) {
                      running = false;
                      stats.loopsRunning--;
                    }
                    setStatus("error");
                    setError("Sign recognition stopped working (the camera image could not be processed).");
                  }
                });
            }
            if (now - windowStart > 2000) {
              const r = (v: number) => (detectCount ? Math.round((v / detectCount) * 10) / 10 : 0);
              stats.detectMs = r(detectTotal);
              stats.detectSplitMs = { pose: r(split.pose), hand: r(split.hand), face: r(split.face) };
              split.pose = split.hand = split.face = 0;
              detectTotal = 0;
              detectCount = 0;
              windowStart = now;
            }
          }
          if (failed) return; // stop the loop; Retry starts a fresh one
          timer = setTimeout(tick, Math.max(0, EXTRACT_EVERY_MS - (performance.now() - now)));
        };
        tick();
      } catch (err) {
        if (cancelled) return;
        setStatus("error");
        setError(err instanceof Error && err.message.endsWith(".") ? err.message : "Sign recognition could not start.");
      }
    })();

    return () => {
      cancelled = true;
      clearTimeout(timer);
      if (running) stats.loopsRunning--;
      video.pause();
      video.srcObject = null; // drop our reference to the camera track (the call owns and stops it)
      extractor?.close();
      setPhase("no-person");
    };
  }, [track, enabled, attempt]);

  const retry = useCallback(() => setAttempt((a) => a + 1), []);

  return { status, error, phase, retry };
}
