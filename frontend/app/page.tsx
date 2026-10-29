"use client";

import { Dashboard } from "@/components/home/dashboard";
import { Landing } from "@/components/home/landing";
import { SiteHeader } from "@/components/site-header";
import { useMe } from "@/hooks/use-me";

export default function Home() {
  const { user, setUser, error } = useMe();

  return (
    <>
      <SiteHeader user={user} onSignedOut={() => setUser(null)} />
      {error && (
        <p role="alert" className="mx-auto mt-4 w-full max-w-6xl rounded-lg bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {error}
        </p>
      )}
      {user === undefined ? (
        <main id="main" className="mx-auto w-full max-w-6xl flex-1 space-y-4 px-4 py-10 sm:px-6" aria-busy>
          <div className="h-9 w-56 animate-pulse rounded-lg bg-muted" />
          <div className="h-48 animate-pulse rounded-2xl bg-muted" />
        </main>
      ) : user ? (
        <Dashboard user={user} />
      ) : (
        <Landing />
      )}
    </>
  );
}
