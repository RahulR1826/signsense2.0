"use client";

import { AlertTriangle, Camera, Check, Hand, Info, Loader2, Lock, Plus, RotateCcw, Trash2, X } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { RecognitionBar } from "@/components/call/recognition-bar";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/components/ui/toaster";
import { useMe } from "@/hooks/use-me";
import { usePersonalSigns } from "@/hooks/use-personal-signs";
import { useSignRecognition, type SignResult } from "@/hooks/use-sign-recognition";
import { ApiError } from "@/lib/auth";
import { getCameraOnly, mediaErrorKind, stopMedia, MEDIA_ERROR_TEXT } from "@/lib/call/media";
import { EXTRACTOR_VERSION } from "@/lib/landmarks/schema";
import { compactFrames, createPersonalSign, deletePersonalSign } from "@/lib/personal-signs";
import { checkEnrolment } from "@/lib/signs/personal";

const MIN_TAKES = 3;
// A take shorter than this is probably a partial movement (most INCLUDE signs last 1-3 s), and one with
// very few frames (a busy device skips frames) describes the movement too coarsely to match reliably.
const MIN_TAKE_MS = 600;
const MIN_TAKE_FRAMES = 8;
const MAX_TAKES = 5;
// Pictures help people who don't read; all are plain Unicode emoji (no images to licence).
const EMOJIS = ["☕", "🍚", "💧", "💊", "🏥", "🏠", "🚌", "📞", "❤️", "😊", "😢", "😴", "👶", "👵", "🐕", "⚽"];

interface Take {
  id: number;
  result: SignResult;
}

