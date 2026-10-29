"use client";

import { RotateCcw, X } from "lucide-react";
import { useEffect, useState } from "react";

import { SaathiSign } from "@/components/saathi/saathi-sign";
import { SaathiStyleToggle } from "@/components/saathi/saathi-style-toggle";
import { loadAnimation } from "@/lib/signs/anim";
import type { GlossToken } from "@/lib/signs/gloss";
import type { SignLibrary } from "@/lib/signs/library";

const TEXT_CARD_MS = 1200;

interface Props {
  library: SignLibrary;
  /** Sequence to play; a new array (new identity) starts playback from the beginning. */
  tokens: GlossToken[];
  onClose?: () => void;
  /** Small overlay (in a call): smaller captions, no 3D/2D switch (that lives in the dictionary and Settings). */
  compact?: boolean;
  className?: string;
}

/**
 * Saathi signs a sequence of words one after another. Words without a sign are shown as a large
 * text card for a moment (never fingerspelled). Built for people who may not read: the signing is
 * the message, the caption underneath is secondary.
 */
export function SignPlayer({
  library,
  tokens,
  onClose,
  compact = false,
  className = "",
}: Props) {
  const [index, setIndex] = useState(0);
  const [round, setRound] = useState(0);
  const token = tokens[index];

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- a new sequence restarts the player
    setIndex(0);
  }, [tokens]);

  const sign = token?.kind === "sign" ? library.byId.get(token.id) : undefined;

  useEffect(() => {
    if (!token) return;
    if (token.kind === "text" || !sign) {
      const timer = setTimeout(() => setIndex((i) => i + 1), TEXT_CARD_MS);
      return () => clearTimeout(timer);
    }
  }, [token, sign, round]);

  // Fetch the next sign's motion early so playback doesn't stall between signs.
  const next = tokens[index + 1];
  const nextSign =
    next?.kind === "sign" ? library.byId.get(next.id) : undefined;
  useEffect(() => {
    if (nextSign) loadAnimation(nextSign.anim).catch(() => undefined);
  }, [nextSign]);

  const done = index >= tokens.length;

  return (
    <div
      className={`overflow-hidden rounded-2xl bg-neutral-900 text-white shadow-xl ${className}`}
      aria-live="polite"
    >
      <div className="saathi-stage relative aspect-square w-full">
        {sign && !done && (
          <SaathiSign
            key={`${index}-${round}`}
            sign={sign}
            label={`Saathi signing “${sign.label}”`}
            onEnded={() => setIndex((i) => i + 1)}
            className="size-full"
          />
        )}
        {!done && token?.kind === "text" && (
          <div className="flex size-full items-center justify-center p-4 text-center text-3xl font-semibold text-neutral-900">
            {token.word}
          </div>
        )}
        {done && (
          <button
            type="button"
            onClick={() => {
              setIndex(0);
              setRound((r) => r + 1);
            }}
            className="flex size-full flex-col items-center justify-center gap-2 text-neutral-600 hover:text-neutral-900"
            aria-label="Play the signs again"
          >
            <RotateCcw className="size-10" />
            Play again
          </button>
        )}
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            className="absolute top-2 right-2 rounded-full bg-black/60 p-1.5"
            aria-label="Close signs"
          >
            <X className="size-4" />
          </button>
        )}
      </div>
      <div className={`flex items-start gap-2 ${compact ? "p-1.5" : "p-2"}`}>
        <ol className={`flex flex-1 flex-wrap gap-1 ${compact ? "text-xs" : "text-sm"}`}>
          {tokens.map((t, i) => (
            <li
              key={i}
              className={`rounded-md px-2 py-0.5 ${i === index ? "bg-white text-neutral-900" : t.kind === "sign" ? "bg-neutral-700" : "text-neutral-400"}`}
            >
              {t.kind === "sign"
                ? (library.byId.get(t.id)?.label ?? t.word)
                : t.word}
            </li>
          ))}
        </ol>
        {!compact && <SaathiStyleToggle dark className="shrink-0" />}
      </div>
    </div>
  );
}
