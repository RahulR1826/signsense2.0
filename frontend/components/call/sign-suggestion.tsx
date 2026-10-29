"use client";

import { Hand, HelpCircle, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import type { SignResult } from "@/hooks/use-sign-recognition";
import type { SignVia } from "@/lib/call/messages";

export const AUTO_SEND_MS = 2000;
const REJECT_VISIBLE_MS = 3500;

export interface SignChoice {
  label: string;
  text: string;
  prob: number;
}

interface Props {
  result: SignResult;
  onSend: (choice: SignChoice, via: SignVia) => void;
  onDismiss: () => void;
}

/**
 * Shown to the signer only, in its own strip below the video (never over either person's video).
 * What happens depends on the model's decision policy (lib/signs/decision.ts):
 *   accept  -> sent after a short countdown (cancel to stop)
 *   suggest -> the signer must pick the right sign; nothing is sent automatically
 *   reject  -> "No supported sign detected"; nothing is sent (the signer may still pick manually)
 * Each card sends at most once, whichever of countdown / button / Enter happens first.
 */
export function SignSuggestion({ result, onSend, onDismiss }: Props) {
  const best = result.ranked[0];
  const [elapsed, setElapsed] = useState(0);
  const [showChoices, setShowChoices] = useState(result.decision === "suggest");
  const done = useRef(false);

  const sendOnce = useCallback(
    (choice: SignChoice | undefined, via: SignVia) => {
      if (!choice || done.current) return;
      done.current = true;
      onSend(choice, via);
    },
    [onSend],
  );
  const dismissOnce = useCallback(() => {
    if (done.current) return;
    done.current = true;
    onDismiss();
  }, [onDismiss]);

  useEffect(() => {
    if (result.decision !== "accept" || !best) return;
    const start = performance.now();
    const timer = setInterval(() => {
      const ms = performance.now() - start;
      setElapsed(ms);
      if (ms >= AUTO_SEND_MS) {
        clearInterval(timer);
        sendOnce(best, "auto");
      }
    }, 50);
    return () => clearInterval(timer);
  }, [result.decision, best, sendOnce]);

  useEffect(() => {
    if (result.decision !== "reject" || showChoices) return;
    const timer = setTimeout(dismissOnce, REJECT_VISIBLE_MS);
    return () => clearTimeout(timer);
  }, [result.decision, showChoices, dismissOnce]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      if (e.key === "Escape") dismissOnce();
      else if (e.key === "Enter" && result.decision === "accept") sendOnce(best, "auto");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [result.decision, best, sendOnce, dismissOnce]);

  // A personal ("My signs") match is offered first, then the best built-in guesses.
  const choices: SignChoice[] = result.personal
    ? [{ label: "personal", text: result.personal.label, prob: result.personal.score }, ...result.ranked.slice(0, 2)]
    : result.ranked.slice(0, 3);

  return (
    <div
      role="dialog"
      aria-label="Recognised sign"
      data-decision={result.decision}
      className="mx-auto w-full max-w-xl space-y-3 rounded-2xl border border-black/5 bg-white p-3 text-neutral-900 shadow-xl sm:p-4"
    >
      <div className="flex items-start gap-3">
        {result.decision === "reject" ? (
          <HelpCircle className="mt-0.5 size-6 shrink-0 text-neutral-400" aria-hidden />
        ) : (
          <Hand className="mt-0.5 size-6 shrink-0 text-brand" aria-hidden />
        )}
        <div className="min-w-0 flex-1">
          {result.decision === "accept" && best && (
            <>
              <p className="text-sm text-neutral-500">Sending your sign…</p>
              <p className="truncate text-2xl font-semibold tracking-tight sm:text-3xl">{best.text}</p>
            </>
          )}
          {result.decision === "suggest" && !result.personal && <p className="font-medium text-amber-800">Not sure — which sign did you mean?</p>}
          {result.personal && (
            <>
              <p className="text-sm text-neutral-500">Is this your sign?</p>
              <p className="truncate text-2xl font-semibold tracking-tight">
                {result.personal.emoji && <span aria-hidden>{result.personal.emoji} </span>}
                {result.personal.label}
              </p>
            </>
          )}
          {result.decision === "reject" && (
            <>
              <p className="font-semibold">No supported sign detected</p>
              <p className="text-sm text-neutral-500">Nothing was sent. Try again, a little slower.</p>
            </>
          )}
        </div>
        <button type="button" onClick={dismissOnce} className="rounded-full p-1.5 hover:bg-neutral-100" aria-label="Dismiss, don't send">
          <X className="size-5" />
        </button>
      </div>

      {result.decision === "accept" && (
        <>
          <div className="h-1.5 overflow-hidden rounded-full bg-neutral-200" aria-hidden>
            <div className="h-full bg-brand" style={{ width: `${Math.min(100, (elapsed / AUTO_SEND_MS) * 100)}%` }} />
          </div>
          <div className="flex gap-2">
            <button type="button" onClick={() => sendOnce(best, "auto")} className="h-11 flex-1 rounded-xl bg-neutral-900 font-medium text-white">
              Send now
            </button>
            <button type="button" onClick={dismissOnce} className="h-11 flex-1 rounded-xl border font-medium">
              Cancel
            </button>
          </div>
        </>
      )}

      {showChoices && choices.length > 0 && (
        <div className="grid grid-cols-3 gap-2">
          {choices.map((p) => (
            <button
              key={p.label}
              type="button"
              onClick={() => sendOnce(p, "chosen")}
              className="flex h-14 flex-col items-center justify-center rounded-xl border-2 px-2 hover:border-neutral-900 focus-visible:border-neutral-900"
            >
              <span className="w-full truncate text-center text-base font-semibold">{p.text}</span>
              {p.label === "personal" && <span className="text-[11px] text-brand">My sign</span>}
            </button>
          ))}
        </div>
      )}
      {result.decision === "reject" && !showChoices && choices.length > 0 && (
        <button type="button" onClick={() => setShowChoices(true)} className="text-sm font-medium text-neutral-600 underline underline-offset-4">
          Pick a sign myself
        </button>
      )}
    </div>
  );
}