function Recorder({ existingLabels, onSaved, onCancel }: { existingLabels: string[]; onSaved: () => void; onCancel: () => void }) {
  const { toast } = useToast();
  const personal = usePersonalSigns(true);
  const [label, setLabel] = useState("");
  const [emoji, setEmoji] = useState<string | null>(null);
  const [step, setStep] = useState<"name" | "record">("name");
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [takes, setTakes] = useState<Take[]>([]);
  const [saving, setSaving] = useState(false);
  const [tooShort, setTooShort] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);

  const onResult = useCallback((r: SignResult) => {
    const ms = r.segment.length > 1 ? r.segment[r.segment.length - 1].t - r.segment[0].t : 0;
    if (ms < MIN_TAKE_MS || r.segment.length < MIN_TAKE_FRAMES) {
      setTooShort(true);
      return;
    }
    setTooShort(false);
    setTakes((t) => (t.length >= MAX_TAKES ? t : [...t, { id: r.id, result: r }]));
  }, []);
  const recognition = useSignRecognition(stream, !!stream, takes.length < MAX_TAKES, onResult);

  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    v.srcObject = stream;
    if (stream) v.play().catch(() => undefined);
  }, [stream]);
  useEffect(() => () => stopMedia(stream), [stream]);

  const trimmed = label.trim();
  const nameTaken = existingLabels.some((l) => l.toLowerCase() === trimmed.toLowerCase());

  async function startCamera() {
    setCameraError(null);
    try {
      setStream(await getCameraOnly());
    } catch (err) {
      setCameraError(MEDIA_ERROR_TEXT[mediaErrorKind(err)]);
    }
  }

  // Checks once enough takes exist: consistency, a built-in sign that already works, a clash with another own sign.
  const check = useMemo(() => {
    const embeddings = takes.map((t) => t.result.embedding).filter((e): e is Float32Array => !!e);
    if (embeddings.length < MIN_TAKES || personal.threshold === null) return null;
    const builtIn = takes.filter((t) => t.result.decision === "accept").map((t) => t.result.ranked[0]?.text);
    const common = builtIn.length * 2 > takes.length ? builtIn[0] : null;
    return { ...checkEnrolment(embeddings, personal.refs, personal.threshold), builtIn: common };
  }, [takes, personal.refs, personal.threshold]);

  async function save() {
    setSaving(true);
    try {
      await createPersonalSign({
        label: trimmed,
        emoji,
        extractorVersion: EXTRACTOR_VERSION,
        samples: takes.map((t) => ({ aspect: t.result.aspect, frames: compactFrames(t.result.segment).slice(0, 90) })),
      });
      stopMedia(stream);
      setStream(null);
      toast({ title: `“${trimmed}” saved`, description: "It will be suggested when you sign it in a call." });
      onSaved();
    } catch (err) {
      setSaving(false);
      toast({ tone: "error", title: "Couldn't save the sign", description: err instanceof ApiError ? err.message : "Check your connection and try again." });
    }
  }

  return (
    <section className="space-y-6 rounded-3xl border bg-card p-5 shadow-[var(--shadow-soft)] sm:p-6" aria-labelledby="add-title">
      <div className="flex items-center justify-between gap-3">
        <h2 id="add-title" className="text-xl font-bold">
          Add a sign <span className="text-sm font-normal text-muted-foreground">· step {step === "name" ? 1 : 2} of 2</span>
        </h2>
        <Button variant="ghost" size="lg" onClick={() => (stopMedia(stream), onCancel())}>
          <X /> Cancel
        </Button>
      </div>

      {step === "name" ? (
        <div className="space-y-5">
          <div className="space-y-1.5">
            <Label htmlFor="sign-label">What does your sign mean?</Label>
            <Input
              id="sign-label"
              className="h-12 max-w-md text-base"
              value={label}
              maxLength={40}
              placeholder="e.g. Chai, Bus stop, Grandma"
              onChange={(e) => setLabel(e.target.value)}
              aria-invalid={nameTaken}
              aria-describedby={nameTaken ? "label-error" : undefined}
            />
            {nameTaken && (
              <p id="label-error" className="text-sm text-destructive">
                You already have a sign called “{trimmed}”.
              </p>
            )}
          </div>
          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">Picture (optional)</legend>
            <div className="flex flex-wrap gap-2">
              {EMOJIS.map((e) => (
                <button
                  key={e}
                  type="button"
                  onClick={() => setEmoji(emoji === e ? null : e)}
                  aria-pressed={emoji === e}
                  className={`flex size-12 items-center justify-center rounded-xl border-2 text-2xl transition-colors ${emoji === e ? "border-brand bg-brand-soft" : "border-border hover:border-brand/40"}`}
                >
                  {e}
                </button>
              ))}
            </div>
          </fieldset>
          <Button size="xl" disabled={!trimmed || nameTaken} onClick={() => (setStep("record"), startCamera())}>
            <Camera /> Next: record it
          </Button>
        </div>
      ) : (
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
          <div className="space-y-3">
            <div className="relative aspect-[4/3] overflow-hidden rounded-2xl bg-ink">
              <video ref={videoRef} muted playsInline className={`size-full -scale-x-100 object-contain ${stream ? "" : "hidden"}`} />
              {!stream && (
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 p-6 text-center text-ink-foreground">
                  {cameraError ? (
                    <>
                      <p role="alert" className="max-w-sm text-sm">{cameraError}</p>
                      <Button size="lg" onClick={startCamera} className="bg-white text-neutral-900 hover:bg-white/90">Try again</Button>
                    </>
                  ) : (
                    <Loader2 className="size-8 animate-spin" aria-label="Starting camera" />
                  )}
                </div>
              )}
            </div>
            {stream && takes.length < MAX_TAKES && (
              <RecognitionBar hasCamera camOn status={recognition.status} phase={recognition.phase} error={recognition.error} note={null} onRetry={recognition.retry} />
            )}
          </div>

          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Sign <strong className="text-foreground">{emoji} {trimmed}</strong> the way you normally do. Start with your hands down, sign once, then put your
              hands down. Repeat {MIN_TAKES}–{MAX_TAKES} times.
            </p>
            <ol className="grid grid-cols-5 gap-2" aria-label="Recorded takes">
              {Array.from({ length: MAX_TAKES }, (_, i) => {
                const t = takes[i];
                return (
                  <li
                    key={i}
                    className={`flex aspect-square flex-col items-center justify-center rounded-xl border-2 text-xs ${t ? "border-success bg-success-soft text-success" : i < MIN_TAKES ? "border-dashed" : "border-dashed opacity-60"}`}
                  >
                    {t ? <Check className="size-5" aria-label={`Take ${i + 1} recorded`} /> : <span>{i + 1}</span>}
                  </li>
                );
              })}
            </ol>
            {tooShort && (
              <p role="status" className="rounded-xl bg-warning-soft p-3 text-sm">
                That was very short — sign the whole word, then put your hands down.
              </p>
            )}
            {takes.length > 0 && (
              <Button variant="outline" size="lg" onClick={() => setTakes((t) => t.slice(0, -1))}>
                <RotateCcw /> Redo last take
              </Button>
            )}
            {check && (
              <div className="space-y-2 text-sm" role="status">
                {!check.consistent && (
                  <p className="flex gap-2 rounded-xl bg-warning-soft p-3">
                    <AlertTriangle className="size-4 shrink-0 text-warning" aria-hidden /> Your takes look quite different from each other. Redo the
                    odd one out so the sign is recognised reliably.
                  </p>
                )}
                {check.builtIn && (
                  <p className="flex gap-2 rounded-xl bg-brand-soft p-3">
                    <Hand className="size-4 shrink-0 text-brand" aria-hidden /> This looks like the built-in sign “{check.builtIn}”, which already
                    works without recording. You can still save it.
                  </p>
                )}
                {check.clashesWith && (
                  <p className="flex gap-2 rounded-xl bg-warning-soft p-3">
                    <AlertTriangle className="size-4 shrink-0 text-warning" aria-hidden /> This is very close to your sign “{check.clashesWith}”, so the
                    two may be confused.
                  </p>
                )}
                {check.consistent && !check.clashesWith && !check.builtIn && (
                  <p className="flex gap-2 rounded-xl bg-success-soft p-3 text-success">
                    <Check className="size-4 shrink-0" aria-hidden /> Takes are consistent.
                  </p>
                )}
              </div>
            )}
            <Button size="xl" className="w-full" disabled={takes.length < MIN_TAKES || saving} onClick={save}>
              {saving ? <Loader2 className="animate-spin" aria-hidden /> : <Check />} Save “{trimmed}” ({takes.length}/{MIN_TAKES}+ takes)
            </Button>
          </div>
        </div>
      )}
    </section>
  );
}

