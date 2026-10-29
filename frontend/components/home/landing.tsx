"use client";

import {
  ArrowRight,
  BookOpen,
  Captions,
  Check,
  Globe,
  Hand,
  Images,
  Link2,
  Lock,
  ShieldCheck,
  Sparkles,
  Video,
  Volume2,
} from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";

import { HeroDemo } from "@/components/home/hero-demo";
import { JoinCard } from "@/components/home/join-card";
import { TwoWayDemo } from "@/components/home/two-way-demo";
import { Reveal } from "@/components/motion/reveal";
import { SaathiGreeting } from "@/components/saathi/saathi-greeting";
import { SiteFooter } from "@/components/site-footer";
import { buttonVariants } from "@/components/ui/button";
import { loadSignLibrary, type LibrarySign } from "@/lib/signs/library";

const STEPS = [
  { Icon: Video, title: "Start a call", body: "Create a meeting and get a short code like SS-7F4K2." },
  { Icon: Link2, title: "Send the link", body: "Family join from any modern browser. No app, no account needed." },
  { Icon: Sparkles, title: "Talk your way", body: "Sign, speak, type or tap a picture — everyone sees and hears it." },
];

function useVocabulary() {
  const [signs, setSigns] = useState<LibrarySign[] | null>(null);
  const [recognised, setRecognised] = useState<Set<string>>(new Set());
  useEffect(() => {
    loadSignLibrary().then((lib) => setSigns(lib.signs), () => setSigns([]));
    fetch("/models/signs/config.json")
      .then((r) => (r.ok ? r.json() : null))
      .then((c: { classes?: string[] } | null) => setRecognised(new Set(c?.classes ?? [])))
      .catch(() => undefined);
  }, []);
  return { signs, recognised };
}

