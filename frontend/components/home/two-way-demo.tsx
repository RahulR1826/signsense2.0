"use client";

import { ArrowRight, Check, CircleHelp, Hand, Keyboard, Play, Send, X } from "lucide-react";
import Link from "next/link";
import { useEffect, useState, type FormEvent } from "react";

import { SignPlayer } from "@/components/signs/sign-player";
import { buttonVariants } from "@/components/ui/button";
import { textToGloss, type GlossToken } from "@/lib/signs/gloss";
import { loadSignLibrary, type SignLibrary } from "@/lib/signs/library";

const EXAMPLES = ["Hello, how are you?", "Mother needs medicine", "Thank you doctor", "Good night friend"];

/** REAL feature: the same text -> sign mapping the call uses, signed by Saathi from the dictionary motions. */
function TextToSign() {
  const [library, setLibrary] = useState<SignLibrary | null>(null);
  const [failed, setFailed] = useState(false);
  const [text, setText] = useState("");
  const [tokens, setTokens] = useState<GlossToken[] | null>(null);

  useEffect(() => {
    loadSignLibrary().then(setLibrary, () => setFailed(true));
  }, []);

  function show(value: string) {
    if (!library || !value.trim()) return;
    setText(value);
    setTokens(textToGloss(value, library.ids));
  }

  const missing = tokens?.filter((t) => t.kind === "text").map((t) => t.word) ?? [];

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-6 md:grid-cols-[minmax(0,1fr)_240px] md:items-start lg:grid-cols-[minmax(0,1fr)_300px]">
      <div className="space-y-4">
        <form
          onSubmit={(e: FormEvent) => {
            e.preventDefault();
            show(text);
          }}
          className="flex flex-col gap-2 sm:flex-row"
        >
          <label htmlFor="demo-text" className="sr-only">
            Type words to see them signed
          </label>
          <input
            id="demo-text"
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Type a few words…"
            maxLength={120}
            className="h-12 min-w-0 flex-1 rounded-xl border border-white/15 bg-white/10 px-4 text-base text-white placeholder:text-ink-muted focus-visible:border-white/40"
          />
          <button type="submit" disabled={!library || !text.trim()} className={buttonVariants({ size: "xl", className: "bg-white text-neutral-900 hover:bg-white/90" })}>
            <Play /> Show signs
          </button>
        </form>
        <div className="flex flex-wrap gap-2" aria-label="Examples">
          {EXAMPLES.map((ex) => (
            <button
              key={ex}
              type="button"
              onClick={() => show(ex)}
              disabled={!library}
              className="rounded-full border border-white/15 px-3 py-1.5 text-sm text-ink-foreground/90 transition-colors hover:border-white/40 hover:bg-white/10 disabled:opacity-50"
            >
              {ex}
            </button>
          ))}
        </div>
        {failed && <p className="text-sm text-amber-200">The signs couldn&apos;t be loaded. Check your connection and reload.</p>}
        {tokens && missing.length > 0 && (
          <p className="text-sm text-ink-muted">
            No sign yet for: <span className="text-ink-foreground">{missing.join(", ")}</span>. These are shown as text — never
            fingerspelled or guessed.
          </p>
        )}
        <p className="text-sm text-ink-muted">
          Signs play one by one in your word order. This is a dictionary of single signs, not full ISL sentence grammar.
        </p>
      </div>
      <div className="min-h-48">
        {tokens && library && tokens.length > 0 ? (
          <SignPlayer library={library} tokens={tokens} className="ring-1 ring-white/10" />
        ) : (
          <div className="flex aspect-square flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-white/15 text-center text-sm text-ink-muted">
            <Play className="size-8" aria-hidden />
            Pick an example or type words
          </div>
        )}
      </div>
    </div>
  );
}

const OUTCOMES = {
  sure: {
    label: "Model is sure",
    Icon: Check,
    title: "Hello",
    body: "Sent automatically after a 2-second countdown. You can cancel it.",
    rule: "Only when the model is ≥ 95% sure and agrees across the whole sign.",
  },
  unsure: {
    label: "Model is unsure",
    Icon: CircleHelp,
    title: "Which sign did you mean?",
    body: "You tap the right sign from three choices. Nothing is sent until you do.",
    rule: "The other person sees it marked “chosen by the signer”.",
  },
  unknown: {
    label: "Not a supported sign",
    Icon: X,
    title: "No supported sign detected",
    body: "Nothing is sent. Signs it doesn't know are rejected rather than guessed.",
    rule: "It still makes mistakes sometimes — see the limits below.",
  },
} as const;
type Outcome = keyof typeof OUTCOMES;