export default function MySignsPage() {
  const router = useRouter();
  const { toast } = useToast();
  const { user, setUser } = useMe();
  const { signs, status, reload } = usePersonalSigns(!!user);
  const [adding, setAdding] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  useEffect(() => {
    if (user === null) router.replace("/login");
  }, [user, router]);

  async function remove(id: string, label: string) {
    if (confirmDelete !== id) return setConfirmDelete(id);
    try {
      await deletePersonalSign(id);
      toast({ title: `“${label}” deleted` });
      setConfirmDelete(null);
      reload();
    } catch {
      toast({ tone: "error", title: "Couldn't delete the sign", description: "Try again." });
    }
  }

  return (
    <>
      <SiteHeader user={user} onSignedOut={() => setUser(null)} />
      <main id="main" className="mx-auto w-full max-w-6xl flex-1 space-y-8 px-4 py-10 sm:px-6">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div className="max-w-2xl space-y-2">
            <h1 className="text-3xl font-bold sm:text-4xl">My signs</h1>
            <p className="text-muted-foreground">
              Teach SignSense signs that matter to you — family names, your own words. In a call, when you make one, it is offered to you as a
              choice. It is never sent without your tap.
            </p>
          </div>
          {!adding && (
            <Button size="xl" onClick={() => setAdding(true)} disabled={!user || status === "unsupported"}>
              <Plus /> Add a sign
            </Button>
          )}
        </div>

        {adding && (
          <Recorder
            existingLabels={signs.map((s) => s.label)}
            onCancel={() => setAdding(false)}
            onSaved={() => {
              setAdding(false);
              reload();
            }}
          />
        )}

        {status === "loading" && <div className="h-28 animate-pulse rounded-3xl bg-muted" role="status" aria-label="Loading your signs" />}
        {status === "error" && (
          <p role="alert" className="rounded-2xl bg-destructive/10 p-4 text-sm text-destructive">
            Your signs couldn&apos;t be loaded. Check your connection and reload the page.
          </p>
        )}
        {status === "unsupported" && (
          <p role="alert" className="rounded-2xl bg-warning-soft p-4 text-sm">
            The current sign model doesn&apos;t support personal signs.
          </p>
        )}
        {status === "ready" && signs.length === 0 && !adding && (
          <div className="flex flex-col items-center gap-3 rounded-3xl border border-dashed p-10 text-center">
            <span className="flex size-14 items-center justify-center rounded-2xl bg-brand-soft text-brand">
              <Hand className="size-7" aria-hidden />
            </span>
            <p className="font-semibold">No signs yet</p>
            <p className="max-w-sm text-sm text-muted-foreground">Add a sign by recording it 3–5 times. It takes about a minute.</p>
          </div>
        )}
        {signs.length > 0 && (
          <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {signs.map((s) => (
              <li key={s.id} className="flex items-center gap-4 rounded-2xl border bg-card p-4 shadow-[var(--shadow-soft)]">
                <span className="flex size-14 shrink-0 items-center justify-center rounded-2xl bg-brand-soft text-3xl" aria-hidden>
                  {s.emoji ?? <Hand className="size-6 text-brand" />}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-lg font-semibold">{s.label}</span>
                  <span className="text-sm text-muted-foreground">{s.samples.length} takes</span>
                </span>
                <Button
                  variant={confirmDelete === s.id ? "destructive" : "ghost"}
                  size="lg"
                  onClick={() => remove(s.id, s.label)}
                  aria-label={confirmDelete === s.id ? `Confirm deleting ${s.label}` : `Delete ${s.label}`}
                >
                  <Trash2 /> {confirmDelete === s.id ? "Delete?" : ""}
                </Button>
              </li>
            ))}
          </ul>
        )}

        <section className="grid gap-4 text-sm text-muted-foreground md:grid-cols-2">
          <div className="flex gap-3 rounded-2xl border bg-card p-4">
            <Lock className="size-5 shrink-0 text-success" aria-hidden />
            <p>
              <strong className="text-foreground">Private to you.</strong> Only hand and body positions are saved — never video. Other people
              can&apos;t see or use your signs, and they are deleted with your account.
            </p>
          </div>
          <div className="flex gap-3 rounded-2xl border bg-card p-4">
            <Info className="size-5 shrink-0 text-brand" aria-hidden />
            <p>
              <strong className="text-foreground">How well it works:</strong> your own signs are matched best when you sign them yourself. Very
              similar signs can be mixed up, so they are always offered as a choice. Try them on the{" "}
              <Link href="/try" className="font-medium text-brand underline">Practice</Link> page.
            </p>
          </div>
        </section>
      </main>
      <SiteFooter />
    </>
  );
}
