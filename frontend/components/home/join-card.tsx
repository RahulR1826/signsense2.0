"use client";

import { LogIn } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { getMeeting } from "@/lib/meetings";

/** Join by meeting code (guests don't need an account). */
export function JoinCard({ compact = false }: { compact?: boolean }) {
  const router = useRouter();
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function join(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const meeting = await getMeeting(code);
      if (meeting.status === "ended") throw new Error("This meeting has ended.");
      router.push(`/m/${meeting.code}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not find that meeting");
      setBusy(false);
    }
  }

  return (
    <form onSubmit={join} className="space-y-4 rounded-2xl border bg-card p-6 shadow-sm">
      <div className="flex items-center gap-3">
        <span className="flex size-11 items-center justify-center rounded-xl bg-muted">
          <LogIn className="size-5" aria-hidden />
        </span>
        <div>
          <h2 className="text-lg font-semibold">Join a call</h2>
          {!compact && <p className="text-sm text-muted-foreground">Type the code you were sent.</p>}
        </div>
      </div>
      <label htmlFor="join-code" className="sr-only">
        Meeting code
      </label>
      <Input
        id="join-code"
        placeholder="SS-7F4K2"
        className="h-14 rounded-xl text-center font-mono text-2xl tracking-widest uppercase"
        autoComplete="off"
        autoCapitalize="characters"
        spellCheck={false}
        value={code}
        onChange={(e) => setCode(e.target.value)}
        required
      />
      {error && (
        <p role="alert" className="rounded-lg bg-destructive/10 p-3 text-sm text-destructive">
          {error}
        </p>
      )}
      <Button type="submit" variant="secondary" size="xl" className="w-full" disabled={busy || !code.trim()}>
        {busy ? "Looking it up…" : "Join"}
      </Button>
    </form>
  );
}
