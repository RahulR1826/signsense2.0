"use client";

import {
  Captions,
  CaptionsOff,
  Check,
  Hand,
  LayoutGrid,
  Link2,
  Loader2,
  RefreshCw,
  UserRoundSearch,
  Wifi,
  WifiOff,
  MessageSquare,
  Mic,
  MicOff,
  PhoneOff,
  Share2,
  Video,
  VideoOff,
  Volume2,
  VolumeX,
  X,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";

import { CaptionOverlay } from "@/components/call/caption-overlay";
import { ConversationPanel } from "@/components/call/conversation-panel";
import { PhraseBoard } from "@/components/call/phrase-board";
import { RecognitionBar, type SendNote } from "@/components/call/recognition-bar";
import type { JoinSettings } from "@/components/call/pre-join";
import { SignSuggestion, type SignChoice } from "@/components/call/sign-suggestion";
import { VideoTile } from "@/components/call/video-tile";
import { SaathiStage } from "@/components/call/saathi-stage";
import { useCall } from "@/hooks/use-call";
import { useConversation } from "@/hooks/use-conversation";
import { useMediaQuery } from "@/hooks/use-media-query";
import { useSignRecognition, type SignResult } from "@/hooks/use-sign-recognition";
import { usePersonalSigns } from "@/hooks/use-personal-signs";
import { useSpeechCaptions } from "@/hooks/use-speech-captions";
import { useToast } from "@/components/ui/toaster";
import { stopMedia } from "@/lib/call/media";
import type { SignVia } from "@/lib/call/messages";
import { endMeeting } from "@/lib/meetings";
import { textToGloss, type GlossToken } from "@/lib/signs/gloss";
import { tokensForReceivedSign } from "@/lib/signs/saathi-rig";
import { matchPersonal } from "@/lib/signs/personal";
import { loadSignLibrary, type SignLibrary } from "@/lib/signs/library";
import { SPEECH_LANGUAGES, speechRecognitionSupported, stopSpeaking, type SpeechLang } from "@/lib/speech";

interface Props {
  code: string;
  isHost: boolean;
  /** Signed-in users' own signs ("My signs") are recognised too. */
  signedIn?: boolean;
  settings: JoinSettings;
  onLeft: () => void;
}

type Panel = "chat" | "pictures";

const LANG_KEY = "signsense.speechLang";

function useCopied() {
  const [copied, setCopied] = useState(false);
  const { toast } = useToast();
  const copy = useCallback(
    async (text: string) => {
      try {
        await navigator.clipboard.writeText(text);
        setCopied(true);
        toast({ title: "Invite link copied", description: "Send it to the person you want to talk to." });
        setTimeout(() => setCopied(false), 2000);
      } catch {
        toast({ tone: "error", title: "Couldn't copy the link", description: "Share the meeting code shown at the top instead." });
      }
    },
    [toast],
  );
  return [copied, copy] as const;
}

/** Call state as icon + words (never colour alone). Short words on phones. */
const CONNECTION: Record<string, { Icon: typeof Wifi; long: string; short: string; cls: string; spin?: boolean }> = {
  connected: { Icon: Wifi, long: "Connected", short: "Live", cls: "bg-emerald-500/15 text-emerald-300" },
  connecting: { Icon: Loader2, long: "Connecting…", short: "Connecting", cls: "bg-white/10 text-neutral-200", spin: true },
  waiting: { Icon: UserRoundSearch, long: "Waiting for the other person", short: "Waiting", cls: "bg-white/10 text-neutral-200" },
  reconnecting: { Icon: RefreshCw, long: "Connection lost — reconnecting…", short: "Reconnecting", cls: "bg-amber-500/20 text-amber-200", spin: true },
  error: { Icon: WifiOff, long: "Disconnected", short: "Offline", cls: "bg-red-600/90 text-white" },
};

function ConnectionChip({ status }: { status: string }) {
  const c = CONNECTION[status];
  if (!c) return null;
  return (
    <span role="status" className={`flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium sm:text-sm ${c.cls}`}>
      <c.Icon className={`size-3.5 ${c.spin ? "animate-spin" : ""}`} aria-hidden />
      <span className="sm:hidden">{c.short}</span>
      <span className="hidden sm:inline">{c.long}</span>
    </span>
  );
}

export function CallView({ code, isHost, signedIn = false, settings, onLeft }: Props) {
  const { stream } = settings;
  const speaks = settings.mode !== "signer";
  const signs = settings.mode !== "non_signer";
  const wide = useMediaQuery("(min-width: 1024px)");
  const [camOn, setCamOn] = useState(settings.camOn);
  const [micOn, setMicOn] = useState(settings.micOn);
  // Side column on large screens (open by default); a bottom sheet on phones/tablets (closed by default).
  const [panel, setPanel] = useState<Panel | null>(() =>
    typeof window !== "undefined" && window.matchMedia("(min-width: 1024px)").matches ? "chat" : null,
  );
  // Captions are opt-in: Chrome's speech recognition sends microphone audio to Google.
  const [captionsOn, setCaptionsOn] = useState(false);
  const [readAloud, setReadAloud] = useState(speaks);
  const [lang, setLang] = useState<SpeechLang>("en-IN");
  const [signOn, setSignOn] = useState(signs);
  const [suggestion, setSuggestion] = useState<SignResult | null>(null);
  const [sendNote, setSendNote] = useState<SendNote | null>(null);
  const [library, setLibrary] = useState<SignLibrary | null>(null);
  // What Saathi is showing: a received sign, or the signs for received text.
  const [stage, setStage] = useState<{ tokens: GlossToken[]; heading: string } | null>(null);
  const shownIds = useRef(new Set<string>());
  const [seen, setSeen] = useState(0);
  const [confirmEnd, setConfirmEnd] = useState(false);
  const [linkCopied, copy] = useCopied();

  const call = useCall(code, settings.name, stream, true);
  const conv = useConversation(call, { name: settings.name, mode: settings.mode, micOn, camOn }, readAloud, lang);
  const captions = useSpeechCaptions(captionsOn && micOn && call.channelOpen, lang, conv.sendCaption);
  const personal = usePersonalSigns(signs && signedIn);
  const theirName = conv.remote?.name ?? call.remote?.name ?? "the other person";
  const onSign = useCallback(
    (raw: SignResult) => {
      // Not a confident built-in sign: maybe it's one of the user's own signs (offered, never auto-sent).
      let result = raw;
      if (raw.decision !== "accept" && raw.embedding && personal.threshold && personal.refs.length) {
        const m = matchPersonal(raw.embedding, personal.refs, personal.threshold);
        if (m) result = { ...raw, decision: "suggest", personal: m };
      }
      // A "no sign" result never replaces a card that is still counting down or waiting for a choice.
      setSuggestion((cur) => (cur && cur.decision !== "reject" && result.decision === "reject" ? cur : result));
      // The card sits just above the controls: don't hide it under the sheet.
      if (!wide && result.decision !== "reject") setPanel(null);
    },
    [wide, personal.refs, personal.threshold],
  );
  // The models load as soon as Signs is on; frames are only processed while the other person is
  // connected (results are meant for them), so a reconnect pauses recognition instead of reloading it.
  const recognition = useSignRecognition(stream, signOn && camOn, call.channelOpen, onSign);
  const { sendSign } = conv;
  const sendSuggestion = useCallback(
    (choice: SignChoice, via: SignVia) => {
      const ok = sendSign([choice.label], choice.text, choice.prob, via);
      setSuggestion(null);
      setSendNote({ ok, text: ok ? `Sent “${choice.text}”` : `Not sent — not connected`, at: Date.now() });
    },
    [sendSign],
  );
  useEffect(() => {
    if (!sendNote) return;
    const t = setTimeout(() => setSendNote(null), 3000);
    return () => clearTimeout(t);
  }, [sendNote]);
  const dismissSuggestion = useCallback(() => setSuggestion(null), []);

  // Saathi: everyone sees received signs performed by Saathi; people who sign also see what the other person
  // types or says as signs. Each message is shown once (by id), only from the other person, only when final.
  useEffect(() => {
    loadSignLibrary().then(setLibrary).catch((err) => console.warn(err));
  }, []);

  useEffect(() => {
    if (!library) return;
    const fresh = conv.entries.filter((e) => e.from === "them" && e.final && !shownIds.current.has(e.id));
    if (fresh.length === 0) return;
    fresh.forEach((e) => shownIds.current.add(e.id));
    const last = fresh[fresh.length - 1];
    let next: { tokens: GlossToken[]; heading: string } | null = null;
    if (last.kind === "sign") {
      next = { tokens: tokensForReceivedSign(last.gloss ?? [], last.text, library.ids), heading: `${theirName} signed` };
    } else if (signs) {
      const tokens = textToGloss(last.text, library.ids);
      if (tokens.some((t) => t.kind === "sign")) next = { tokens, heading: `${theirName} ${last.kind === "speech" ? "said" : "typed"}` };
    }
    if (!next) return;
    setStage(next); // the newest message from the other person
    if (!wide) setPanel(null); // on phones Saathi takes the space the sheet would cover
  }, [conv.entries, library, signs, theirName, wide]);

  const theirCount = conv.entries.filter((e) => e.from === "them" && e.final).length;
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- mark messages read while the chat is visible
    if (panel === "chat") setSeen(theirCount);
  }, [panel, theirCount]);
  const unread = panel === "chat" ? 0 : theirCount - seen;

  useEffect(() => {
    try {
      const saved = localStorage.getItem(LANG_KEY) as SpeechLang | null;
      // eslint-disable-next-line react-hooks/set-state-in-effect -- restore preference after hydration
      if (saved && SPEECH_LANGUAGES.some((l) => l.code === saved)) setLang(saved);
    } catch {}
  }, []);

  useEffect(() => {
    stream?.getVideoTracks().forEach((t) => (t.enabled = camOn));
    stream?.getAudioTracks().forEach((t) => (t.enabled = micOn));
  }, [stream, camOn, micOn]);

  // Release the camera when the tab closes. (Not in an unmount cleanup: React may re-run effects,
  // and a stopped track can't be restarted. Leaving the call stops it explicitly below.)
  useEffect(() => {
    const release = () => stopMedia(stream);
    window.addEventListener("pagehide", release);
    return () => window.removeEventListener("pagehide", release);
  }, [stream]);

  useEffect(() => {
    if (!confirmEnd) return;
    const t = setTimeout(() => setConfirmEnd(false), 4000);
    return () => clearTimeout(t);
  }, [confirmEnd]);

  function leave() {
    call.leave();
    stopSpeaking();
    stopMedia(stream);
    onLeft();
  }

  async function endForEveryone() {
    if (!confirmEnd) return setConfirmEnd(true);
    await endMeeting(code).catch(() => undefined);
    leave();
  }

  function changeLang(l: SpeechLang) {
    setLang(l);
    try {
      localStorage.setItem(LANG_KEY, l);
    } catch {}
  }

  const togglePanel = (p: Panel) => setPanel((cur) => (cur === p ? null : p));
  const link = typeof window !== "undefined" ? `${window.location.origin}/m/${code}` : `/m/${code}`;
  const canShare = typeof navigator !== "undefined" && typeof navigator.share === "function";
  const remoteLabel = call.remote ? `${theirName}${conv.remote && !conv.remote.micOn ? " · muted" : ""}` : undefined;
  const captionsSupported = speechRecognitionSupported();

  return (
    <main className="flex h-dvh flex-col overflow-hidden bg-neutral-950 text-white">
      <header className="flex h-14 shrink-0 items-center gap-2 px-3 sm:px-4">
        <span className="hidden size-8 shrink-0 items-center justify-center rounded-lg bg-brand sm:flex" aria-hidden>
          <Hand className="size-4.5" />
        </span>
        <button
          type="button"
          onClick={() => copy(link)}
          className="flex min-w-0 items-center gap-2 rounded-lg px-2 py-1.5 font-mono text-sm hover:bg-white/10"
          aria-label={`Meeting ${code}. Copy invite link`}
        >
          <span className="truncate">{code}</span>
          {linkCopied ? <Check className="size-4 text-emerald-400" /> : <Link2 className="size-4 text-neutral-400" />}
          <span className="sr-only" role="status">
            {linkCopied ? "Link copied" : ""}
          </span>
        </button>
        <ConnectionChip status={call.status} />
        {isHost && (
          <button
            type="button"
            onClick={endForEveryone}
            className={`ml-auto shrink-0 rounded-lg px-2.5 py-1.5 text-sm font-medium whitespace-nowrap transition-colors sm:px-3 ${
              confirmEnd ? "bg-red-600 text-white" : "text-red-300 hover:bg-red-500/15"
            }`}
          >
            {confirmEnd ? "Tap again to end" : "End meeting"}
          </button>
        )}
      </header>

      <div className="flex min-h-0 flex-1 gap-3 px-2 sm:px-4">
        <section className="relative min-h-0 min-w-0 flex-1" aria-label="Video">
          <VideoTile
            stream={call.remote?.stream ?? null}
            fit="contain"
            className="size-full"
            label={remoteLabel}
            placeholder={call.remote ? `${theirName} — connecting video…` : undefined}
          />

          {!call.remote && call.status !== "error" && (
            <div className="absolute inset-0 flex items-center justify-center p-4">
              <div className="w-full max-w-sm space-y-4 rounded-2xl bg-neutral-900/90 p-5 text-center shadow-xl ring-1 ring-white/10">
                <p className="text-lg font-semibold">Waiting for someone to join</p>
                <p className="text-sm text-neutral-400">Send them this link. They don&apos;t need an account.</p>
                <p className="font-mono text-2xl font-semibold tracking-widest">{code}</p>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => copy(link)}
                    className="flex h-12 flex-1 items-center justify-center gap-2 rounded-xl bg-white font-medium text-neutral-900"
                  >
                    {linkCopied ? <Check className="size-5" /> : <Link2 className="size-5" />}
                    {linkCopied ? "Copied" : "Copy link"}
                  </button>
                  {canShare && (
                    <button
                      type="button"
                      onClick={() => navigator.share({ title: "Join my SignSense call", url: link }).catch(() => undefined)}
                      className="flex h-12 items-center justify-center gap-2 rounded-xl bg-white/10 px-4 font-medium"
                    >
                      <Share2 className="size-5" /> Share
                    </button>
                  )}
                </div>
              </div>
            </div>
          )}

          {call.status === "error" && (
            <div className="absolute inset-0 flex items-center justify-center p-4">
              <div role="alert" className="w-full max-w-sm space-y-4 rounded-2xl bg-neutral-900/95 p-5 text-center ring-1 ring-white/10">
                <p className="text-lg font-semibold">{call.error ?? "The call stopped."}</p>
                <button type="button" onClick={leave} className="h-12 w-full rounded-xl bg-white font-medium text-neutral-900">
                  Leave call
                </button>
              </div>
            </div>
          )}

          <CaptionOverlay entries={conv.entries} />

          <div className="absolute top-2 right-2 aspect-[3/4] w-24 sm:top-3 sm:right-3 sm:aspect-[4/3] sm:w-44 lg:w-52">
            <VideoTile
              stream={camOn ? stream : null}
              muted
              mirrored
              placeholder={camOn ? "No camera" : "Camera off"}
              className="size-full border border-white/20 shadow-lg"
            />
          </div>

          {call.status === "reconnecting" && (
            <div className="absolute inset-x-0 top-0 flex justify-center p-3">
              <p className="flex items-center gap-2 rounded-full bg-black/75 px-4 py-1.5 text-sm" aria-hidden>
                <RefreshCw className="size-4 animate-spin" /> Reconnecting… the call will continue
              </p>
            </div>
          )}
        </section>

        {/* Right column on large screens: Saathi on top, the conversation below. */}
        <div className={`contents lg:min-h-0 lg:w-[380px] lg:shrink-0 lg:flex-col lg:gap-3 ${panel || (stage && wide) ? "lg:flex" : "lg:hidden"}`}>
        {stage && wide && library && (
          <SaathiStage
            library={library}
            tokens={stage.tokens}
            heading={stage.heading}
            onClose={() => setStage(null)}
            className={panel ? "h-[min(48dvh,440px)] shrink-0" : "min-h-0 flex-1"}
          />
        )}
        {panel && (
          <aside
            aria-label={panel === "chat" ? "Chat and captions" : "Picture board"}
            className="fixed inset-x-0 bottom-[84px] z-20 flex h-[min(62dvh,560px)] flex-col rounded-t-3xl border-t border-white/10 bg-neutral-900 shadow-2xl lg:static lg:h-auto lg:min-h-0 lg:w-full lg:flex-1 lg:rounded-2xl lg:border-0 lg:shadow-none"
          >
            <div className="flex items-center gap-2 p-3 pb-2">
              <div className="flex rounded-xl bg-neutral-800 p-1" role="tablist">
                {(
                  [
                    ["chat", "Chat", MessageSquare],
                    ["pictures", "Pictures", LayoutGrid],
                  ] as const
                ).map(([id, label, Icon]) => (
                  <button
                    key={id}
                    type="button"
                    role="tab"
                    aria-selected={panel === id}
                    onClick={() => setPanel(id)}
                    className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium ${
                      panel === id ? "bg-white text-neutral-900" : "text-neutral-300 hover:text-white"
                    }`}
                  >
                    <Icon className="size-4" aria-hidden /> {label}
                  </button>
                ))}
              </div>
              <button type="button" onClick={() => setPanel(null)} className="ml-auto rounded-full p-2 hover:bg-white/10" aria-label="Close panel">
                <X className="size-5" />
              </button>
            </div>

            <div className="flex flex-wrap items-center gap-2 px-3 pb-2 text-sm">
              <Chip
                on={captionsOn}
                onClick={() => setCaptionsOn((v) => !v)}
                disabled={!captionsSupported}
                title={
                  captionsSupported
                    ? "Turns your speech into captions for the other person. Chrome sends microphone audio to Google's speech service."
                    : "Live captions need Chrome or Edge."
                }
              >
                {captionsOn ? <Captions className="size-4" /> : <CaptionsOff className="size-4" />} Captions
              </Chip>
              <Chip
                on={readAloud}
                onClick={() => {
                  if (readAloud) stopSpeaking();
                  setReadAloud((v) => !v);
                }}
                title="Speak incoming signs and messages out loud"
              >
                {readAloud ? <Volume2 className="size-4" /> : <VolumeX className="size-4" />} Read aloud
              </Chip>
              <label className="sr-only" htmlFor="speech-lang">
                Speech language
              </label>
              <select
                id="speech-lang"
                value={lang}
                onChange={(e) => changeLang(e.target.value as SpeechLang)}
                className="h-8 rounded-full bg-neutral-800 px-3 text-sm text-white"
              >
                {SPEECH_LANGUAGES.map((l) => (
                  <option key={l.code} value={l.code}>
                    {l.label}
                  </option>
                ))}
              </select>
            </div>
            {speaks && captionsSupported && !captionsOn && (
              <p className="mx-3 mb-2 rounded-xl bg-brand/20 px-3 py-2 text-sm text-blue-100">
                Turn on <strong>Captions</strong> so {theirName} can read what you say.
              </p>
            )}
            {captionsOn && (captions.error || captions.listening) && (
              <p className="px-3 pb-2 text-xs text-neutral-400">{captions.error ?? "● Captioning your voice"}</p>
            )}

            <div className="flex min-h-0 flex-1 flex-col px-3 pb-3">
              {panel === "chat" ? (
                <ConversationPanel
                  entries={conv.entries}
                  myName={settings.name}
                  theirName={theirName}
                  canSend={call.channelOpen}
                  onSend={conv.sendChat}
                />
              ) : (
                <div className="min-h-0 flex-1 overflow-y-auto">
                  <PhraseBoard onSend={(text) => conv.sendChat(text)} disabled={!call.channelOpen} />
                </div>
              )}
            </div>
          </aside>
        )}
        </div>
      </div>

      {stage && !wide && library && (
        <SaathiStage
          library={library}
          tokens={stage.tokens}
          heading={stage.heading}
          onClose={() => setStage(null)}
          className="mx-2 mt-2 h-[min(42dvh,360px)] shrink-0 sm:mx-4"
        />
      )}

      {signOn && (
        <div className="shrink-0 space-y-2 px-2 pt-2 sm:px-4" aria-label="Sign recognition">
          {suggestion && <SignSuggestion key={suggestion.id} result={suggestion} onSend={sendSuggestion} onDismiss={dismissSuggestion} />}
          {!suggestion && (
            <RecognitionBar
              hasCamera={!!stream?.getVideoTracks().length}
              camOn={camOn}
              status={recognition.status}
              phase={recognition.phase}
              error={recognition.error}
              note={sendNote}
              onRetry={recognition.retry}
            />
          )}
        </div>
      )}

      <footer className="flex h-[84px] shrink-0 items-center justify-center gap-1.5 px-2 sm:gap-3" aria-label="Call controls">
        <Control label={micOn ? "Mic" : "Muted"} active={micOn} onClick={() => setMicOn((v) => !v)} disabled={!stream?.getAudioTracks().length}>
          {micOn ? <Mic /> : <MicOff />}
        </Control>
        <Control label={camOn ? "Camera" : "Cam off"} active={camOn} onClick={() => setCamOn((v) => !v)} disabled={!stream?.getVideoTracks().length}>
          {camOn ? <Video /> : <VideoOff />}
        </Control>
        <Control
          label="Signs"
          active={signOn}
          neutralOff
          onClick={() => {
            setSignOn((v) => !v);
            setSuggestion(null);
          }}
          title="Recognise your signs and send them as text and speech"
        >
          <Hand />
        </Control>
        <Control label="Pictures" active={panel === "pictures"} neutralOff onClick={() => togglePanel("pictures")} title="Quick messages with pictures">
          <LayoutGrid />
        </Control>
        <Control label="Chat" active={panel === "chat"} neutralOff onClick={() => togglePanel("chat")} badge={unread}>
          <MessageSquare />
        </Control>
        <button type="button" onClick={leave} className="flex w-[54px] flex-col items-center gap-1 text-[11px] sm:w-16 sm:text-xs" aria-label="Leave call">
          <span className="flex h-12 w-full items-center justify-center rounded-full bg-red-600 hover:bg-red-500 sm:h-14 [&_svg]:size-6">
            <PhoneOff />
          </span>
          Leave
        </button>
      </footer>
    </main>
  );
}

function Chip({ on, onClick, disabled, title, children }: { on: boolean; onClick: () => void; disabled?: boolean; title?: string; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      aria-pressed={on}
      className={`flex h-8 items-center gap-1.5 rounded-full px-3 font-medium disabled:opacity-40 ${
        on ? "bg-white text-neutral-900" : "bg-neutral-800 text-neutral-300 hover:text-white"
      }`}
    >
      {children}
    </button>
  );
}

function Control({
  label,
  active,
  neutralOff = false,
  onClick,
  disabled,
  title,
  badge = 0,
  children,
}: {
  label: string;
  active: boolean;
  /** Off is a normal state (not a warning), e.g. the chat panel — shown grey instead of red. */
  neutralOff?: boolean;
  onClick: () => void;
  disabled?: boolean;
  title?: string;
  badge?: number;
  children: ReactNode;
}) {
  const off = neutralOff ? "bg-neutral-800 text-neutral-300" : "bg-red-600";
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      aria-pressed={active}
      aria-label={badge > 0 ? `${label}, ${badge} new` : label}
      className="flex w-[54px] flex-col items-center gap-1 text-[11px] disabled:opacity-40 sm:w-16 sm:text-xs"
    >
      <span
        className={`relative flex size-12 items-center justify-center rounded-full sm:size-14 [&_svg]:size-6 ${
          active ? (neutralOff ? "bg-brand text-white" : "bg-neutral-700 hover:bg-neutral-600") : off
        }`}
      >
        {children}
        {badge > 0 && (
          <span className="absolute -top-0.5 -right-0.5 flex min-w-5 items-center justify-center rounded-full bg-red-500 px-1 text-[11px] font-semibold">
            {badge}
          </span>
        )}
      </span>
      {label}
    </button>
  );
}
