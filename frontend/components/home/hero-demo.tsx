"use client";

import { Check, Hand, Volume2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { SaathiSign } from "@/components/saathi/saathi-sign";
import { loadSignLibrary, type LibrarySign } from "@/lib/signs/library";

// An ILLUSTRATION of a call (labelled as such on screen): Saathi signs "Hello" from the dictionary motion, and
// the states shown are the ones the real call screen uses. Nothing is recognised here.
const PHASES = ["ready", "watching", "sending", "sent"] as const;
type Phase = (typeof PHASES)[number];
const PHASE_MS: Record<Phase, number> = { ready: 1600, watching: 2200, sending: 2000, sent: 2600 };

function useReducedMotion() {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const mq = matchMedia("(prefers-reduced-motion: reduce)");
    // eslint-disable-next-line react-hooks/set-state-in-effect -- read the user preference after hydration
    setReduced(mq.matches);
    const on = () => setReduced(mq.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  return reduced;
}

export function HeroDemo() {
  const [sign, setSign] = useState<LibrarySign | null>(null);
  const [phase, setPhase] = useState<Phase>("ready");
  const [visible, setVisible] = useState(false);
  const reduced = useReducedMotion();
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    loadSignLibrary()
      .then((lib) => setSign(lib.byId.get("hello") ?? lib.signs[0] ?? null))
      .catch(() => undefined);
  }, []);

  // Only animate while on screen.
  useEffect(() => {
    const el = root.current;
    if (!el) return;
    const io = new IntersectionObserver(([e]) => setVisible(e.isIntersecting));
    io.observe(el);
    return () => io.disconnect();
  }, []);

  useEffect(() => {
    if (reduced || !visible) return;
    const t = setTimeout(() => setPhase((p) => PHASES[(PHASES.indexOf(p) + 1) % PHASES.length]), PHASE_MS[phase]);
    return () => clearTimeout(t);
  }, [phase, reduced, visible]);

  const shown: Phase = reduced ? "sent" : phase;

  return (
    <div ref={root} className="relative">
      <div aria-hidden className="absolute -inset-6 -z-10 rounded-[2.5rem] bg-gradient-to-br from-brand/25 via-sky-400/10 to-coral/25 blur-2xl" />
      <figure className="overflow-hidden rounded-[1.75rem] border border-white/10 bg-ink p-3 text-ink-foreground shadow-[var(--shadow-lift)]">
        <div className="flex items-center justify-between px-2 pb-3 text-xs text-ink-muted">
          <span className="flex items-center gap-2">
            <span className="flex size-6 items-center justify-center rounded-md bg-brand">
              <Hand className="size-3.5" aria-hidden />
            </span>
            SS-7F4K2
          </span>
          <span className="flex items-center gap-1.5">
            <span className="size-2 rounded-full bg-emerald-400" aria-hidden /> Connected
          </span>
        </div>

        <div className="grid grid-cols-[1.25fr_1fr] gap-2">
          {/* Signer: Saathi */}
          <div className="saathi-stage relative aspect-[3/4] overflow-hidden rounded-2xl">
            {sign ? (
              <SaathiSign
                sign={sign}
                playing={!reduced && visible}
                loop
                label="Saathi signing “Hello” in ISL"
                className="size-full"
              />
            ) : (
              <div className="size-full animate-pulse bg-white/5" />
            )}
            <span className="absolute bottom-2 left-2 rounded-md bg-black/60 px-2 py-0.5 text-xs">Signer (Saathi)</span>
          </div>
          {/* Listener */}
          <div className="flex flex-col gap-2">
            <div className="flex aspect-[4/3] items-center justify-center rounded-2xl bg-gradient-to-br from-slate-600 to-slate-800">
              <span className="flex size-12 items-center justify-center rounded-full bg-white/15"><Volume2 className="size-5" aria-hidden /></span>
            </div>
            <div className="flex flex-1 flex-col justify-end gap-2 rounded-2xl bg-white/5 p-2.5 text-sm">
              <p className="text-[11px] text-ink-muted">Listener&apos;s screen</p>
              <div
                className={`flex items-center gap-2 self-start rounded-2xl bg-white px-3 py-1.5 font-semibold text-neutral-900 transition-all duration-500 ${
                  shown === "sent" ? "translate-y-0 opacity-100" : "translate-y-2 opacity-0"
                }`}
              >
                Hello
                <Volume2 className="size-4 text-brand" aria-label="read aloud" />
              </div>
            </div>
          </div>
        </div>

        {/* The signer's recognition strip, as in the real call */}
        <div className="mt-2 min-h-[4.5rem] rounded-2xl bg-white/5 p-2.5" aria-hidden>
          {shown === "sending" ? (
            <div className="rounded-xl bg-white p-2.5 text-neutral-900">
              <p className="text-[11px] text-neutral-500">Sending your sign…</p>
              <p className="text-lg leading-tight font-semibold">Hello</p>
              <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-neutral-200">
                <div className="h-full origin-left animate-[progress_2s_linear_both] bg-brand" />
              </div>
            </div>
          ) : (
            <p className="flex h-full min-h-[3.25rem] items-center gap-2 px-1 text-sm">
              {shown === "sent" ? (
                <>
                  <Check className="size-4 text-emerald-300" /> <span className="text-emerald-300">Sent “Hello”</span>
                </>
              ) : shown === "watching" ? (
                <>
                  <Hand className="size-4 text-emerald-300" /> <span className="text-emerald-300">Watching your sign…</span>
                </>
              ) : (
                <>
                  <Hand className="size-4 text-ink-muted" /> <span className="text-ink-muted">Ready — raise your hands to sign</span>
                </>
              )}
            </p>
          )}
        </div>
        <figcaption className="px-2 pt-2.5 text-[11px] text-ink-muted">
          Illustration of a call: Saathi signs “Hello” as in the dictionary. Try the real recogniser on the Practice page.
        </figcaption>
      </figure>
    </div>
  );
}
