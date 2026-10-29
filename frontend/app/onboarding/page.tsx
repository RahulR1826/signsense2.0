"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

import { PreferencesForm } from "@/components/preferences-form";
import { SaathiGreeting } from "@/components/saathi/saathi-greeting";
import { SiteHeader } from "@/components/site-header";
import { useMe } from "@/hooks/use-me";

export default function OnboardingPage() {
  const router = useRouter();
  const { user, setUser } = useMe();

  useEffect(() => {
    if (user === null) router.replace("/login");
  }, [user, router]);

  return (
    <>
      <SiteHeader user={user} onSignedOut={() => setUser(null)} />
      <main id="main" className="mx-auto w-full max-w-3xl flex-1 space-y-8 px-4 py-10 sm:px-6">
        <div className="flex items-start gap-4">
          <SaathiGreeting className="size-20 sm:size-24" />
          <div className="space-y-2">
            <p className="text-sm font-medium text-brand">Hi, I&apos;m Saathi. One quick question</p>
            <h1 className="text-3xl font-bold sm:text-4xl">How do you communicate?</h1>
            <p className="text-muted-foreground">Calls will open with the right tools for you. You can change this any time.</p>
          </div>
        </div>
        {user && <PreferencesForm initial={user.preferences} submitLabel="Continue" onSaved={() => router.push("/")} />}
      </main>
    </>
  );
}
