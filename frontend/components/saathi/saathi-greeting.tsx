"use client";

import { useEffect, useState } from "react";

import { SaathiSign } from "@/components/saathi/saathi-sign";
import { useMediaQuery } from "@/hooks/use-media-query";
import { loadSignLibrary, type LibrarySign } from "@/lib/signs/library";

/**
 * Saathi waving the real ISL sign for "Hello" (the dictionary motion, not a stock image). Still when the viewer
 * prefers reduced motion. Decorative next to text that already says hello, so hidden from screen readers.
 */
export function SaathiGreeting({ className = "" }: { className?: string }) {
  const [hello, setHello] = useState<LibrarySign | null>(null);
  const reduced = useMediaQuery("(prefers-reduced-motion: reduce)");
  useEffect(() => {
    loadSignLibrary()
      .then((lib) => setHello(lib.byId.get("hello") ?? null))
      .catch(() => undefined);
  }, []);
  return (
    <span className={`saathi-stage block shrink-0 overflow-hidden rounded-2xl ${className}`} aria-hidden>
      {hello && <SaathiSign sign={hello} playing={!reduced} loop label="" className="size-full" />}
    </span>
  );
}
