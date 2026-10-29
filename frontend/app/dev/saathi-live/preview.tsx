"use client";

import { useEffect, useState } from "react";

import { SaathiStage } from "@/components/call/saathi-stage";
import { textToGloss, type GlossToken } from "@/lib/signs/gloss";
import { loadSignLibrary, type SignLibrary } from "@/lib/signs/library";

export function SaathiLivePreview() {
  const [library, setLibrary] = useState<SignLibrary | null>(null);
  const [tokens, setTokens] = useState<GlossToken[] | null>(null);
  useEffect(() => {
    loadSignLibrary().then((lib) => {
      setLibrary(lib);
      const text = new URLSearchParams(window.location.search).get("text") ?? "hello";
      setTokens(textToGloss(text, lib.ids));
    });
  }, []);
  if (!library || !tokens) return null;
  return (
    <main className="flex min-h-dvh items-center justify-center bg-neutral-950 p-4">
      <SaathiStage library={library} tokens={tokens} heading="Preview" onClose={() => undefined} className="h-[560px] w-[420px]" />
    </main>
  );
}
