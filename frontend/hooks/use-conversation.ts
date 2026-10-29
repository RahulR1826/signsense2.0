"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { newId, parseMessage, type AppMessage, type CommunicationRole, type SignVia } from "@/lib/call/messages";
import { speak } from "@/lib/speech";

export type EntryKind = "chat" | "speech" | "sign";

export interface Entry {
  id: string;
  from: "me" | "them";
  kind: EntryKind;
  text: string;
  final: boolean;
  at: number;
  confidence?: number;
  /** Recognised signs only: sent automatically, or picked by the signer from an unsure result. */
  via?: SignVia;
  /** Recognised signs only: the sign ids (dictionary / model labels), validated on receipt. */
  gloss?: string[];
}

export interface RemoteInfo {
  name: string;
  mode: CommunicationRole;
  micOn: boolean;
  camOn: boolean;
}

interface CallLink {
  channelOpen: boolean;
  send: (data: unknown) => boolean;
  onData: (listener: (data: unknown) => void) => () => void;
}

const MAX_ENTRIES = 200;

/** Shared transcript of the call: typed chat, speech captions and recognised signs, both directions. */
export function useConversation(call: CallLink, me: RemoteInfo, readAloud: boolean, ttsLang: string) {
  // Depend on the stable callbacks, not the call object (it is recreated every render).
  const { channelOpen, send, onData } = call;
  const [entries, setEntries] = useState<Entry[]>([]);
  const [remote, setRemote] = useState<RemoteInfo | null>(null);
  const readAloudRef = useRef(readAloud);
  const langRef = useRef(ttsLang);

  useEffect(() => {
    readAloudRef.current = readAloud;
    langRef.current = ttsLang;
  });

  const upsert = useCallback((entry: Entry) => {
    setEntries((list) => {
      const i = list.findIndex((e) => e.id === entry.id && e.from === entry.from);
      if (i >= 0) {
        const next = list.slice();
        next[i] = entry;
        return next;
      }
      return [...list, entry].slice(-MAX_ENTRIES);
    });
  }, []);

  // Incoming messages.
  useEffect(
    () =>
      onData((raw) => {
        const msg = parseMessage(raw);
        if (!msg) return;
        switch (msg.type) {
          case "hello":
            setRemote({ name: msg.name, mode: msg.mode, micOn: msg.micOn, camOn: msg.camOn });
            break;
          case "chat":
            upsert({ id: msg.id, from: "them", kind: "chat", text: msg.text, final: true, at: Date.now() });
            if (readAloudRef.current) speak(msg.text, langRef.current);
            break;
          case "caption":
            upsert({ id: msg.id, from: "them", kind: "speech", text: msg.text, final: msg.final, at: Date.now() });
            break;
          case "sign":
            upsert({ id: msg.id, from: "them", kind: "sign", text: msg.text, final: true, at: Date.now(), confidence: msg.confidence, via: msg.via, gloss: msg.gloss });
            if (readAloudRef.current) speak(msg.text, langRef.current);
            break;
        }
      }),
    [onData, upsert],
  );

  // Introduce ourselves whenever the channel (re)opens or our state changes.
  const { name, mode, micOn, camOn } = me;
  useEffect(() => {
    if (channelOpen) send({ type: "hello", name, mode, micOn, camOn } satisfies AppMessage);
  }, [channelOpen, send, name, mode, micOn, camOn]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the other person left; forget their state
    if (!channelOpen) setRemote(null);
  }, [channelOpen]);

  const sendChat = useCallback(
    (text: string) => {
      const clean = text.trim().slice(0, 500);
      if (!clean) return false;
      const msg: AppMessage = { type: "chat", id: newId(), text: clean, at: Date.now() };
      if (!send(msg)) return false;
      upsert({ id: msg.id, from: "me", kind: "chat", text: clean, final: true, at: msg.at });
      return true;
    },
    [send, upsert],
  );

  const sendCaption = useCallback(
    (c: { id: string; text: string; final: boolean }) => {
      const text = c.text.slice(0, 500);
      send({ type: "caption", id: c.id, text, final: c.final, at: Date.now() } satisfies AppMessage);
      upsert({ id: c.id, from: "me", kind: "speech", text, final: c.final, at: Date.now() });
    },
    [send, upsert],
  );

  const sendSign = useCallback(
    (gloss: string[], text: string, confidence: number, via: SignVia) => {
      const msg: AppMessage = { type: "sign", id: newId(), gloss, text, confidence, at: Date.now(), via };
      if (!send(msg)) return false;
      upsert({ id: msg.id, from: "me", kind: "sign", text, final: true, at: msg.at, confidence, via, gloss });
      return true;
    },
    [send, upsert],
  );

  return { entries, remote, sendChat, sendCaption, sendSign };
}
