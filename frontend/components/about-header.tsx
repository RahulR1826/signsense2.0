"use client";

import { SiteHeader } from "@/components/site-header";
import { useMe } from "@/hooks/use-me";

/** The site header for static pages (they render on the server; the header needs the signed-in user). */
export function AboutHeader() {
  const { user, setUser } = useMe();
  return <SiteHeader user={user} onSignedOut={() => setUser(null)} />;
}