export function Landing() {
  const { signs, recognised } = useVocabulary();
  const recognisedCount = signs ? signs.filter((s) => recognised.has(s.id)).length : null;

  return (
    <>
      <main id="main" className="flex-1">
        {/* HERO */}
        <section className="relative isolate overflow-hidden">
          <div aria-hidden className="bg-grid absolute inset-0 -z-10 [mask-image:radial-gradient(ellipse_at_top,black_30%,transparent_75%)]" />
          <div aria-hidden className="absolute top-[-10rem] left-1/2 -z-10 h-[30rem] w-[60rem] -translate-x-1/2 rounded-full bg-gradient-to-r from-brand/15 via-sky-300/10 to-coral/15 blur-3xl" />
          <div className="mx-auto grid w-full max-w-6xl items-center gap-14 px-4 pt-10 pb-20 sm:px-6 md:pt-16 lg:grid-cols-[1.1fr_1fr] lg:pb-28">
            <div className="space-y-7">
              <Reveal className="flex items-center justify-between gap-3">
                <span className="inline-flex items-center gap-2 rounded-full border bg-card/80 px-3 py-1 min-w-0 text-xs font-medium shadow-[var(--shadow-soft)] sm:text-sm">
                  <span className="flex size-5 items-center justify-center rounded-full bg-brand text-brand-foreground">
                    <Hand className="size-3" aria-hidden />
                  </span>
                  Indian Sign Language · video calls
                </span>
                {/* On phones the call illustration is below the fold: Saathi says hello in the first screen. */}
                <SaathiGreeting className="size-14 shadow-[var(--shadow-soft)] sm:size-16 lg:hidden" />
              </Reveal>
              <Reveal i={1}>
                <h1 className="text-[2.6rem] leading-[1.05] font-bold sm:text-6xl">
                  Sign, speak or type. <span className="text-gradient">Everyone understands.</span>
                </h1>
              </Reveal>
              <Reveal i={2}>
                <p className="max-w-xl text-lg text-muted-foreground sm:text-xl">
                  SignSense is a video call for Deaf and hearing family. It turns supported ISL signs into words, shows spoken and typed
                  words as signs by Saathi, our signing guide, and has a picture board for everything else.
                </p>
              </Reveal>
              <Reveal i={3} className="flex flex-col gap-3 sm:flex-row">
                <Link href="/signup" className={buttonVariants({ size: "xl", className: "group shadow-[var(--shadow-lift)]" })}>
                  <Video /> Start a free call
                  <ArrowRight className="transition-transform group-hover:translate-x-0.5" />
                </Link>
                <Link href="/try" className={buttonVariants({ variant: "outline", size: "xl", className: "bg-card" })}>
                  <Hand /> Practice a sign — no account
                </Link>
              </Reveal>
              <Reveal i={4}>
                <ul className="flex flex-wrap gap-x-5 gap-y-2 text-sm text-muted-foreground">
                  {["Runs in your browser", "Guests join with a link", "Video is never stored"].map((t) => (
                    <li key={t} className="flex items-center gap-1.5">
                      <Check className="size-4 text-success" aria-hidden /> {t}
                    </li>
                  ))}
                </ul>
              </Reveal>
            </div>
            <Reveal variant="scale" i={2} className="mx-auto w-full max-w-md lg:max-w-none">
              <HeroDemo />
            </Reveal>
          </div>
        </section>

        {/* TWO-WAY DEMO */}
        <section id="demo" className="bg-ink text-ink-foreground">
          <div className="mx-auto w-full max-w-6xl space-y-10 px-4 py-20 sm:px-6 md:py-28">
            <Reveal className="max-w-2xl space-y-3">
              <p className="text-sm font-semibold tracking-wide text-coral uppercase">Both directions</p>
              <h2 className="text-3xl font-bold sm:text-5xl">See it work in both directions</h2>
              <p className="text-lg text-ink-muted">
                Words become signs — try it right here. Signs become words — with clear rules for when something is sent.
              </p>
            </Reveal>
            <Reveal i={1} className="rounded-[2rem] border border-white/10 bg-white/[0.04] p-5 sm:p-8">
              <TwoWayDemo />
            </Reveal>
          </div>
        </section>

        {/* HOW IT WORKS */}
        <section id="how" className="mx-auto w-full max-w-6xl px-4 py-20 sm:px-6 md:py-28">
          <Reveal className="max-w-2xl space-y-3">
            <p className="text-sm font-semibold tracking-wide text-brand uppercase">How it works</p>
            <h2 className="text-3xl font-bold sm:text-5xl">A call in three steps</h2>
          </Reveal>
          <div className="relative mt-12">
          <div aria-hidden className="absolute top-14 right-[16%] left-[16%] hidden h-px bg-gradient-to-r from-brand/0 via-brand/40 to-brand/0 md:block" />
          <ol className="relative grid gap-6 md:grid-cols-3">
            {STEPS.map(({ Icon, title, body }, i) => (
              <Reveal as="li" key={title} i={i} className="relative rounded-3xl border bg-card p-6 shadow-[var(--shadow-soft)]">
                <span className="relative flex size-16 items-center justify-center rounded-2xl bg-brand text-brand-foreground shadow-[var(--shadow-lift)]">
                  <Icon className="size-7" aria-hidden />
                  <span className="absolute -top-2 -right-2 flex size-7 items-center justify-center rounded-full border-2 border-card bg-coral text-sm font-bold text-white">
                    {i + 1}
                  </span>
                </span>
                <h3 className="mt-5 text-xl font-semibold">{title}</h3>
                <p className="mt-1.5 text-muted-foreground">{body}</p>
              </Reveal>
            ))}
          </ol>
          </div>
        </section>

        {/* FEATURES */}
        <section id="features" className="border-y bg-card/60">
          <div className="mx-auto w-full max-w-6xl px-4 py-20 sm:px-6 md:py-28">
            <Reveal className="max-w-2xl space-y-3">
              <p className="text-sm font-semibold tracking-wide text-brand uppercase">What&apos;s inside</p>
              <h2 className="text-3xl font-bold sm:text-5xl">Built for people who may not read</h2>
              <p className="text-lg text-muted-foreground">Pictures, signs and big buttons first. Text and speech for the hearing side.</p>
            </Reveal>
            <div className="mt-12 grid gap-4 md:grid-cols-6">
              <Reveal i={0} className="rounded-3xl bg-gradient-to-br from-brand to-blue-900 p-7 text-brand-foreground shadow-[var(--shadow-lift)] md:col-span-4">
                <Hand className="size-8" aria-hidden />
                <h3 className="mt-4 text-2xl font-semibold">Sign recognition on your device</h3>
                <p className="mt-2 max-w-lg text-brand-foreground/85">
                  The camera tracks hands and body in your browser. Supported signs become words for the other person — and unsure results
                  ask you first.
                </p>
                <div className="mt-6 flex flex-wrap gap-2 text-sm" aria-hidden>
                  <span className="flex items-center gap-1.5 rounded-full bg-white/15 px-3 py-1"><Check className="size-4" /> Sure → sent</span>
                  <span className="flex items-center gap-1.5 rounded-full bg-white/15 px-3 py-1">? Unsure → you choose</span>
                  <span className="flex items-center gap-1.5 rounded-full bg-white/15 px-3 py-1">✕ Unknown → nothing sent</span>
                </div>
              </Reveal>
              <Reveal i={1} className="rounded-3xl border bg-card p-7 shadow-[var(--shadow-soft)] md:col-span-2">
                <BookOpen className="size-8 text-brand" aria-hidden />
                <h3 className="mt-4 text-xl font-semibold">Words as signs</h3>
                <p className="mt-2 text-muted-foreground">What the hearing person says or types is signed in ISL by Saathi, our animated signer.</p>
              </Reveal>
              <Reveal i={0} className="rounded-3xl border bg-card p-7 shadow-[var(--shadow-soft)] md:col-span-2">
                <Images className="size-8 text-coral" aria-hidden />
                <h3 className="mt-4 text-xl font-semibold">Picture board</h3>
                <p className="mt-2 text-muted-foreground">One tap for water, food, pain, help, yes or no — no reading or signing needed.</p>
              </Reveal>
              <Reveal i={1} className="rounded-3xl border bg-card p-7 shadow-[var(--shadow-soft)] md:col-span-2">
                <Captions className="size-8 text-brand" aria-hidden />
                <h3 className="mt-4 text-xl font-semibold">Captions & read-aloud</h3>
                <p className="mt-2 text-muted-foreground">Optional live captions of speech, and incoming signs read out loud for the hearing side.</p>
              </Reveal>
              <Reveal i={2} className="rounded-3xl border bg-card p-7 shadow-[var(--shadow-soft)] md:col-span-2">
                <Globe className="size-8 text-success" aria-hidden />
                <h3 className="mt-4 text-xl font-semibold">Just a browser</h3>
                <p className="mt-2 text-muted-foreground">Works in Chrome or Edge on a laptop or phone. Guests join with a link.</p>
              </Reveal>
            </div>
          </div>
        </section>

        {/* VOCABULARY + HONEST LIMITS */}
        <section id="signs" className="mx-auto w-full max-w-6xl px-4 py-20 sm:px-6 md:py-28">
          <div className="grid gap-12 lg:grid-cols-[1.2fr_1fr]">
            <div className="space-y-6">
              <Reveal className="space-y-3">
                <p className="text-sm font-semibold tracking-wide text-brand uppercase">Vocabulary</p>
                <h2 className="text-3xl font-bold sm:text-5xl">
                  {signs && signs.length ? `${signs.length} everyday signs` : "Everyday signs"}, to start
                </h2>
                <p className="text-lg text-muted-foreground">
                  Family, health, feelings and greetings.
                  {recognisedCount ? ` The recogniser knows ${recognisedCount} of them; Saathi signs every one.` : ""}
                </p>
              </Reveal>
              <Reveal i={1}>
                <ul className="flex flex-wrap gap-2" aria-label="Supported signs">
                  {(signs ?? []).map((s) => (
                    <li key={s.id}>
                      <Link
                        href={`/signs?q=${encodeURIComponent(s.label)}`}
                        className="inline-flex items-center gap-1.5 rounded-full border bg-card px-3 py-1.5 text-sm transition-colors hover:border-brand/50 hover:text-brand"
                      >
                        {s.label}
                      </Link>
                    </li>
                  ))}
                  {!signs && Array.from({ length: 18 }, (_, i) => <li key={i} className="h-8 w-20 animate-pulse rounded-full bg-muted" />)}
                </ul>
              </Reveal>
              <Reveal i={2}>
                <Link href="/signs" className={buttonVariants({ variant: "outline", size: "lg", className: "bg-card" })}>
                  <BookOpen /> Open the sign dictionary
                </Link>
              </Reveal>
            </div>
            <Reveal i={1} className="rounded-3xl border bg-warning-soft/60 p-7">
              <ShieldCheck className="size-8 text-warning" aria-hidden />
              <h3 className="mt-4 text-xl font-semibold">Honest about what it can do</h3>
              <ul className="mt-4 space-y-3 text-muted-foreground">
                <li>It recognises <strong className="text-foreground">one sign at a time</strong>, from a small vocabulary — not continuous signing or full sentences.</li>
                <li>It was tested on <strong className="text-foreground">recorded clips</strong>, not yet with many real people and cameras.</li>
                <li>It can be wrong. That&apos;s why unsure results ask you, and signs it doesn&apos;t know are rejected instead of guessed.</li>
                <li>It has not been reviewed by Deaf users yet.</li>
              </ul>
              <Link href="/about#limits" className="mt-5 inline-flex items-center gap-1 font-medium text-brand hover:underline">
                Read the details <ArrowRight className="size-4" aria-hidden />
              </Link>
            </Reveal>
          </div>
        </section>

        {/* FINAL CTA */}
        <section id="start" className="px-4 pb-20 sm:px-6 md:pb-28">
          <Reveal variant="scale" className="relative mx-auto grid w-full max-w-6xl gap-10 overflow-hidden rounded-[2rem] bg-ink p-8 text-ink-foreground sm:p-12 lg:grid-cols-[1.2fr_1fr] lg:items-center">
            <div aria-hidden className="absolute -top-24 -right-24 size-72 rounded-full bg-brand/40 blur-3xl" />
            <div aria-hidden className="absolute -bottom-24 -left-24 size-72 rounded-full bg-coral/25 blur-3xl" />
            <div className="relative space-y-5">
              <h2 className="text-3xl font-bold sm:text-5xl">Ready to talk?</h2>
              <p className="max-w-md text-lg text-ink-muted">Create a free account to start calls. Got a code from someone? Join without an account.</p>
              <div className="flex flex-col gap-3 sm:flex-row">
                <Link href="/signup" className={buttonVariants({ size: "xl", className: "bg-white text-neutral-900 hover:bg-white/90" })}>
                  <Video /> Start a free call
                </Link>
                <Link href="/about#how-to" className={buttonVariants({ variant: "outline", size: "xl", className: "border-white/25 bg-transparent text-white hover:bg-white/10 hover:text-white" })}>
                  <Volume2 /> How to use it
                </Link>
              </div>
              <p className="flex items-center gap-2 text-sm text-ink-muted">
                <Lock className="size-4" aria-hidden /> Calls go directly between browsers. Recognition runs on your device.
              </p>
            </div>
            <div id="join" className="relative scroll-mt-28 text-foreground">
              <JoinCard />
            </div>
          </Reveal>
        </section>
      </main>
      <SiteFooter />
    </>
  );
}
