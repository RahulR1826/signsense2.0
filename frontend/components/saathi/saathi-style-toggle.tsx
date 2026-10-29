"use client";

import { useSaathiStyle, type SaathiStyle } from "@/lib/saathi-style";

/** Switch every Saathi on the page between the 3D video and the 2D drawing. */
export function SaathiStyleToggle({ dark = false, className = "" }: { dark?: boolean; className?: string }) {
  const [style, setStyle] = useSaathiStyle();
  const options: [SaathiStyle, string][] = [
    ["3d", "3D"],
    ["2d", "2D"],
  ];
  return (
    <div role="group" aria-label="Saathi style" className={`inline-flex rounded-full p-0.5 text-xs font-semibold ${dark ? "bg-white/10" : "bg-muted"} ${className}`}>
      {options.map(([value, text]) => (
        <button
          key={value}
          type="button"
          aria-pressed={style === value}
          aria-label={`Show Saathi in ${text}`}
          onClick={() => setStyle(value)}
          className={`rounded-full px-2.5 py-1 transition-colors ${
            style === value ? (dark ? "bg-white text-neutral-900" : "bg-background text-foreground shadow-sm") : dark ? "text-white/70 hover:text-white" : "text-muted-foreground hover:text-foreground"
          }`}
        >
          {text}
        </button>
      ))}
    </div>
  );
}
