"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";

import { Logo } from "@/components/brand";
import { CallView } from "@/components/call/call-view";
import { PreJoin, type FakeMedia, type JoinSettings } from "@/components/call/pre-join";
import { Button, buttonVariants } from "@/components/ui/button";
import { useMe } from "@/hooks/use-me";
import { API_URL } from "@/lib/api";
import { getMeeting, type Meeting } from "@/lib/meetings";

type Stage = { kind: "prejoin" } | { kind: "call"; settings: JoinSettings } | { kind: "left" };

export default function MeetingPage() {
  const { code } = useParams<{ code: string }>();
  const { user } = useMe();
  const [meeting, setMeeting] = useState<Meeting | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [stage, setStage] = useState<Stage>({ kind: "prejoin" });
  // Dev-only camera substitutes for testing without a webcam:
  //   /m/CODE?fake=1                       animated test pattern
  //   /m/CODE?fakevideo=<sign>/<file>      a looping INCLUDE clip (exercises sign recognition)
  const [fakeMedia] = useState<FakeMedia>(() => {
    if (process.env.NODE_ENV === "production" || typeof window === "undefined") return null;
    const q = new URLSearchParams(window.location.search);
    const clip = q.get("fakevideo");
    if (clip && /^[a-z0-9_-]+\/[A-Za-z0-9_.()-]+$/.test(clip)) {
      return { kind: "video", url: `${API_URL}/api/dataset/include/videos/${clip}` };
    }
    return q.has("fake") ? { kind: "pattern" } : null;
  });

  useEffect(() => {
    getMeeting(code)
      .then(setMeeting)
      .catch((err) => setError(err instanceof Error ? err.message : "Could not load the meeting"));
  }, [code]);

  if (error || meeting?.status === "ended") {
    return (
      <Centered>
        <h1 className="text-2xl font-semibold">{error ? "Meeting not found" : "This meeting has ended"}</h1>
        {error && <p className="text-muted-foreground">{error}</p>}
        <Link href="/" className={buttonVariants({ variant: "outline", size: "xl", className: "w-fit" })}>
          Back home
        </Link>
      </Centered>
    );
  }
  if (!meeting || user === undefined) {
    return (
      <Centered>
        <p className="text-muted-foreground">Looking up meeting…</p>
      </Centered>
    );
  }

  if (stage.kind === "call") {
    return <CallView code={meeting.code} isHost={meeting.is_host} signedIn={!!user} settings={stage.settings} onLeft={() => setStage({ kind: "left" })} />;
  }
  if (stage.kind === "left") {
    return (
      <Centered>
        <h1 className="text-2xl font-semibold">You left the call</h1>
        <div className="flex flex-col gap-3 sm:flex-row">
          <Button size="xl" onClick={() => getMeeting(code).then(setMeeting, () => undefined).finally(() => setStage({ kind: "prejoin" }))}>
            Rejoin
          </Button>
          <Link href="/" className={buttonVariants({ variant: "outline", size: "xl" })}>
            Back home
          </Link>
        </div>
      </Centered>
    );
  }
  return (
    <PreJoin
      code={meeting.code}
      hostName={meeting.host_name}
      isHost={meeting.is_host}
      user={user}
      fakeMedia={fakeMedia}
      onJoin={(settings) => setStage({ kind: "call", settings })}
    />
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <>
      <div className="mx-auto flex h-16 w-full max-w-6xl items-center px-4">
        <Logo />
      </div>
      <main className="mx-auto flex w-full max-w-xl flex-1 flex-col justify-center gap-4 px-4 pb-24">{children}</main>
    </>
  );
}
