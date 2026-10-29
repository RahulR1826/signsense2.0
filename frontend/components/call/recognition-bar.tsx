"use client";

import { AlertTriangle, Check, CloudOff, Hand, Loader2, PauseCircle, ScanFace, VideoOff } from "lucide-react";
import type { ReactNode } from "react";

import type { RecognitionPhase, RecognitionStatus } from "@/hooks/use-sign-recognition";

export interface SendNote {
  ok: boolean;
  text: string;
  at: number;
}

interface Props {
  hasCamera: boolean;
  camOn: boolean;
  status: RecognitionStatus;
  phase: RecognitionPhase;
  error: string | null;
  note: SendNote | null;
  onRetry: () => void;
}

const PHASE: Record<RecognitionPhase, { text: string; Icon: typeof Hand; tone: string }> = {
  "no-person": { text: "Step into view of the camera", Icon: ScanFace, tone: "text-neutral-300" },
  "no-hands": { text: "Hands not seen — raise them to sign", Icon: Hand, tone: "text-neutral-300" },
  "hands-down": { text: "Ready — raise your hands to sign", Icon: Hand, tone: "text-neutral-200" },
  signing: { text: "Watching your sign… put your hands down when done", Icon: Hand, tone: "text-emerald-300" },
  recognising: { text: "Recognising…", Icon: Loader2, tone: "text-blue-200" },
};

/** One-line status of sign recognition for the signer, in its own strip so it never covers video. */
export function RecognitionBar({ hasCamera, camOn, status, phase, error, note, onRetry }: Props) {
  let icon: ReactNode;
  let text: string;
  let tone = "text-neutral-300";
  let action: ReactNode = null;

  if (note) {
    icon = note.ok ? <Check className="size-4" /> : <CloudOff className="size-4" />;
    text = note.text;
    tone = note.ok ? "text-emerald-300" : "text-amber-300";
  } else if (!hasCamera) {
    icon = <VideoOff className="size-4" />;
    text = "No camera — sign recognition needs one";
  } else if (!camOn) {
    icon = <VideoOff className="size-4" />;
    text = "Camera is off — turn it on to sign";
  } else if (status === "loading") {
    icon = <Loader2 className="size-4 animate-spin" />;
    text = "Loading sign recognition…";
  } else if (status === "paused") {
    icon = <PauseCircle className="size-4" />;
    text = "Paused until the other person is connected";
  } else if (status === "error") {
    icon = <AlertTriangle className="size-4" />;
    text = error ?? "Sign recognition failed";
    tone = "text-red-300";
    action = (
      <button type="button" onClick={onRetry} className="ml-auto shrink-0 rounded-full bg-white px-3 py-1 text-xs font-semibold text-neutral-900">
        Retry
      </button>
    );
  } else if (status === "ready") {
    const p = PHASE[phase];
    icon = <p.Icon className={`size-4 ${phase === "recognising" ? "animate-spin" : ""}`} />;
    text = p.text;
    tone = p.tone;
  } else {
    return null;
  }

  return (
    <div
      role="status"
      aria-live="polite"
      data-recognition={status}
      data-phase={status === "ready" ? phase : undefined}
      className={`mx-auto flex h-9 w-full max-w-xl items-center gap-2 rounded-full bg-neutral-900 px-3 text-sm ring-1 ring-white/10 ${tone}`}
    >
      <span className="shrink-0" aria-hidden>
        {icon}
      </span>
      <span className="truncate">{text}</span>
      {action}
    </div>
  );
}
