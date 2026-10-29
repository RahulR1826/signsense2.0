"use client";

import { Play } from "lucide-react";
import { useEffect, useState } from "react";

import { SaathiSign } from "@/components/saathi/saathi-sign";
import { useMediaQuery } from "@/hooks/use-media-query";
import { loadSignLibrary, type LibrarySign } from "@/lib/signs/library";

// Common, visually distinct words from the vocabulary. Not a claim that these are recognised best:
// the recogniser decides, and says when it is unsure.
const SUGGESTED = ["hello", "thank_you", "father", "happy", "sick", "today"];

/** "Not sure what to sign?": watch Saathi sign a word, then try it at the camera. */
export function WatchSaathi() {
  const [signs, setSigns] = useState<LibrarySign[]>([]);
  const [current, setCurrent] = useState<LibrarySign | null>(null);
  const [round, setRound] = useState(0);
  // With reduced motion, Saathi only moves after the viewer asks (taps a word or the tile).
  const reduced = useMediaQuery("(prefers-reduced-motion: reduce)");
  useEffect(() => {
    loadSignLibrary()
      .then((lib) => {
        const list = SUGGESTED.map((id) => lib.byId.get(id)).filter((s): s is LibrarySign => !!s);
        setSigns(list);
        setCurrent(list[0] ?? null);
      })
      .catch(() => undefined);
  }, []);

  if (!signs.length || !current) return null;
  return (
    <section aria-labelledby="watch-title" className="flex flex-col gap-4 rounded-3xl border bg-card p-4 shadow-[var(--shadow-soft)] sm:flex-row sm:items-center sm:p-5">
      <button
        type="button"
        onClick={() => setRound((r) => r + 1)}
        className="saathi-stage relative mx-auto block size-40 shrink-0 overflow-hidden rounded-2xl sm:mx-0"
        aria-label={`Play Saathi signing “${current.label}” again`}
      >
        <SaathiSign key={`${current.id}-${round}`} sign={current} playing={!reduced || round > 0} label="" className="size-full" />
        <span className="absolute right-1.5 bottom-1.5 flex size-7 items-center justify-center rounded-full bg-black/55 text-white" aria-hidden>
          <Play className="size-3.5" />
        </span>
      </button>
      <div className="min-w-0 space-y-3">
        <div>
          <h2 id="watch-title" className="font-sans text-base font-semibold">
            Not sure what to sign? Watch Saathi first
          </h2>
          <p className="text-sm text-muted-foreground">Pick a word, watch it, then sign it to your camera.</p>
        </div>
        <div className="flex flex-wrap gap-2" role="group" aria-label="Word to watch">
          {signs.map((s) => (
            <button
              key={s.id}
              type="button"
              aria-pressed={s.id === current.id}
              onClick={() => {
                setCurrent(s);
                setRound((r) => r + 1);
              }}
              className={`rounded-full border px-3 py-1.5 text-sm font-medium transition-colors active:scale-[0.97] ${
                s.id === current.id ? "border-brand bg-brand text-brand-foreground" : "bg-background hover:border-brand/50"
              }`}
            >
              {s.label}
            </button>
          ))}
        </div>
      </div>
    </section>
  );
}
