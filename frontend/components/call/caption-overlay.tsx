"use client";

import { Hand, Keyboard, Mic } from "lucide-react";
import { useEffect, useState } from "react";

import type { Entry } from "@/hooks/use-conversation";

const SHOW_FOR_MS = 6000;
const ICONS = { speech: Mic, chat: Keyboard, sign: Hand } as const;

/** Large, high-contrast text over the other person's video: what they just said, typed or signed. */
export function CaptionOverlay({ entries }: { entries: Entry[] }) {
  const latest = [...entries].reverse().find((e) => e.from === "them");
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!latest) return;
    const timer = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(timer);
  }, [latest]);

  if (!latest || (latest.final && now - latest.at > SHOW_FOR_MS)) return null;
  const Icon = ICONS[latest.kind];

  return (
    <div className="pointer-events-none absolute inset-x-4 bottom-4 flex justify-center sm:inset-x-16" aria-hidden>
      <p className="flex max-w-3xl items-start gap-3 rounded-2xl bg-black/80 px-5 py-3 text-2xl leading-snug font-medium text-white sm:text-3xl">
        <Icon className="mt-1 size-6 shrink-0 text-white/70" />
        <span className={latest.final ? "" : "text-white/85"}>{latest.text}</span>
      </p>
    </div>
  );
}
