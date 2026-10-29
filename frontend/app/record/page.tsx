"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";

import { LandmarkCamera, type CameraStatus } from "@/components/landmark-camera";
import { Button } from "@/components/ui/button";
import {
  NO_SIGN,
  SIGNER_PATTERN,
  checkTake,
  deleteSample,
  fetchSummary,
  fetchVocabulary,
  saveSample,
  toSignerId,
  type DatasetSummary,
  type SavedSample,
  type Sign,
} from "@/lib/dataset";
import type { LandmarkFrame } from "@/lib/landmarks/schema";

const TARGET_PER_SIGN = 30;
const DURATIONS = [2000, 3000, 4000];
const TAKE_COUNTS = [1, 5, 10];
const SIGNER_KEY = "signsense.recorder.signer";

type Phase =
  | { kind: "idle" }
  | { kind: "countdown"; seconds: number; take: number; of: number }
  | { kind: "recording"; take: number; of: number; startedAt: number }
  | { kind: "saving" };

type Result = { ok: boolean; message: string };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export default function RecordPage() {
  const [vocab, setVocab] = useState<Sign[]>([]);
  const [summary, setSummary] = useState<DatasetSummary>({ total: 0, counts: {} });
  const [apiError, setApiError] = useState<string | null>(null);
  const [signerName, setSignerName] = useState("");
  const [sign, setSign] = useState<string>("hello");
  const [duration, setDuration] = useState(3000);
  const [takes, setTakes] = useState(5);
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const [result, setResult] = useState<Result | null>(null);
  const [lastSaved, setLastSaved] = useState<SavedSample | null>(null);
  const [cameraReady, setCameraReady] = useState(false);

  const recording = useRef<{ start: number; frames: LandmarkFrame[] } | null>(null);
  const stopRequested = useRef(false);
  const cameraSize = useRef<{ width: number; height: number } | null>(null);

  const signer = toSignerId(signerName);
  const signerValid = SIGNER_PATTERN.test(signer);
  const busy = phase.kind !== "idle";
  const countFor = (id: string) => summary.counts[id]?.[signer] ?? 0;

  const refresh = useCallback(() => fetchSummary().then(setSummary), []);

  useEffect(() => {
    try {
      // Read after hydration: localStorage doesn't exist during server rendering.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setSignerName(localStorage.getItem(SIGNER_KEY) ?? "");
    } catch {}
    Promise.all([fetchVocabulary().then(setVocab), refresh()]).catch(() =>
      setApiError("Can't reach the backend. Start it and reload."),
    );
  }, [refresh]);

  useEffect(() => {
    try {
      localStorage.setItem(SIGNER_KEY, signerName);
    } catch {}
  }, [signerName]);

  const onFrame = useCallback((frame: LandmarkFrame) => {
    const rec = recording.current;
    if (!rec) return;
    // Frame timestamps are relative to the camera stream; the first recorded frame becomes t = 0.
    if (rec.start < 0) rec.start = frame.t;
    rec.frames.push({ ...frame, t: frame.t - rec.start });
  }, []);

  const onStatus = useCallback((s: CameraStatus) => {
    setCameraReady(s.kind === "ready");
    if (s.kind === "ready") cameraSize.current = { width: s.width, height: s.height };
  }, []);

  const runSession = useCallback(async () => {
    stopRequested.current = false;
    setResult(null);
    for (let take = 1; take <= takes && !stopRequested.current; take++) {
      for (let s = take === 1 ? 3 : 2; s > 0 && !stopRequested.current; s--) {
        setPhase({ kind: "countdown", seconds: s, take, of: takes });
        await sleep(1000);
      }
      if (stopRequested.current) break;

      const startedAt = performance.now();
      const rec = { start: -1, frames: [] as LandmarkFrame[] };
      recording.current = rec;
      setPhase({ kind: "recording", take, of: takes, startedAt });
      await sleep(duration);
      const frames = rec.frames;
      recording.current = null;

      const problem = checkTake(sign, frames);
      if (problem) {
        setResult({ ok: false, message: `Take ${take} not saved: ${problem}` });
        continue;
      }
      setPhase({ kind: "saving" });
      try {
        const saved = await saveSample(sign, signer, duration, frames, cameraSize.current);
        setLastSaved(saved);
        setResult({ ok: true, message: `Take ${take} saved (${frames.length} frames).` });
        await refresh();
      } catch (err) {
        setResult({ ok: false, message: `Save failed: ${String(err)}` });
        break;
      }
    }
    recording.current = null;
    setPhase({ kind: "idle" });
  }, [takes, duration, sign, signer, refresh]);

  const canRecord = cameraReady && signerValid && !busy && !apiError;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).tagName === "INPUT") return;
      if (e.code === "Space" && canRecord) {
        e.preventDefault();
        runSession();
      } else if (e.code === "Escape") {
        stopRequested.current = true;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [canRecord, runSession]);

  async function discardLast() {
    if (!lastSaved) return;
    try {
      await deleteSample(lastSaved);
      setResult({ ok: true, message: "Last take discarded." });
      setLastSaved(null);
      await refresh();
    } catch {
      setResult({ ok: false, message: "Couldn't discard the last take." });
    }
  }

  const selected = vocab.find((s) => s.id === sign);

  return (
    <main className="mx-auto w-full max-w-6xl space-y-6 px-4 py-8">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="text-2xl font-semibold">Sign recorder</h1>
        <div className="flex gap-4 text-sm">
          <span className="text-muted-foreground">Dataset: {summary.total} samples</span>
          <Link href="/landmarks" className="underline underline-offset-4">
            Landmark viewer
          </Link>
        </div>
      </div>

      {apiError && <p className="rounded-md bg-red-50 p-3 text-sm text-red-700">{apiError}</p>}

      <div className="grid gap-6 lg:grid-cols-[1fr_380px]">
        <div className="space-y-3">
          <LandmarkCamera face onFrame={onFrame} onStatus={onStatus}>
            <PhaseOverlay phase={phase} duration={duration} label={selected?.label ?? sign} />
          </LandmarkCamera>
          <p className="text-sm text-muted-foreground">
            Each take: start with hands down, sign <strong>{selected?.label ?? sign}</strong> once, return hands down.
            Keep shoulders and hands in frame. Press <kbd>Space</kbd> to record, <kbd>Esc</kbd> to stop.
          </p>
        </div>

        <aside className="space-y-5">
          <label className="block space-y-1 text-sm">
            <span className="font-medium">Signer name</span>
            <input
              className="w-full rounded-md border bg-background px-3 py-2"
              value={signerName}
              onChange={(e) => setSignerName(e.target.value)}
              placeholder="e.g. rahul"
              disabled={busy}
            />
            <span className="text-xs text-muted-foreground">
              {signerValid ? `Saved as “${signer}”. Use a different name for each person.` : "Enter a name to start."}
            </span>
          </label>

          <div className="space-y-2">
            <span className="text-sm font-medium">Sign</span>
            <div className="grid max-h-80 grid-cols-2 gap-2 overflow-y-auto pr-1">
              {vocab.map((s) => {
                const n = countFor(s.id);
                return (
                  <button
                    key={s.id}
                    type="button"
                    disabled={busy}
                    onClick={() => setSign(s.id)}
                    className={`rounded-md border px-3 py-2 text-left text-sm transition-colors ${
                      s.id === sign ? "border-foreground bg-accent" : "hover:bg-accent/50"
                    } ${s.id === NO_SIGN ? "col-span-2" : ""}`}
                  >
                    <span className="block font-medium">{s.label}</span>
                    <span className={`text-xs ${n >= TARGET_PER_SIGN ? "text-green-600" : "text-muted-foreground"}`}>
                      {n}/{TARGET_PER_SIGN}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3 text-sm">
            <label className="space-y-1">
              <span className="font-medium">Take length</span>
              <select
                className="w-full rounded-md border bg-background px-2 py-2"
                value={duration}
                onChange={(e) => setDuration(Number(e.target.value))}
                disabled={busy}
              >
                {DURATIONS.map((d) => (
                  <option key={d} value={d}>
                    {d / 1000} s
                  </option>
                ))}
              </select>
            </label>
            <label className="space-y-1">
              <span className="font-medium">Takes in a row</span>
              <select
                className="w-full rounded-md border bg-background px-2 py-2"
                value={takes}
                onChange={(e) => setTakes(Number(e.target.value))}
                disabled={busy}
              >
                {TAKE_COUNTS.map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div className="flex gap-2">
            {busy ? (
              <Button size="lg" variant="destructive" className="flex-1" onClick={() => (stopRequested.current = true)}>
                Stop
              </Button>
            ) : (
              <Button size="lg" className="flex-1" disabled={!canRecord} onClick={runSession}>
                Record {takes > 1 ? `${takes} takes` : "take"}
              </Button>
            )}
            <Button size="lg" variant="outline" disabled={!lastSaved || busy} onClick={discardLast}>
              Discard last
            </Button>
          </div>

          {result && (
            <p className={`text-sm ${result.ok ? "text-green-700" : "text-red-700"}`} role="status">
              {result.message}
            </p>
          )}
        </aside>
      </div>
    </main>
  );
}

function PhaseOverlay({ phase, duration, label }: { phase: Phase; duration: number; label: string }) {
  const [now, setNow] = useState(0);
  useEffect(() => {
    if (phase.kind !== "recording") return;
    let id = requestAnimationFrame(function loop() {
      setNow(performance.now());
      id = requestAnimationFrame(loop);
    });
    return () => cancelAnimationFrame(id);
  }, [phase.kind]);

  if (phase.kind === "countdown") {
    return (
      <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/40 text-white">
        <span className="text-sm">
          Take {phase.take}/{phase.of} — get ready to sign “{label}”
        </span>
        <span className="text-8xl font-bold tabular-nums">{phase.seconds}</span>
      </div>
    );
  }
  if (phase.kind === "recording") {
    const progress = Math.min(1, Math.max(0, (now - phase.startedAt) / duration));
    return (
      <div className="pointer-events-none absolute inset-0 rounded-xl ring-8 ring-red-600 ring-inset">
        <span className="absolute top-3 left-3 rounded bg-red-600 px-2 py-0.5 text-sm font-semibold text-white">
          ● REC {phase.take}/{phase.of}
        </span>
        <div className="absolute inset-x-0 bottom-0 h-2 bg-black/40">
          <div className="h-full bg-red-600" style={{ width: `${progress * 100}%` }} />
        </div>
      </div>
    );
  }
  if (phase.kind === "saving") {
    return <span className="absolute top-3 left-3 rounded bg-black/70 px-2 py-0.5 text-sm text-white">Saving…</span>;
  }
  return null;
}
