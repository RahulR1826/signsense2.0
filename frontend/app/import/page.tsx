"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { API_URL } from "@/lib/api";
import { drawFrame } from "@/lib/landmarks/draw";
import { LandmarkExtractor } from "@/lib/landmarks/extractor";
import { EXTRACTOR_VERSION, type LandmarkFrame } from "@/lib/landmarks/schema";

// INCLUDE videos are 25 fps; step through every frame by seeking so none are skipped.
const VIDEO_FPS = 25;

interface Item {
  sign: string;
  file: string;
}

interface Pending {
  done: number;
  todo: Item[];
}

function seek(video: HTMLVideoElement, time: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const onSeeked = () => {
      video.removeEventListener("error", onError);
      resolve();
    };
    const onError = () => {
      video.removeEventListener("seeked", onSeeked);
      reject(new Error(video.error?.message ?? "video error"));
    };
    video.addEventListener("seeked", onSeeked, { once: true });
    video.addEventListener("error", onError, { once: true });
    video.currentTime = time;
  });
}

function load(video: HTMLVideoElement, src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    video.onloadeddata = () => resolve();
    video.onerror = () => reject(new Error(video.error?.message ?? "could not load video"));
    video.src = src;
    video.load();
  });
}

async function extractVideo(
  video: HTMLVideoElement,
  canvas: HTMLCanvasElement,
  shouldStop: () => boolean,
): Promise<LandmarkFrame[] | null> {
  // Fresh extractor per video so MediaPipe's tracking state never carries over between clips.
  const extractor = await LandmarkExtractor.create({ face: true });
  try {
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const count = Math.floor(video.duration * VIDEO_FPS);
    const frames: LandmarkFrame[] = [];
    for (let i = 0; i < count; i++) {
      if (shouldStop()) return null;
      await seek(video, (i + 0.5) / VIDEO_FPS);
      const frame = extractor.detect(video, (i * 1000) / VIDEO_FPS);
      frames.push(frame);
      if (i % 3 === 0) drawFrame(canvas, frame);
    }
    return frames;
  } finally {
    extractor.close();
  }
}

export default function ImportPage() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stop = useRef(false);
  const [pending, setPending] = useState<Pending | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [current, setCurrent] = useState<Item | null>(null);
  const [processed, setProcessed] = useState(0);
  const [failures, setFailures] = useState<string[]>([]);
  const [lastStats, setLastStats] = useState<string>("");
  const [startedAt, setStartedAt] = useState(0);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch(
        `${API_URL}/api/dataset/include/pending?extractor_version=${encodeURIComponent(EXTRACTOR_VERSION)}`,
        { cache: "no-store" },
      );
      if (!res.ok) throw new Error(String(res.status));
      setPending(await res.json());
    } catch {
      setError("Can't reach the backend. Start it and reload.");
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  async function run() {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas || !pending) return;
    stop.current = false;
    setRunning(true);
    setProcessed(0);
    setFailures([]);
    setStartedAt(performance.now());

    for (const item of pending.todo) {
      if (stop.current) break;
      setCurrent(item);
      try {
        await load(video, `${API_URL}/api/dataset/include/videos/${item.sign}/${encodeURIComponent(item.file)}`);
        const frames = await extractVideo(video, canvas, () => stop.current);
        if (!frames) break;
        const res = await fetch(`${API_URL}/api/dataset/include/landmarks`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...item, extractorVersion: EXTRACTOR_VERSION, fps: VIDEO_FPS, frames }),
        });
        if (!res.ok) throw new Error(`save failed (${res.status})`);
        const hands = frames.filter((f) => f.leftHand || f.rightHand).length;
        const pose = frames.filter((f) => f.pose).length;
        setLastStats(`${item.sign}: ${frames.length} frames, hands in ${hands}, pose in ${pose}`);
        setProcessed((n) => n + 1);
      } catch (err) {
        setFailures((f) => [...f, `${item.sign}/${item.file}: ${String(err)}`]);
      }
    }
    setCurrent(null);
    setRunning(false);
    await refresh();
  }

  const total = pending ? pending.done + pending.todo.length : 0;
  const done = (pending?.done ?? 0) + processed;
  const elapsedMin = running && startedAt ? (performance.now() - startedAt) / 60000 : 0;
  const rate = processed > 0 && elapsedMin > 0 ? processed / elapsedMin : 0;
  const remaining = pending ? pending.todo.length - processed : 0;

  return (
    <main className="mx-auto w-full max-w-5xl space-y-6 px-4 py-8">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="text-2xl font-semibold">INCLUDE import</h1>
        <Link href="/landmarks" className="text-sm underline underline-offset-4">
          Landmark viewer
        </Link>
      </div>
      <p className="text-sm text-muted-foreground">
        Runs every downloaded INCLUDE video through the same browser landmark extractor as the webcam and saves the
        landmarks to <code>ml/data/include/landmarks/</code>. Safe to stop and resume. Keep this tab in the foreground.
      </p>
      {error && <p className="rounded-md bg-red-50 p-3 text-sm text-red-700">{error}</p>}

      <div className="grid gap-6 md:grid-cols-[1fr_300px]">
        <div className="relative aspect-video w-full overflow-hidden rounded-xl bg-black">
          <video ref={videoRef} className="absolute inset-0 size-full object-contain" muted playsInline crossOrigin="anonymous" />
          <canvas ref={canvasRef} className="absolute inset-0 size-full object-contain" />
        </div>

        <aside className="space-y-4 text-sm">
          <div className="space-y-1">
            <div className="flex justify-between">
              <span>Progress</span>
              <span className="tabular-nums">
                {done} / {total}
              </span>
            </div>
            <div className="h-2 rounded bg-muted">
              <div className="h-full rounded bg-foreground" style={{ width: total ? `${(done / total) * 100}%` : 0 }} />
            </div>
            {rate > 0 && (
              <p className="text-muted-foreground">
                {rate.toFixed(1)} videos/min · ~{Math.ceil(remaining / rate)} min left
              </p>
            )}
          </div>

          {running ? (
            <Button size="lg" variant="destructive" className="w-full" onClick={() => (stop.current = true)}>
              Stop
            </Button>
          ) : (
            <Button size="lg" className="w-full" disabled={!pending || pending.todo.length === 0} onClick={run}>
              {pending && pending.todo.length === 0 ? "All videos imported" : `Import ${pending?.todo.length ?? ""} videos`}
            </Button>
          )}

          {current && (
            <p className="break-all text-muted-foreground">
              Now: {current.sign} / {current.file}
            </p>
          )}
          {lastStats && <p className="text-muted-foreground">Last: {lastStats}</p>}
          {failures.length > 0 && (
            <div className="space-y-1">
              <p className="font-medium text-red-700">{failures.length} failed (rerun to retry)</p>
              <ul className="max-h-40 overflow-y-auto text-xs text-red-700">
                {failures.map((f) => (
                  <li key={f}>{f}</li>
                ))}
              </ul>
            </div>
          )}
        </aside>
      </div>
    </main>
  );
}
