"use client";

import { ArrowRight, BookOpen, Check, Hand, Link2, Loader2, Plus, Settings2, Sparkles, Video } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { BackendStatus } from "@/components/backend-status";
import { JoinCard } from "@/components/home/join-card";
import { Reveal } from "@/components/motion/reveal";
import { SaathiGreeting } from "@/components/saathi/saathi-greeting";
import { SiteFooter } from "@/components/site-footer";
import { Button, buttonVariants } from "@/components/ui/button";
import { useToast } from "@/components/ui/toaster";
import type { User } from "@/lib/auth";
import { createMeeting, listMeetings, type Meeting } from "@/lib/meetings";

const MODE_LABEL = { signer: "I sign", non_signer: "I speak / type", both: "I sign and speak" } as const;

export function meetingLink(code: string) {
  return `${window.location.origin}/m/${code}`;
}

function CopyLink({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);
  const { toast } = useToast();
  return (
    <Button
      variant="outline"
      size="lg"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(meetingLink(code));
          setCopied(true);
          toast({ title: "Invite link copied", description: "Paste it into a message to the person you want to call." });
          setTimeout(() => setCopied(false), 2000);
        } catch {
          toast({ tone: "error", title: "Couldn't copy the link", description: `Share this code instead: ${code}` });
        }
      }}
      aria-label={`Copy invite link for ${code}`}
    >
      {copied ? <Check /> : <Link2 />} {copied ? "Copied" : "Copy link"}
    </Button>
  );
}

