"use client";

import { useCallback, useEffect, useState } from "react";

import { loadClassifier } from "@/hooks/use-sign-recognition";
import { EXTRACTOR_VERSION } from "@/lib/landmarks/schema";
import { listPersonalSigns, type PersonalSign } from "@/lib/personal-signs";
import { windowVariants } from "@/lib/signs/features";
import type { PersonalSignRef } from "@/lib/signs/personal";

export type PersonalStatus = "off" | "loading" | "ready" | "unsupported" | "error";

/**
 * The signed-in user's own signs, with an embedding per recorded take computed by the current model
 * (so they keep working when the model is updated). Takes recorded with another landmark extractor
 * version are skipped, because their features would not be comparable.
 */
export function usePersonalSigns(enabled: boolean) {
  const [signs, setSigns] = useState<PersonalSign[]>([]);
  const [refs, setRefs] = useState<PersonalSignRef[]>([]);
  const [threshold, setThreshold] = useState<number | null>(null);
  const [status, setStatus] = useState<PersonalStatus>("off");
  const [version, setVersion] = useState(0);

  useEffect(() => {
    if (!enabled) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- reflect being switched off
      setStatus("off");
      return;
    }
    let cancelled = false;
    setStatus("loading");
    (async () => {
      try {
        const [list, classifier] = await Promise.all([listPersonalSigns(), loadClassifier()]);
        const t = classifier.config.personal?.threshold;
        if (!t || !classifier.config.embeddingDim) {
          if (!cancelled) setStatus("unsupported");
          return;
        }
        const out: PersonalSignRef[] = [];
        for (const s of list) {
          const embeddings = [];
          for (const sample of s.samples) {
            if (sample.extractor_version !== EXTRACTOR_VERSION) continue;
            const d = await classifier.decide(windowVariants(sample.frames, sample.aspect));
            if (d.embedding) embeddings.push(d.embedding);
          }
          if (embeddings.length) out.push({ id: s.id, label: s.label, emoji: s.emoji, embeddings });
        }
        if (cancelled) return;
        setSigns(list);
        setRefs(out);
        setThreshold(t);
        setStatus("ready");
      } catch (err) {
        console.error(err);
        if (!cancelled) setStatus("error");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [enabled, version]);

  const reload = useCallback(() => setVersion((v) => v + 1), []);
  return { signs, refs, threshold, status, reload };
}
