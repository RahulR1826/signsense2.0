"use client";

import { Loader2, RotateCcw, X } from "lucide-react";
import { Component, useCallback, useEffect, useState, type ReactNode } from "react";

import { SignPlayer } from "@/components/signs/sign-player";
import { useSaathiStyle } from "@/lib/saathi-style";
import type { GlossToken } from "@/lib/signs/gloss";
import type { SignLibrary } from "@/lib/signs/library";
import { clipsById, loadRigManifest, stepsFor, type SaathiStep } from "@/lib/signs/saathi-rig";

type LiveModule = typeof import("@/components/saathi/saathi-live");
type Gltf = Awaited<ReturnType<LiveModule["loadSaathiRig"]>>;

const SPEEDS = [0.5, 0.75, 1] as const;

/** Anything thrown while rendering the 3D scene (e.g. WebGL context failure) switches to the fallback player. */
class SceneBoundary extends Component<{ onError: () => void; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(err: unknown) {
    console.warn("Saathi 3D failed; using the fallback player", err);
    this.props.onError();
  }
  render() {
    return this.state.failed ? null : this.props.children;
  }
}

type Mode = { kind: "loading" } | { kind: "live"; mod: LiveModule; gltf: Gltf; steps: SaathiStep[] } | { kind: "fallback"; reason: "2d" | "webgl" | "load" | "scene" };

interface Props {
  library: SignLibrary;
  /** What to show (a new array restarts the sequence). */
  tokens: GlossToken[];
  /** e.g. "Asha signed" / "Asha typed". */
  heading: string;
  onClose: () => void;
  className?: string;
}

/**
 * Saathi in a call: performs received signs and the signs for received text, word by word, with replay and speed
 * control. Live 3D (rigged model, three.js) when WebGL and the model are available; otherwise the pre-rendered /
 * 2D sign player. Nothing here can affect the call itself.
 */