function when(iso: string) {
  return new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

export function Dashboard({ user }: { user: User }) {
  const router = useRouter();
  const { toast } = useToast();
  const [meetings, setMeetings] = useState<Meeting[] | null>(null);
  const [listFailed, setListFailed] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    listMeetings().then(setMeetings, () => {
      setMeetings([]);
      setListFailed(true);
    });
  }, []);

  async function start() {
    setBusy(true);
    try {
      const m = await createMeeting();
      router.push(`/m/${m.code}`);
    } catch (err) {
      setBusy(false);
      toast({ tone: "error", title: "Couldn't create a meeting", description: err instanceof Error ? err.message : "Please try again." });
    }
  }

  const active = meetings?.filter((m) => m.status === "active") ?? [];
  const past = meetings?.filter((m) => m.status === "ended").slice(0, 5) ?? [];
  const noCallsYet = meetings !== null && meetings.length === 0 && !listFailed;
  // Real state only: preferences saved? any meeting created? (Practice is optional and not tracked.)
  const guide = [
    { done: !!user.preferences, title: "Tell us how you communicate", body: "So calls open with the right tools.", href: "/onboarding", cta: "Set up", Icon: Settings2, optional: false },
    { done: false, title: "Practise a sign", body: "See what the recogniser understands — no call needed.", href: "/try", cta: "Practise", Icon: Hand, optional: true },
    { done: !noCallsYet && meetings !== null, title: "Start your first call", body: "Press New meeting, then send the link.", href: null, cta: null, Icon: Video, optional: false },
  ];

  return (
    <>
      <main id="main" className="mx-auto w-full max-w-6xl flex-1 space-y-8 px-4 py-10 sm:px-6">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div className="flex items-center gap-4">
            <SaathiGreeting className="size-16 sm:size-20" />
            <div>
              <p className="text-muted-foreground">Welcome back</p>
              <h1 className="text-3xl font-bold sm:text-4xl">{user.name}</h1>
            </div>
          </div>
          {user.preferences && (
            <Link href="/settings" className="rounded-full border bg-card px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground">
              {MODE_LABEL[user.preferences.mode]} · ISL
            </Link>
          )}
        </div>

        {(noCallsYet || !user.preferences) && (
          <Reveal as="section" className="rounded-3xl border bg-card p-5 shadow-[var(--shadow-soft)] sm:p-6">
            <h2 className="text-lg font-semibold">Getting started</h2>
            <ol className="mt-4 grid gap-3 md:grid-cols-3">
              {guide.map(({ done, optional, title, body, href, cta, Icon }) => (
                <li key={title} className={`flex gap-3 rounded-2xl border p-4 ${done ? "bg-success-soft/60" : "bg-background"}`}>
                  <span className={`flex size-9 shrink-0 items-center justify-center rounded-full ${done ? "bg-success text-white" : "bg-brand-soft text-brand"}`}>
                    {done ? <Check className="size-5" aria-hidden /> : <Icon className="size-4.5" aria-hidden />}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block font-medium">
                      {title}
                      {done && <span className="ml-1.5 text-xs font-normal text-success">Done</span>}
                      {optional && <span className="ml-1.5 text-xs font-normal text-muted-foreground">Optional</span>}
                    </span>
                    <span className="block text-sm text-muted-foreground">{body}</span>
                    {!done && href && cta && (
                      <Link href={href} className="mt-2 inline-flex items-center gap-1 text-sm font-medium text-brand hover:underline">
                        {cta} <ArrowRight className="size-3.5" aria-hidden />
                      </Link>
                    )}
                  </span>
                </li>
              ))}
            </ol>
          </Reveal>
        )}

        <div className="grid gap-4 lg:grid-cols-[1.4fr_1fr]">
          <section className="relative flex flex-col justify-between gap-6 overflow-hidden rounded-3xl bg-gradient-to-br from-brand to-blue-900 p-6 text-brand-foreground shadow-[var(--shadow-lift)] sm:p-8">
            <div aria-hidden className="absolute -top-16 -right-16 size-56 rounded-full bg-coral/30 blur-3xl" />
            <div className="relative space-y-2">
              <Video className="size-9" aria-hidden />
              <h2 className="text-2xl font-bold">Start a call</h2>
              <p className="text-brand-foreground/85">You get a link to send. The other person opens it — no account needed.</p>
            </div>
            <Button
              size="xl"
              variant="secondary"
              className="relative w-full bg-white text-neutral-900 hover:bg-white/90 sm:w-auto sm:self-start"
              onClick={start}
              disabled={busy}
            >
              {busy ? <Loader2 className="animate-spin" aria-hidden /> : <Plus />} {busy ? "Creating…" : "New meeting"}
            </Button>
          </section>
          <div id="join" className="scroll-mt-24">
            <JoinCard compact />
          </div>
        </div>

        {listFailed && (
          <p role="alert" className="rounded-2xl bg-destructive/10 p-4 text-sm text-destructive">
            Your meetings couldn&apos;t be loaded. You can still start or join a call.
          </p>
        )}
        {meetings === null && <div className="h-20 animate-pulse rounded-2xl bg-muted" role="status" aria-label="Loading your meetings" />}

        {active.length > 0 && (
          <section className="space-y-3">
            <h2 className="text-lg font-semibold">Open meetings</h2>
            <ul className="divide-y rounded-2xl border bg-card shadow-[var(--shadow-soft)]">
              {active.map((m) => (
                <li key={m.code} className="flex flex-wrap items-center gap-3 p-4">
                  <span className="flex items-center gap-1.5 rounded-full bg-success-soft px-2 py-0.5 text-xs font-medium text-success">
                    <span className="size-1.5 rounded-full bg-success" aria-hidden /> Open
                  </span>
                  <span className="font-mono text-lg font-semibold tracking-wider">{m.code}</span>
                  <span className="text-sm text-muted-foreground">{when(m.created_at)}</span>
                  <span className="ml-auto flex gap-2">
                    <CopyLink code={m.code} />
                    <Link href={`/m/${m.code}`} className={buttonVariants({ size: "lg" })}>
                      Rejoin
                    </Link>
                  </span>
                </li>
              ))}
            </ul>
          </section>
        )}

        <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {[
            { href: "/signs", title: "Sign dictionary", body: "Watch Saathi sign every word the app knows.", Icon: BookOpen },
            { href: "/try", title: "Practice signing", body: "See what the recogniser understands.", Icon: Hand },
            { href: "/my-signs", title: "My signs", body: "Record your own signs before a call.", Icon: Sparkles },
          ].map(({ href, title, body, Icon }) => (
            <Link key={href} href={href} className="card-interactive group flex items-center gap-4 rounded-2xl border bg-card p-5 hover:border-brand/50">
              <span className="flex size-12 items-center justify-center rounded-xl bg-brand-soft text-brand">
                <Icon className="size-6" aria-hidden />
              </span>
              <span className="flex-1">
                <span className="block font-semibold">{title}</span>
                <span className="text-sm text-muted-foreground">{body}</span>
              </span>
              <ArrowRight className="size-5 text-muted-foreground transition-transform group-hover:translate-x-0.5" aria-hidden />
            </Link>
          ))}
        </section>

        {past.length > 0 && (
          <section className="space-y-3">
            <h2 className="text-lg font-semibold">Recent calls</h2>
            <ul className="divide-y rounded-2xl border bg-card text-sm">
              {past.map((m) => (
                <li key={m.code} className="flex items-center gap-3 px-4 py-3">
                  <span className="font-mono font-medium">{m.code}</span>
                  <span className="text-muted-foreground">{when(m.created_at)}</span>
                  <span className="ml-auto rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">Ended</span>
                </li>
              ))}
            </ul>
          </section>
        )}

        {process.env.NODE_ENV !== "production" && (
          <details className="rounded-2xl border border-dashed p-4 text-sm text-muted-foreground">
            <summary className="cursor-pointer">Developer tools (development builds only)</summary>
            <div className="mt-3 space-y-2">
              <BackendStatus />
              <nav className="flex flex-wrap gap-4 text-xs" aria-label="Developer tools">
                <Link href="/landmarks" className="underline">Landmark viewer</Link>
                <Link href="/record" className="underline">Sign recorder</Link>
                <Link href="/import" className="underline">INCLUDE import</Link>
              </nav>
            </div>
          </details>
        )}
      </main>
      <SiteFooter />
    </>
  );
}
