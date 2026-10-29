"use client";

import { useEffect, useRef, useState } from "react";

import { newId } from "@/lib/call/messages";
import { createRecognition, type SpeechLang } from "@/lib/speech";

export type CaptionCallback = (caption: { id: string; text: string; final: boolean }) => void;

/**
 * Live captions of the local microphone while `enabled`. Chrome ends recognition after silence or
 * network hiccups, so it is restarted automatically until disabled.
 */
export function useSpeechCaptions(enabled: boolean, lang: SpeechLang, onCaption: CaptionCallback) {
  const [error, setError] = useState<string | null>(null);
  const [listening, setListening] = useState(false);
  const callback = useRef(onCaption);

  useEffect(() => {
    callback.current = onCaption;
  });

  useEffect(() => {
    if (!enabled) return;
    const rec = createRecognition();
    if (!rec) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- report unsupported browser once
      setError("Live captions need Chrome or Edge.");
      return;
    }
    let active = true;
    let utterance = newId();
    rec.lang = lang;
    rec.continuous = true;
    rec.interimResults = true;
    rec.onresult = (e) => {
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        const text = r[0].transcript.trim();
        if (!text) continue;
        callback.current({ id: utterance, text, final: r.isFinal });
        if (r.isFinal) utterance = newId();
      }
    };
    rec.onerror = (e) => {
      if (e.error === "not-allowed" || e.error === "service-not-allowed") {
        active = false;
        setError("Microphone access for captions was blocked.");
      } else if (e.error === "network") {
        setError("Captions need an internet connection.");
      }
    };
    rec.onend = () => {
      setListening(false);
      if (active) {
        try {
          rec.start();
          setListening(true);
        } catch {}
      }
    };
    try {
      rec.start();
      setListening(true);
      setError(null);
    } catch {
      setError("Could not start captions.");
    }
    return () => {
      active = false;
      rec.onend = null;
      rec.abort();
      setListening(false);
    };
  }, [enabled, lang]);

  return { listening, error };
}