export function SaathiStage({ library, tokens, heading, onClose, className = "" }: Props) {
  const [style] = useSaathiStyle();
  const [mode, setMode] = useState<Mode>({ kind: "loading" });
  const [index, setIndex] = useState(0);
  const [round, setRound] = useState(0);
  const [speed, setSpeed] = useState<(typeof SPEEDS)[number]>(1);

  const labelOf = useCallback((id: string) => library.byId.get(id)?.label, [library]);

  // Load the 3D pieces (code split: three.js is only fetched when Saathi is first needed).
  useEffect(() => {
    let alive = true;
    if (style === "2d") {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- the viewer chose the 2D drawing
      setMode({ kind: "fallback", reason: "2d" });
      return;
    }
    (async () => {
      try {
        const mod = await import("@/components/saathi/saathi-live");
        if (!mod.webglAvailable()) {
          if (alive) setMode({ kind: "fallback", reason: "webgl" });
          return;
        }
        const [manifest, gltf] = await Promise.all([loadRigManifest(), mod.loadSaathiRig()]);
        if (alive) setMode({ kind: "live", mod, gltf, steps: stepsFor(tokens, clipsById(manifest), labelOf) });
      } catch (err) {
        console.warn("Saathi 3D could not load; using the fallback player", err);
        if (alive) setMode({ kind: "fallback", reason: "load" });
      }
    })();
    return () => {
      alive = false;
    };
  }, [style, tokens, labelOf]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- a new sequence starts from the beginning
    setIndex(0);
    setRound((r) => r + 1);
  }, [tokens]);

  const steps = mode.kind === "live" ? mode.steps : [];
  const done = mode.kind === "live" && index >= steps.length;
  const current = steps[index];
  const unsupported = steps.filter((s) => s.kind === "text");
  const onStepEnd = useCallback((i: number) => setIndex((cur) => (cur === i ? i + 1 : cur)), []);
  const replay = () => {
    setIndex(0);
    setRound((r) => r + 1);
  };

  const state = mode.kind === "loading" ? "loading" : mode.kind === "fallback" ? "fallback" : done ? "done" : "playing";

  return (
    <section
      aria-label="Saathi signs"
      className={`flex min-h-0 flex-col overflow-hidden rounded-2xl bg-neutral-900 text-white ring-1 ring-white/10 ${className}`}
      data-saathi-stage={state}
      data-saathi-step={mode.kind === "live" ? index : undefined}
      data-saathi-reason={mode.kind === "fallback" ? mode.reason : undefined}
      data-saathi-speed={speed}
    >
      <div className="flex items-center gap-2 px-3 py-2">
        <p className="min-w-0 flex-1 truncate text-sm font-medium">
          <span className="text-neutral-400">{heading} ·</span> Saathi signs it
        </p>
        <button type="button" onClick={onClose} className="rounded-full p-1.5 hover:bg-white/10" aria-label="Close Saathi">
          <X className="size-4" />
        </button>
      </div>

      {mode.kind === "fallback" ? (
        <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
          <SignPlayer library={library} tokens={tokens} compact />
          {mode.reason !== "2d" && (
            <p className="px-1 pt-1.5 text-[11px] text-neutral-400">
              {mode.reason === "webgl" ? "3D isn’t available in this browser — showing the recorded Saathi instead." : "Live 3D Saathi couldn’t load — showing the recorded Saathi instead."}
            </p>
          )}
        </div>
      ) : (
        <>
          <div className="saathi-stage relative min-h-0 flex-1">
            {mode.kind === "loading" && (
              <p className="absolute inset-0 flex items-center justify-center gap-2 text-sm text-neutral-600">
                <Loader2 className="size-4 animate-spin" aria-hidden /> Loading Saathi…
              </p>
            )}
            {mode.kind === "live" && (
              <SceneBoundary onError={() => setMode({ kind: "fallback", reason: "scene" })}>
                <mode.mod.SaathiLiveCanvas
                  gltf={mode.gltf}
                  steps={steps}
                  index={index}
                  round={round}
                  speed={speed}
                  onStepEnd={onStepEnd}
                  className="!absolute inset-0"
                />
              </SceneBoundary>
            )}
            {current?.kind === "text" && (
              <p className="absolute inset-x-3 top-1/2 -translate-y-1/2 rounded-2xl bg-white/90 px-4 py-3 text-center text-2xl font-semibold text-neutral-900 shadow" aria-live="polite">
                {current.word}
                <span className="mt-1 block text-xs font-normal text-neutral-500">{current.reason === "no-sign" ? "No sign in the dictionary yet" : "No Saathi animation for this sign yet"}</span>
              </p>
            )}
            {done && (
              <button
                type="button"
                onClick={replay}
                className="absolute right-2 bottom-2 flex items-center gap-1.5 rounded-full bg-neutral-900/80 px-3 py-1.5 text-sm text-white hover:bg-neutral-900"
              >
                <RotateCcw className="size-4" aria-hidden /> Replay
              </button>
            )}
          </div>

          <ol className="flex flex-wrap gap-1 px-2 pt-2 text-sm" aria-label="Words">
            {steps.map((s, i) => (
              <li
                key={i}
                aria-current={i === index ? "step" : undefined}
                className={`rounded-md px-2 py-0.5 ${
                  i === index ? "bg-white text-neutral-900" : s.kind === "sign" ? "bg-neutral-700" : "text-neutral-400 line-through decoration-neutral-600"
                }`}
                title={s.kind === "text" ? "Shown as text: no sign available" : undefined}
              >
                {s.kind === "sign" ? s.label : s.word}
              </li>
            ))}
          </ol>
          <div className="flex items-center gap-2 px-2 py-2">
            <button
              type="button"
              onClick={replay}
              disabled={mode.kind !== "live"}
              className="flex items-center gap-1 rounded-full bg-white/10 px-2.5 py-1 text-xs font-medium hover:bg-white/20 disabled:opacity-40"
            >
              <RotateCcw className="size-3.5" aria-hidden /> Replay
            </button>
            <div role="group" aria-label="Speed" className="flex rounded-full bg-white/10 p-0.5 text-xs font-semibold">
              {SPEEDS.map((v) => (
                <button
                  key={v}
                  type="button"
                  aria-pressed={speed === v}
                  onClick={() => setSpeed(v)}
                  className={`rounded-full px-2 py-0.5 ${speed === v ? "bg-white text-neutral-900" : "text-white/70 hover:text-white"}`}
                >
                  {v}×
                </button>
              ))}
            </div>
            {(steps.length > 1 || unsupported.length > 0) && (
              <p className="ml-auto text-right text-[11px] leading-tight text-neutral-400">
                {unsupported.length > 0 ? "Words without a sign are shown as text." : "Word by word, not full ISL grammar."}
              </p>
            )}
          </div>
        </>
      )}
    </section>
  );
}
