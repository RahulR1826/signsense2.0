import Link from "next/link";

import { Logo } from "@/components/brand";

const COLUMNS = [
  {
    title: "Use SignSense",
    links: [
      { href: "/signup", label: "Create an account" },
      { href: "/#join", label: "Join a call with a code" },
      { href: "/try", label: "Practice signing" },
      { href: "/signs", label: "Sign dictionary" },
    ],
  },
  {
    title: "Help",
    links: [
      { href: "/about#how-to", label: "How to use it" },
      { href: "/about#limits", label: "What it can't do yet" },
      { href: "/about#accessibility", label: "Accessibility" },
      { href: "/about#privacy", label: "Privacy" },
    ],
  },
  {
    title: "Account",
    links: [
      { href: "/login", label: "Sign in" },
      { href: "/settings", label: "Settings" },
    ],
  },
];

/** Shared footer. Every link points to a page or section that exists. */
export function SiteFooter() {
  return (
    <footer className="mt-auto border-t bg-card/50">
      <div className="mx-auto grid w-full max-w-6xl gap-10 px-4 py-12 sm:px-6 md:grid-cols-[1.4fr_repeat(3,1fr)]">
        <div className="space-y-3">
          <Logo />
          <p className="max-w-xs text-sm text-muted-foreground">
            Video calls with Indian Sign Language assistance. A student research prototype — see what it can and can&apos;t do.
          </p>
        </div>
        {COLUMNS.map((c) => (
          <nav key={c.title} aria-label={c.title} className="space-y-3 text-sm">
            <h2 className="font-sans font-semibold">{c.title}</h2>
            <ul className="space-y-2">
              {c.links.map((l) => (
                <li key={l.href}>
                  <Link href={l.href} className="text-muted-foreground transition-colors hover:text-foreground">
                    {l.label}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
        ))}
      </div>
      <div className="border-t">
        <p className="mx-auto w-full max-w-6xl px-4 py-5 text-xs text-muted-foreground sm:px-6">
          Training data and Saathi&apos;s sign movements: INCLUDE dataset (AI4Bharat, CC BY 4.0), signed by Deaf students of St. Louis
          School for the Deaf, Chennai; no video of them is shown here. Hand tracking: Google MediaPipe. ISL only.
        </p>
      </div>
    </footer>
  );
}
