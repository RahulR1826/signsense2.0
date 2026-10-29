"use client";

import { Camera, CameraOff, CircleHelp, Hand, HelpCircle, Loader2, Lock, Sparkles, Square } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";

import { RecognitionBar } from "@/components/call/recognition-bar";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import { WatchSaathi } from "@/components/try/watch-saathi";
import { Button } from "@/components/ui/button";
import { useMe } from "@/hooks/use-me";
import { usePersonalSigns } from "@/hooks/use-personal-signs";
import { prewarmRecognition, releasePrewarmed, useSignRecognition, type SignResult } from "@/hooks/use-sign-recognition";
import { getCameraOnly, mediaErrorKind, stopMedia, type MediaError } from "@/lib/call/media";
import type { DecisionPolicy } from "@/lib/signs/decision";
import { matchPersonal } from "@/lib/signs/personal";

const DECISION = {
  accept: { text: "Recognised", tone: "text-success", Icon: Hand },
  suggest: { text: "Not sure — in a call you would pick the right one", tone: "text-warning", Icon: CircleHelp },
  reject: { text: "No supported sign detected", tone: "text-muted-foreground", Icon: HelpCircle },
} as const;

const CAMERA_HELP: Record<MediaError, { title: string; body: string }> = {
  denied: {
    title: "Camera access is blocked",
    body: "Click the camera icon in the address bar, choose “Allow”, then press Try again.",
  },
  not_found: { title: "No camera found", body: "Connect a webcam (or use a laptop or phone with one), then press Try again." },
  in_use: { title: "Your camera is busy", body: "Another app or tab is using it. Close that app, then press Try again." },
  other: { title: "The camera couldn't start", body: "Reload the page and try again. Chrome or Edge work best." },
};

const pct = (p: number) => `${Math.round(p * 100)}%`;

interface ModelInfo {
  classes: string[];
  policy?: DecisionPolicy;
  runId?: string;
}

/**
 * Practise signing outside a call. Uses exactly the call's recognition pipeline (hooks/use-sign-recognition:
 * MediaPipe in a Web Worker -> segmenter -> ONNX -> decision policy), so what you see here is what a call does.
 */
