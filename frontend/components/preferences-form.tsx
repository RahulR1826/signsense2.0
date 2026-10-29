"use client";

import { Check, Ear, Hand, Users } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { savePreferences, type CommunicationMode, type Preferences } from "@/lib/auth";

const MODES: { mode: CommunicationMode; title: string; hint: string; Icon: typeof Hand }[] = [
  { mode: "signer", title: "I use sign language", hint: "My signs become text and speech", Icon: Hand },
  { mode: "non_signer", title: "I don't use sign language", hint: "I speak or type", Icon: Ear },
  { mode: "both", title: "Both", hint: "I sign and I speak", Icon: Users },
];

interface Props {
  initial: Preferences | null;
  submitLabel: string;
  onSaved: (prefs: Preferences) => void;
}

/** Communication mode + ISL feature toggles (onboarding and settings). Big picture-first choices. */
export function PreferencesForm({ initial, submitLabel, onSaved }: Props) {
  const [mode, setMode] = useState<CommunicationMode | null>(initial?.mode ?? null);
  const [signToText, setSignToText] = useState(initial?.sign_to_text ?? true);
  const [textToSign, setTextToSign] = useState(initial?.text_to_sign ?? true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    if (!mode) return;
    setBusy(true);
    setError(null);
    try {
      const saved = await savePreferences({
        mode,
        sign_to_text: mode === "non_signer" ? false : signToText,
        text_to_sign: textToSign,
      });
      onSaved(saved);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save");
    } finally {
      setBusy(false);
    }
  }

  const signs = mode === "signer" || mode === "both";

  return (
    <div className="space-y-6">
      <div className="grid gap-3 sm:grid-cols-3" role="radiogroup" aria-label="Communication mode">
        {MODES.map(({ mode: m, title, hint, Icon }) => {
          const on = mode === m;
          return (
            <button
              key={m}
              type="button"
              role="radio"
              aria-checked={on}
              onClick={() => setMode(m)}
              className={`relative flex items-center gap-4 rounded-2xl border-2 bg-card p-4 text-left transition-colors sm:flex-col sm:p-6 sm:text-center ${
                on ? "border-brand bg-brand-soft/60" : "border-border hover:border-brand/40"
              }`}
            >
              {on && (
                <span className="absolute top-3 right-3 flex size-6 items-center justify-center rounded-full bg-brand text-brand-foreground">
                  <Check className="size-4" aria-hidden />
                </span>
              )}
              <span className={`flex size-14 shrink-0 items-center justify-center rounded-2xl sm:size-20 ${on ? "bg-brand text-brand-foreground" : "bg-muted"}`}>
                <Icon className="size-7 sm:size-10" strokeWidth={1.6} aria-hidden />
              </span>
              <span>
                <span className="block text-lg font-semibold">{title}</span>
                <span className="text-sm text-muted-foreground">{hint}</span>
              </span>
            </button>
          );
        })}
      </div>

      {signs && (
        <section className="space-y-4 rounded-2xl border bg-card p-5">
          <p className="font-medium">
            Sign language: <span className="rounded-md bg-muted px-2 py-0.5">Indian Sign Language (ISL)</span>
          </p>
          <label className="flex items-center gap-3 text-base">
            <input type="checkbox" className="size-5 accent-[var(--brand)]" checked={signToText} onChange={(e) => setSignToText(e.target.checked)} />
            Turn my signs into text and speech for others
          </label>
          <label className="flex items-center gap-3 text-base">
            <input type="checkbox" className="size-5 accent-[var(--brand)]" checked={textToSign} onChange={(e) => setTextToSign(e.target.checked)} />
            Show me signs for what others say or type
          </label>
        </section>
      )}

      {error && (
        <p role="alert" className="rounded-lg bg-destructive/10 p-3 text-sm text-destructive">
          {error}
        </p>
      )}

      <Button size="xl" className="w-full sm:w-auto sm:px-10" disabled={!mode || busy} onClick={save}>
        {busy ? "Saving…" : submitLabel}
      </Button>
    </div>
  );
}