/** ILLUSTRATION of the real decision rules (labelled); the real recogniser is on /try and in calls. */
function SignToText() {
  const [outcome, setOutcome] = useState<Outcome>("sure");
  const o = OUTCOMES[outcome];
  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-6 md:grid-cols-[minmax(0,1fr)_240px] md:items-start lg:grid-cols-[minmax(0,1fr)_300px]">
      <div className="space-y-4">
        <ol className="space-y-3">
          {[
            ["Your camera sees your hands and body", "Tracked on your device — video is never uploaded."],
            ["You sign one word, then lower your hands", "The whole sign is collected before deciding."],
            ["The model decides what to do", "Pick an outcome to see what happens:"],
          ].map(([t, d], i) => (
            <li key={t} className="flex gap-3">
              <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-white/10 text-sm font-semibold">{i + 1}</span>
              <span>
                <span className="block font-medium">{t}</span>
                <span className="text-sm text-ink-muted">{d}</span>
              </span>
            </li>
          ))}
        </ol>
        <div className="flex flex-wrap gap-2 pl-10" role="radiogroup" aria-label="What the model decides">
          {(Object.keys(OUTCOMES) as Outcome[]).map((k) => {
            const { label, Icon } = OUTCOMES[k];
            return (
              <button
                key={k}
                type="button"
                role="radio"
                aria-checked={outcome === k}
                onClick={() => setOutcome(k)}
                className={`flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm transition-colors ${
                  outcome === k ? "border-white bg-white text-neutral-900" : "border-white/15 hover:border-white/40 hover:bg-white/10"
                }`}
              >
                <Icon className="size-4" aria-hidden /> {label}
              </button>
            );
          })}
        </div>
        <Link href="/try" className={buttonVariants({ variant: "outline", size: "lg", className: "ml-10 border-white/20 bg-transparent text-white hover:bg-white/10 hover:text-white" })}>
          Try the real recogniser with your camera <ArrowRight />
        </Link>
      </div>
      <div aria-live="polite" className="space-y-2">
        <div key={outcome} className="rounded-2xl bg-white p-4 text-neutral-900 shadow-xl [animation:toast-in_0.35s_var(--ease-out-soft)_both]">
          <div className="flex items-start gap-3">
            {outcome === "unknown" ? <CircleHelp className="mt-0.5 size-6 text-neutral-400" /> : <Hand className="mt-0.5 size-6 text-brand" />}
            <div>
              {outcome === "sure" && <p className="text-xs text-neutral-500">Sending your sign…</p>}
              <p className={outcome === "sure" ? "text-2xl font-semibold" : "font-semibold"}>{o.title}</p>
            </div>
          </div>
          {outcome === "sure" && (
            <div className="mt-3 flex gap-2">
              <span className="flex h-9 flex-1 items-center justify-center gap-1.5 rounded-lg bg-neutral-900 text-sm text-white">
                <Send className="size-3.5" /> Send now
              </span>
              <span className="flex h-9 flex-1 items-center justify-center rounded-lg border text-sm">Cancel</span>
            </div>
          )}
          {outcome === "unsure" && (
            <div className="mt-3 grid grid-cols-3 gap-1.5 text-sm font-semibold">
              {["Hello", "Hospital", "Bed"].map((w) => (
                <span key={w} className="rounded-lg border-2 py-2 text-center">
                  {w}
                </span>
              ))}
            </div>
          )}
        </div>
        <p className="px-1 text-sm">{o.body}</p>
        <p className="px-1 text-xs text-ink-muted">{o.rule}</p>
        <p className="px-1 text-[11px] text-ink-muted">Illustration of the real decision rules.</p>
      </div>
    </div>
  );
}

const TABS = [
  { id: "sign", label: "Sign → words", Icon: Hand },
  { id: "text", label: "Words → signs", Icon: Keyboard },
] as const;

export function TwoWayDemo() {
  const [tab, setTab] = useState<(typeof TABS)[number]["id"]>("text");
  return (
    <div className="space-y-8">
      <div className="inline-flex rounded-2xl bg-white/10 p-1" role="tablist" aria-label="Direction">
        {TABS.map(({ id, label, Icon }) => (
          <button
            key={id}
            id={`tab-${id}`}
            type="button"
            role="tab"
            aria-selected={tab === id}
            aria-controls={`panel-${id}`}
            onClick={() => setTab(id)}
            className={`flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-medium transition-all duration-300 ${
              tab === id ? "bg-white text-neutral-900 shadow" : "text-ink-foreground/80 hover:text-white"
            }`}
          >
            <Icon className="size-4" aria-hidden /> {label}
          </button>
        ))}
      </div>
      <div id={`panel-${tab}`} role="tabpanel" aria-labelledby={`tab-${tab}`} key={tab} className="[animation:page-enter_0.4s_var(--ease-out-soft)_backwards]">
        {tab === "text" ? <TextToSign /> : <SignToText />}
      </div>
    </div>
  );
}
