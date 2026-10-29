import { Accessibility, CircleHelp, Hand, Lock, TriangleAlert } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { AboutHeader } from "@/components/about-header";
import { SiteFooter } from "@/components/site-footer";

export const metadata: Metadata = {
  title: "About, help & privacy",
  description: "How to use SignSense, what it can't do yet, accessibility and privacy.",
};

const SECTIONS = [
  { id: "how-to", label: "How to use it", Icon: CircleHelp },
  { id: "limits", label: "What it can't do yet", Icon: TriangleAlert },
  { id: "accessibility", label: "Accessibility", Icon: Accessibility },
  { id: "privacy", label: "Privacy", Icon: Lock },
];

function Section({ id, title, Icon, children }: { id: string; title: string; Icon: typeof Hand; children: React.ReactNode }) {
  return (
    <section id={id} className="scroll-mt-28 space-y-4 rounded-3xl border bg-card p-6 shadow-[var(--shadow-soft)] sm:p-8">
      <h2 className="flex items-center gap-3 text-2xl font-bold">
        <span className="flex size-10 items-center justify-center rounded-xl bg-brand-soft text-brand">
          <Icon className="size-5" aria-hidden />
        </span>
        {title}
      </h2>
      <div className="space-y-3 text-muted-foreground [&_strong]:text-foreground">{children}</div>
    </section>
  );
}

export default function AboutPage() {
  return (
    <>
      <AboutHeader />
      <main id="main" className="mx-auto w-full max-w-6xl flex-1 px-4 py-10 sm:px-6">
        <div className="max-w-2xl space-y-3">
          <h1 className="text-4xl font-bold sm:text-5xl">About SignSense</h1>
          <p className="text-lg text-muted-foreground">
            A video call with Indian Sign Language assistance, built as a student machine-learning project. Here is how to use it, and what
            it can and can&apos;t do.
          </p>
        </div>

        <div className="mt-10 grid grid-cols-[minmax(0,1fr)] gap-8 lg:grid-cols-[220px_minmax(0,1fr)]">
          <nav aria-label="On this page" className="lg:sticky lg:top-24 lg:self-start">
            <ul className="flex flex-wrap gap-2 lg:flex-col">
              {SECTIONS.map(({ id, label }) => (
                <li key={id}>
                  <a
                    href={`#${id}`}
                    className="block rounded-full border bg-card px-3 py-1.5 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground active:scale-[0.98] lg:rounded-lg lg:border-0 lg:bg-transparent lg:py-2 lg:hover:bg-muted"
                  >
                    {label}
                  </a>
                </li>
              ))}
            </ul>
          </nav>

          <div className="space-y-6">
            <Section id="how-to" title="How to use it" Icon={CircleHelp}>
              <ol className="list-decimal space-y-2 pl-5">
                <li>
                  <strong>Start a call:</strong> create an account, then press <em>New meeting</em>. You get a link and a short code.
                </li>
                <li>
                  <strong>Invite someone:</strong> send the link. They open it in Chrome or Edge, type their name and join — no account
                  needed.
                </li>
                <li>
                  <strong>Allow the camera and microphone</strong> when the browser asks. If you said no by mistake, click the camera icon in
                  the address bar to change it, then reload.
                </li>
                <li>
                  <strong>To sign:</strong> keep <em>Signs</em> on, start with your hands down, sign one word, then lower your hands. A card
                  shows what was recognised. Confident signs are sent after a 2-second countdown (you can cancel); unsure ones ask you to
                  choose.
                </li>
                <li>
                  <strong>To speak or type:</strong> type in <em>Chat</em>, tap a picture on the <em>Pictures</em> board, or turn on{" "}
                  <em>Captions</em> to send your speech as text. The signer sees Saathi sign the words that have a sign.
                </li>
              </ol>
              <p>
                You can practise signing on your own, without an account, on the <Link href="/try" className="font-medium text-brand underline">Practice</Link>{" "}
                page, and look up every sign in the <Link href="/signs" className="font-medium text-brand underline">dictionary</Link>.
              </p>
            </Section>

            <Section id="limits" title="What it can't do yet" Icon={TriangleAlert}>
              <ul className="list-disc space-y-2 pl-5">
                <li>
                  <strong>Small vocabulary:</strong> it recognises a starter set of everyday ISL signs (listed in the dictionary), one sign at a
                  time. It does not understand continuous signing, sentences or fingerspelling.
                </li>
                <li>
                  <strong>Tested on recordings, not people:</strong> the model was evaluated on recorded clips from the INCLUDE dataset. In a
                  stricter test on recording sessions it never saw, a model trained the same way picked the right sign about 86% of the time,
                  and usually asked the signer to confirm. It has not been measured with new people at real webcams.
                </li>
                <li>
                  <strong>It can be wrong:</strong> in tests, about 1 in 20 signs it was never taught was still sent as a word. Unsure results
                  always ask you first.
                </li>
                <li>
                  <strong>Saathi signs single words</strong> shown in your word order — not full ISL grammar.
                </li>
                <li>
                  <strong>Saathi is animated, not filmed:</strong> each sign copies the movement of one real ISL signer from the INCLUDE
                  dataset (shown in 3D, or as a 2D drawing). Some hand shapes are harder to read than on real video.
                </li>
                <li>
                  <strong>Calls between different networks</strong> (for example mobile data and home Wi-Fi) may not connect until a relay
                  (TURN) server is set up.
                </li>
                <li>
                  <strong>Not yet reviewed by Deaf users.</strong> Feedback from the Deaf community is the most important next step.
                </li>
              </ul>
            </Section>

            <Section id="accessibility" title="Accessibility" Icon={Accessibility}>
              <ul className="list-disc space-y-2 pl-5">
                <li>The core call works with pictures, Saathi&apos;s signs and big buttons — reading is not required.</li>
                <li>Everything can be used with a keyboard; focus is always visible. A “Skip to content” link is the first thing on every page.</li>
                <li>Animations are turned off if your device is set to reduce motion.</li>
                <li>Status is never shown by colour alone — there is always text or an icon too.</li>
                <li>The signer&apos;s video is never cropped, so signs at the edge of the frame stay visible.</li>
              </ul>
            </Section>

            <Section id="privacy" title="Privacy" Icon={Lock}>
              <ul className="list-disc space-y-2 pl-5">
                <li>
                  <strong>Video and audio</strong> go directly between the two browsers. They are never uploaded to or stored by SignSense.
                </li>
                <li>
                  <strong>Sign recognition</strong> runs entirely on your device. Camera frames and hand positions are not sent anywhere.
                </li>
                <li>
                  <strong>Messages</strong> (chat, recognised signs, pictures) also go directly between browsers and are not stored on the
                  server.
                </li>
                <li>
                  <strong>Live captions are off by default.</strong> If you turn them on, your browser&apos;s speech service makes them — in
                  Chrome this sends your microphone audio to Google.
                </li>
                <li>
                  <strong>We store:</strong> your name, email, a scrambled (hashed) password, your communication preferences, and when meetings
                  happened. You can delete your account in Settings.
                </li>
              </ul>
            </Section>
          </div>
        </div>
      </main>
      <SiteFooter />
    </>
  );
}
