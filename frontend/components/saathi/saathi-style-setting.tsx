"use client";

import { Check } from "lucide-react";
import { useEffect, useState } from "react";

import { SaathiSign } from "@/components/saathi/saathi-sign";
import { useSaathiStyle, type SaathiStyle } from "@/lib/saathi-style";
import { loadSignLibrary, type LibrarySign } from "@/lib/signs/library";

const OPTIONS: { value: SaathiStyle; title: string; text: string }[] = [
  { value: "3d", title: "3D", text: "Shading shows depth and which way the hands face." },
  { value: "2d", title: "2D", text: "A simple drawing. Lighter on slow connections." },
];

/** Settings: choose how Saathi appears, with a live preview of each style signing "Hello". */
export function SaathiStyleSetting() {
  const [style, setStyle] = useSaathiStyle();
  const [hello, setHello] = useState<LibrarySign | null>(null);
  const [hover, setHover] = useState<SaathiStyle | null>(null);
  useEffect(() => {
    loadSignLibrary()
      .then((lib) => setHello(lib.byId.get("hello") ?? null))
      .catch(() => undefined);
  }, []);

  return (
    <div role="radiogroup" aria-label="How Saathi appears" className="grid gap-3 sm:grid-cols-2">
      {OPTIONS.map((o) => {
        const selected = style === o.value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={selected}
            onClick={() => setStyle(o.value)}
            onPointerEnter={() => setHover(o.value)}
            onPointerLeave={() => setHover(null)}
            className={`card-interactive group relative overflow-hidden rounded-2xl border bg-card text-left ${
              selected ? "border-brand ring-2 ring-brand/30" : "hover:border-brand/40"
            }`}
          >
            <span className="saathi-stage mx-auto block aspect-square w-full max-w-60">
              {hello && (
                <SaathiSign
                  sign={hello}
                  style={o.value}
                  playing={selected || hover === o.value}
                  loop
                  label=""
                  className="size-full"
                />
              )}
            </span>
            <span className="flex items-start gap-3 p-4">
              <span className="min-w-0 flex-1">
                <span className="block font-semibold">{o.title}</span>
                <span className="block text-sm text-muted-foreground">{o.text}</span>
              </span>
              <span
                className={`flex size-6 shrink-0 items-center justify-center rounded-full border transition-colors ${
                  selected ? "border-brand bg-brand text-brand-foreground" : "border-input"
                }`}
                aria-hidden
              >
                {selected && <Check className="size-3.5" />}
              </span>
            </span>
          </button>
        );
      })}
    </div>
  );
}
