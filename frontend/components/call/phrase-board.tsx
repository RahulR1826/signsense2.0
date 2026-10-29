"use client";

import {
  Bed,
  Check,
  Frown,
  GlassWater,
  Hand,
  HeartPulse,
  House,
  LifeBuoy,
  OctagonX,
  Phone,
  Pill,
  Smile,
  Snowflake,
  Stethoscope,
  Sun,
  Toilet,
  Utensils,
  X,
  type LucideIcon,
} from "lucide-react";

// Picture board (AAC-style): one tap sends a short message — no reading or signing needed.
// The other side sees it, hears it read aloud, and signers get the sign clip where one exists.
const PHRASES: { text: string; label: string; Icon: LucideIcon; tone?: "urgent" | "yes" | "no" }[] = [
  { text: "Yes", label: "Yes", Icon: Check, tone: "yes" },
  { text: "No", label: "No", Icon: X, tone: "no" },
  { text: "Help!", label: "Help", Icon: LifeBuoy, tone: "urgent" },
  { text: "I am in pain", label: "Pain", Icon: HeartPulse, tone: "urgent" },
  { text: "I need water", label: "Water", Icon: GlassWater },
  { text: "I am hungry", label: "Food", Icon: Utensils },
  { text: "I need the toilet", label: "Toilet", Icon: Toilet },
  { text: "I need medicine", label: "Medicine", Icon: Pill },
  { text: "I need a doctor", label: "Doctor", Icon: Stethoscope },
  { text: "I want to sleep", label: "Sleep", Icon: Bed },
  { text: "I feel hot", label: "Hot", Icon: Sun },
  { text: "I feel cold", label: "Cold", Icon: Snowflake },
  { text: "I am happy", label: "Happy", Icon: Smile },
  { text: "I am sad", label: "Sad", Icon: Frown },
  { text: "Let's go home", label: "Home", Icon: House },
  { text: "Please call me", label: "Call me", Icon: Phone },
  { text: "Stop", label: "Stop", Icon: OctagonX },
  { text: "Thank you", label: "Thank you", Icon: Hand },
];

const TONE = {
  urgent: "border-red-500/60 bg-red-950/60",
  yes: "border-green-500/60 bg-green-950/50",
  no: "border-red-400/40 bg-neutral-800",
} as const;

export function PhraseBoard({ onSend, disabled }: { onSend: (text: string) => void; disabled: boolean }) {
  return (
    <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 lg:grid-cols-3" role="group" aria-label="Quick phrases">
      {PHRASES.map(({ text, label, Icon, tone }) => (
        <button
          key={label}
          type="button"
          disabled={disabled}
          onClick={() => onSend(text)}
          className={`flex h-20 flex-col items-center justify-center gap-1 rounded-xl border-2 border-transparent bg-neutral-800 text-sm hover:border-white/60 disabled:opacity-40 ${tone ? TONE[tone] : ""}`}
          aria-label={text}
        >
          <Icon className="size-8" strokeWidth={1.6} aria-hidden />
          {label}
        </button>
      ))}
    </div>
  );
}