export default function TryPage() {
  const { user, setUser } = useMe();
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [starting, setStarting] = useState(false);
  const [cameraError, setCameraError] = useState<MediaError | null>(null);
  const [results, setResults] = useState<SignResult[]>([]);
  const [model, setModel] = useState<ModelInfo | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);

  const personal = usePersonalSigns(!!user);
  const onResult = useCallback(
    (raw: SignResult) => {
      // Same rule as in calls: when no built-in sign is confident, check the user's own signs.
      let r = raw;
      if (raw.decision !== "accept" && raw.embedding && personal.threshold && personal.refs.length) {
        const m = matchPersonal(raw.embedding, personal.refs, personal.threshold);
        if (m) r = { ...raw, decision: "suggest", personal: m };
      }
      setResults((list) => [r, ...list].slice(0, 12));
    },
    [personal.refs, personal.threshold],
  );
  const recognition = useSignRecognition(stream, !!stream, true, onResult);

  // Load the models in the background once the page has settled, so "Turn on camera" is quick.
  useEffect(() => {
    const t = setTimeout(prewarmRecognition, 1200);
    return () => {
      clearTimeout(t);
      releasePrewarmed();
    };
  }, []);

  useEffect(() => {
    fetch("/models/signs/config.json")
      .then((r) => (r.ok ? r.json() : null))
      .then(setModel)
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    v.srcObject = stream;
    if (stream) v.play().catch(() => undefined);
  }, [stream]);

  // Release the camera when leaving the page.
  useEffect(() => () => stopMedia(stream), [stream]);

  async function start() {
    setStarting(true);
    setCameraError(null);
    try {
      setStream(await getCameraOnly());
    } catch (err) {
      setCameraError(mediaErrorKind(err));
    } finally {
      setStarting(false);
    }
  }

  function stop() {
    stopMedia(stream);
    setStream(null);
  }

  const latest = results[0];
  const policy = model?.policy;
  const knownSigns = model ? model.classes.filter((c) => c !== policy?.unknownLabel).length : null;

  return (
    <>
      <SiteHeader user={user} onSignedOut={() => setUser(null)} />
      <main id="main" className="mx-auto w-full max-w-6xl flex-1 space-y-6 px-4 py-8 sm:px-6">
        <div className="max-w-2xl space-y-2">
          <h1 className="text-3xl font-bold sm:text-4xl">Practice signing</h1>
          <p className="text-muted-foreground">
            Sign one word at a time and see what the recogniser understands — exactly as it would in a call. No account needed.
          </p>
        </div>

        <div className="grid gap-6 lg:grid-cols-[1fr_380px]">
          <div className="space-y-3">
            <div className="relative aspect-[4/3] overflow-hidden rounded-3xl bg-ink shadow-[var(--shadow-lift)]">
              <video ref={videoRef} muted playsInline className={`size-full -scale-x-100 object-contain ${stream ? "" : "hidden"}`} />
              {!stream && (
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 p-6 text-center text-ink-foreground">
                  {cameraError ? (
                    <>
                      <CameraOff className="size-10 text-coral" aria-hidden />
                      <div role="alert" className="max-w-sm space-y-1">
                        <p className="text-lg font-semibold">{CAMERA_HELP[cameraError].title}</p>
                        <p className="text-sm text-ink-muted">{CAMERA_HELP[cameraError].body}</p>
                      </div>
                      <Button size="xl" onClick={start} disabled={starting} className="bg-white text-neutral-900 hover:bg-white/90">
                        Try again
                      </Button>
                    </>
                  ) : (
                    <>
                      <span className="flex size-16 items-center justify-center rounded-2xl bg-white/10">
                        <Camera className="size-8" aria-hidden />
                      </span>
                      <div className="max-w-sm space-y-1">
                        <p className="text-lg font-semibold">Turn on your camera to start</p>
                        <p className="text-sm text-ink-muted">Your browser will ask for permission. The video stays on this device.</p>
                      </div>
                      <Button size="xl" onClick={start} disabled={starting} className="bg-white text-neutral-900 hover:bg-white/90">
                        {starting ? <Loader2 className="animate-spin" aria-hidden /> : <Camera />} {starting ? "Starting camera…" : "Turn on camera"}
                      </Button>
                    </>
                  )}
                </div>
              )}
              {stream && (
                <Button
                  variant="secondary"
                  size="lg"
                  onClick={stop}
                  className="absolute top-3 right-3 bg-black/65 text-white hover:bg-black/80"
                >
                  <Square className="size-3.5 fill-current" aria-hidden /> Stop camera
                </Button>
              )}
            </div>
            {stream && (
              <RecognitionBar
                hasCamera
                camOn
                status={recognition.status}
                phase={recognition.phase}
                error={recognition.error}
                note={null}
                onRetry={recognition.retry}
              />
            )}
            <ol className="grid gap-2 text-sm text-muted-foreground sm:grid-cols-3">
              {["Start with your hands down, shoulders and hands in view.", "Sign one word.", "Put your hands down — the result appears."].map((t, i) => (
                <li key={t} className="flex gap-2 rounded-2xl border bg-card p-3">
                  <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-brand-soft text-xs font-semibold text-brand">{i + 1}</span>
                  {t}
                </li>
              ))}
            </ol>
            <WatchSaathi />
          </div>

          <aside className="space-y-5">
            <section className="rounded-3xl border bg-card p-5 shadow-[var(--shadow-soft)]" aria-live="polite" aria-label="Latest result">
              {!latest ? (
                <p className="text-muted-foreground">{stream ? "Sign a word — the result appears here." : "Results appear here."}</p>
              ) : (
                <div
                  key={latest.id}
                  className="[animation:toast-in_0.35s_var(--ease-out-soft)_backwards]"
                  data-result-id={latest.id}
                  data-result-decision={latest.decision}
                  data-result-top={latest.ranked[0]?.label ?? ""}
                  data-result-prob={latest.ranked[0]?.prob.toFixed(3) ?? ""}
                >
                  {latest.personal && (
                    <>
                      <p className="flex items-center gap-2 text-sm font-medium text-brand">
                        <Sparkles className="size-4" aria-hidden /> Looks like one of your signs
                      </p>
                      <p className="mt-1 font-heading text-4xl font-bold">
                        {latest.personal.emoji && <span aria-hidden>{latest.personal.emoji} </span>}
                        {latest.personal.label}
                      </p>
                      <p className="mt-2 text-xs text-muted-foreground">In a call this is offered as a choice; it is never sent without a tap.</p>
                    </>
                  )}
                  {!latest.personal && (() => {
                    const { text, tone, Icon } = DECISION[latest.decision];
                    return (
                      <p className={`flex items-center gap-2 text-sm font-medium ${tone}`}>
                        <Icon className="size-4" aria-hidden /> {text}
                      </p>
                    );
                  })()}
                  {latest.decision === "accept" && latest.ranked[0] && (
                    <p className="mt-1 font-heading text-4xl font-bold">{latest.ranked[0].text}</p>
                  )}
                  {latest.decision !== "reject" && !latest.personal && (
                    <ul className="mt-4 space-y-1.5 text-sm">
                      {latest.ranked.slice(0, 3).map((p) => (
                        <li key={p.label} className="flex items-center gap-2">
                          <span className="w-28 truncate">{p.text}</span>
                          <span className="h-2 flex-1 rounded-full bg-muted">
                            <span className="block h-full rounded-full bg-brand" style={{ width: `${p.prob * 100}%` }} />
                          </span>
                          <span className="w-10 text-right tabular-nums text-muted-foreground">{pct(p.prob)}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                  {!latest.stable && latest.decision !== "reject" && (
                    <p className="mt-3 text-xs text-muted-foreground">The model&apos;s answer changed during the sign, so it isn&apos;t sure.</p>
                  )}
                </div>
              )}
            </section>

            {results.length > 1 && (
              <section className="space-y-2 text-sm">
                <h2 className="font-sans font-medium">Earlier</h2>
                <ul className="space-y-1 text-muted-foreground">
                  {results.slice(1).map((r) => (
                    <li key={r.id}>
                      {r.personal
                        ? `${r.personal.label} (your sign)`
                        : r.decision === "reject"
                          ? "— no supported sign"
                          : `${r.ranked[0]?.text ?? "?"} · ${pct(r.ranked[0]?.prob ?? 0)}`}
                      {r.decision === "suggest" && " (not sure)"}
                    </li>
                  ))}
                </ul>
              </section>
            )}

            {model && (
              <section className="space-y-2 rounded-3xl border bg-card p-4 text-xs text-muted-foreground">
                <p>
                  Knows {knownSigns} ISL signs from the INCLUDE dataset{policy?.unknownLabel ? ", and was trained to reject other signs" : ""}. See them
                  all in the{" "}
                  <Link href="/signs" className="underline">
                    dictionary
                  </Link>
                  .
                </p>
                {policy && (
                  <p>
                    The percentages are the model&apos;s scores, not a guarantee. In a call, a sign is only sent by itself at ≥ {pct(policy.acceptThreshold)}{" "}
                    when the whole sign agrees; between {pct(policy.suggestThreshold)} and that, you choose. Thresholds were set on held-out validation clips.
                  </p>
                )}
                <p className="flex items-center gap-1.5">
                  <Lock className="size-3.5" aria-hidden /> Runs on this device (model {model.runId ?? "unknown"}).
                </p>
              </section>
            )}
          </aside>
        </div>
      </main>
      <SiteFooter />
    </>
  );
}
