"use client";

import { Check, Hand, Link2, Mic, MicOff, MessageSquareText, Video, VideoOff } from "lucide-react";
import { useEffect, useState } from "react";

import { Logo } from "@/components/brand";
import { VideoTile } from "@/components/call/video-tile";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { CommunicationMode, User } from "@/lib/auth";
import { MEDIA_ERROR_TEXT, getFakeMedia, getLocalMedia, getVideoFileMedia, mediaErrorKind, stopMedia } from "@/lib/call/media";

export type FakeMedia = { kind: "pattern" } | { kind: "video"; url: string } | null;

const GUEST_NAME_KEY = "signsense.guestName";

export interface JoinSettings {
  name: string;
  mode: CommunicationMode;
  stream: MediaStream | null;
  camOn: boolean;
  micOn: boolean;
}

interface Props {
  code: string;
  hostName: string;
  isHost: boolean;
  user: User | null;
  /** Dev-only camera substitutes; null = real camera. */
  fakeMedia: FakeMedia;
  onJoin: (settings: JoinSettings) => void;
}

export function PreJoin({ code, hostName, isHost, user, fakeMedia, onJoin }: Props) {
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [mediaError, setMediaError] = useState<string | null>(null);
  const [camOn, setCamOn] = useState(true);
  const [micOn, setMicOn] = useState(true);
  const [guestName, setGuestName] = useState("");
  const [mode, setMode] = useState<CommunicationMode>(user?.preferences?.mode ?? "signer");

  useEffect(() => {
    let cancelled = false;
    let acquired: MediaStream | null = null;
    (fakeMedia?.kind === "video"
      ? getVideoFileMedia(fakeMedia.url)
      : fakeMedia?.kind === "pattern"
        ? Promise.resolve(getFakeMedia(user?.name ?? "guest"))
        : getLocalMedia()
    )
      .then((s) => {
        acquired = s;
        if (cancelled) stopMedia(s);
        else setStream(s);
      })
      .catch((err) => {
        if (!cancelled) setMediaError(MEDIA_ERROR_TEXT[mediaErrorKind(err)]);
      });
    try {
      const saved = localStorage.getItem(GUEST_NAME_KEY);
      // eslint-disable-next-line react-hooks/set-state-in-effect -- restore after hydration
      if (saved) setGuestName(saved);
    } catch {}
    return () => {
      cancelled = true;
      // The stream is handed to the call on join; only stop it if we never joined.
      if (acquired && !joinedWith.has(acquired)) stopMedia(acquired);
    };
  }, [fakeMedia, user?.name]);

  useEffect(() => {
    stream?.getVideoTracks().forEach((t) => (t.enabled = camOn));
    stream?.getAudioTracks().forEach((t) => (t.enabled = micOn));
  }, [stream, camOn, micOn]);

  const name = user?.name ?? guestName.trim();
  // Joining before the camera is ready would silently send no video; wait for it (or for a definite failure).
  const mediaLoading = !stream && !mediaError;

  function join() {
    if (!user) {
      try {
        localStorage.setItem(GUEST_NAME_KEY, guestName.trim());
      } catch {}
    }
    if (stream) joinedWith.add(stream);
    onJoin({ name, mode, stream, camOn, micOn });
  }

  return (
    <>
    <div className="mx-auto flex h-16 w-full max-w-5xl items-center px-4">
      <Logo />
    </div>
    <main className="mx-auto grid w-full max-w-5xl flex-1 items-start gap-6 px-4 pb-10 md:grid-cols-[1fr_360px] md:gap-8 md:pt-6">
      <VideoTile
        stream={camOn ? stream : null}
        muted
        mirrored
        className="aspect-[4/3] w-full rounded-3xl shadow-lg"
        placeholder={mediaError ?? (camOn ? "Starting camera…" : "Camera is off")}
      />

      <section className="space-y-6 rounded-3xl border bg-card p-5 shadow-sm sm:p-6">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">Ready to join?</h1>
          <p className="text-muted-foreground">
            <span className="font-mono font-medium text-foreground">{code}</span> · hosted by {hostName}
          </p>
          {isHost && <InviteLink code={code} />}
        </div>

        <div className="flex gap-3">
          <Button
            variant={micOn ? "outline" : "destructive"}
            className="h-16 flex-1 flex-col gap-1 rounded-2xl text-sm"
            onClick={() => setMicOn((v) => !v)}
            disabled={!stream}
            aria-pressed={!micOn}
          >
            {micOn ? <Mic className="size-5" /> : <MicOff className="size-5" />}
            {micOn ? "Mic on" : "Mic off"}
          </Button>
          <Button
            variant={camOn ? "outline" : "destructive"}
            className="h-16 flex-1 flex-col gap-1 rounded-2xl text-sm"
            onClick={() => setCamOn((v) => !v)}
            disabled={!stream}
            aria-pressed={!camOn}
          >
            {camOn ? <Video className="size-5" /> : <VideoOff className="size-5" />}
            {camOn ? "Camera on" : "Camera off"}
          </Button>
        </div>

        {!user && (
          <div className="space-y-1.5 text-sm">
            <Label htmlFor="guest-name">Your name</Label>
            <Input
              id="guest-name"
              className="h-12 text-base"
              autoComplete="name"
              value={guestName}
              onChange={(e) => setGuestName(e.target.value)}
              maxLength={80}
            />
          </div>
        )}

        <div className="space-y-2">
          <span className="text-sm font-medium">In this call I will</span>
          <div className="grid grid-cols-2 gap-2" role="radiogroup">
            {(
              [
                { m: "signer", text: "Sign", Icon: Hand },
                { m: "non_signer", text: "Speak / type", Icon: MessageSquareText },
              ] as const
            ).map(({ m, text, Icon }) => (
              <button
                key={m}
                type="button"
                role="radio"
                aria-checked={mode === m || (m === "signer" && mode === "both")}
                onClick={() => setMode(m)}
                className={`flex flex-col items-center gap-1.5 rounded-2xl border-2 p-4 text-sm font-medium transition-colors ${
                  mode === m || (m === "signer" && mode === "both") ? "border-brand bg-brand-soft/60 text-foreground" : "border-border hover:border-brand/40"
                }`}
              >
                <Icon className="size-7" strokeWidth={1.5} aria-hidden />
                {text}
              </button>
            ))}
          </div>
        </div>

        <Button size="xl" className="w-full" onClick={join} disabled={!name || mediaLoading}>
          <Video /> {mediaLoading ? "Starting camera…" : "Join call"}
        </Button>
        {mediaError && <p className="text-sm text-muted-foreground">You can join without camera and microphone.</p>}
      </section>
    </main>
    </>
  );
}

function InviteLink({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={() =>
        navigator.clipboard
          .writeText(`${window.location.origin}/m/${code}`)
          .then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
          })
          .catch(() => undefined)
      }
      className="mt-2 inline-flex items-center gap-1.5 text-sm font-medium text-brand hover:underline"
    >
      {copied ? <Check className="size-4" /> : <Link2 className="size-4" />} {copied ? "Invite link copied" : "Copy invite link"}
    </button>
  );
}

// Streams passed into a call must survive the pre-join screen unmounting.
const joinedWith = new WeakSet<MediaStream>();
