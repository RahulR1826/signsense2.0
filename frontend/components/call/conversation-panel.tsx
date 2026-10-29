"use client";

import { Hand, Keyboard, Mic, Send } from "lucide-react";
import { useEffect, useRef, useState, type FormEvent } from "react";

import type { Entry } from "@/hooks/use-conversation";

const KIND = {
  speech: { Icon: Mic, label: "said" },
  chat: { Icon: Keyboard, label: "typed" },
  sign: { Icon: Hand, label: "signed" },
} as const;

interface Props {
  entries: Entry[];
  myName: string;
  theirName: string;
  canSend: boolean;
  onSend: (text: string) => boolean;
}

/** Transcript of everything said, typed and signed in the call, plus a box to type a message. */
export function ConversationPanel({ entries, myName, theirName, canSend, onSend }: Props) {
  const [text, setText] = useState("");
  const listRef = useRef<HTMLOListElement>(null);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: "smooth" });
  }, [entries]);

  function submit(e: FormEvent) {
    e.preventDefault();
    if (onSend(text)) setText("");
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col rounded-2xl bg-neutral-950/60 ring-1 ring-white/5">
      <ol ref={listRef} className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4" aria-live="polite">
        {entries.length === 0 && (
          <li className="text-sm text-neutral-400">Captions, messages and signs will appear here.</li>
        )}
        {entries.map((e) => {
          const { Icon, label } = KIND[e.kind];
          const mine = e.from === "me";
          return (
            <li
              key={`${e.from}-${e.id}`}
              data-entry-id={e.id}
              data-entry-kind={e.kind}
              data-entry-from={e.from}
              data-entry-via={e.via}
              className={`flex flex-col ${mine ? "items-end" : "items-start"}`}
            >
              <span className="mb-0.5 flex items-center gap-1 text-xs text-neutral-400">
                <Icon className="size-3.5" aria-hidden />
                {mine ? "You" : theirName} {label}
                {e.kind === "sign" && e.via === "chosen" && " · chosen by the signer"}
                {e.kind === "sign" && e.via !== "chosen" && e.confidence !== undefined && ` · ${Math.round(e.confidence * 100)}% model confidence`}
              </span>
              <span
                className={`max-w-[90%] rounded-2xl px-3 py-2 text-base ${
                  mine ? "bg-white text-neutral-900" : "bg-neutral-700 text-white"
                } ${e.final ? "" : "opacity-70"}`}
              >
                {e.text}
              </span>
            </li>
          );
        })}
      </ol>
      <form onSubmit={submit} className="flex gap-2 border-t border-white/10 p-3">
        <label htmlFor="chat-input" className="sr-only">
          Type a message to {theirName}
        </label>
        <input
          id="chat-input"
          value={text}
          onChange={(e) => setText(e.target.value)}
          maxLength={500}
          placeholder={canSend ? `Message ${theirName}` : "Waiting for the other person…"}
          disabled={!canSend}
          className="h-11 min-w-0 flex-1 rounded-xl bg-neutral-800 px-3 text-white placeholder:text-neutral-500 disabled:opacity-50"
          autoComplete="off"
        />
        <button
          type="submit"
          disabled={!canSend || !text.trim()}
          className="flex size-11 items-center justify-center rounded-xl bg-white text-neutral-900 disabled:opacity-40"
          aria-label="Send message"
        >
          <Send className="size-5" />
        </button>
      </form>
      <p className="sr-only">You are {myName}.</p>
    </div>
  );
}
