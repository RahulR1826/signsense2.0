"use client";

import { BookOpen, Hand, Info, LayoutDashboard, LogOut, Menu, Settings, Sparkles, X } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { Logo } from "@/components/brand";
import { buttonVariants } from "@/components/ui/button";
import { useToast } from "@/components/ui/toaster";
import { logout, type User } from "@/lib/auth";

interface NavItem {
  href: string;
  label: string;
  Icon: typeof Hand;
  /** Section id on the landing page (scroll-spy), when the link points into it. */
  section?: string;
}

const PUBLIC_NAV: NavItem[] = [
  { href: "/#how", label: "How it works", Icon: Sparkles, section: "how" },
  { href: "/signs", label: "Sign dictionary", Icon: BookOpen },
  { href: "/try", label: "Practice", Icon: Hand },
  { href: "/about", label: "About", Icon: Info },
];

const APP_NAV: NavItem[] = [
  { href: "/", label: "Home", Icon: LayoutDashboard },
  { href: "/signs", label: "Sign dictionary", Icon: BookOpen },
  { href: "/try", label: "Practice", Icon: Hand },
  { href: "/my-signs", label: "My signs", Icon: Sparkles },
  { href: "/settings", label: "Settings", Icon: Settings },
];

interface Props {
  /** undefined while loading, null when signed out. */
  user: User | null | undefined;
  onSignedOut?: () => void;
}

/** Highlights the landing-page section currently in view (no scroll listeners). */
function useActiveSection(ids: string[], enabled: boolean) {
  const [active, setActive] = useState<string | null>(null);
  const key = ids.join(",");
  useEffect(() => {
    if (!enabled) return;
    const els = key
      .split(",")
      .map((id) => document.getElementById(id))
      .filter((el): el is HTMLElement => !!el);
    if (!els.length) return;
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) if (e.isIntersecting) setActive(e.target.id);
      },
      { rootMargin: "-45% 0px -50% 0px" },
    );
    els.forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, [key, enabled]);
  return active;
}

/** Top bar for every page except the call screen. */
export function SiteHeader({ user, onSignedOut }: Props) {
  const pathname = usePathname();
  const router = useRouter();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [raised, setRaised] = useState(false);
  const sentinel = useRef<HTMLDivElement>(null);
  const menuButton = useRef<HTMLButtonElement>(null);
  const nav = user ? APP_NAV : PUBLIC_NAV;
  const activeSection = useActiveSection(
    nav.flatMap((n) => (n.section ? [n.section] : [])),
    pathname === "/" && !user,
  );

  // Header gets a background + border once the page has scrolled (sentinel, not a scroll handler).
  useEffect(() => {
    const el = sentinel.current;
    if (!el) return;
    const io = new IntersectionObserver(([e]) => setRaised(!e.isIntersecting));
    io.observe(el);
    return () => io.disconnect();
  }, []);

  // Close the mobile menu on navigation and with Escape (focus goes back to the menu button).
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- route changed: the menu must close
    setOpen(false);
  }, [pathname]);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      setOpen(false);
      menuButton.current?.focus();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  async function signOut() {
    try {
      await logout();
    } catch {
      toast({ tone: "error", title: "Couldn't reach the server", description: "You may still be signed in. Try again." });
      return;
    }
    setOpen(false);
    onSignedOut?.();
    toast({ title: "Signed out" });
    router.push("/");
    router.refresh();
  }

  const isActive = (n: NavItem) => (n.section ? activeSection === n.section : pathname === n.href);

  return (
    <>
      <div ref={sentinel} aria-hidden className="h-px" />
      <header
        className={`sticky top-0 z-40 transition-[background-color,box-shadow,border-color] duration-300 ${
          raised || open ? "border-b bg-background/85 shadow-[var(--shadow-soft)] backdrop-blur-md" : "border-b border-transparent"
        }`}
      >
        <div className="mx-auto flex h-16 w-full max-w-6xl items-center gap-6 px-4 sm:px-6">
          <Logo />
          <nav className="hidden items-center gap-1 lg:flex" aria-label="Main">
            {nav.map((n) => (
              <Link
                key={n.href}
                href={n.href}
                aria-current={isActive(n) ? (n.section ? "location" : "page") : undefined}
                className={`relative rounded-lg px-3 py-2 text-sm font-medium transition-colors hover:bg-muted hover:text-foreground ${
                  isActive(n) ? "text-foreground" : "text-muted-foreground"
                }`}
              >
                {n.label}
                <span
                  aria-hidden
                  className={`absolute inset-x-3 -bottom-px h-0.5 origin-left rounded-full bg-brand transition-transform duration-300 ${isActive(n) ? "scale-x-100" : "scale-x-0"}`}
                />
              </Link>
            ))}
          </nav>
          <div className="ml-auto hidden items-center gap-2 lg:flex">
            {user ? (
              <>
                <span className="flex items-center gap-2 text-sm text-muted-foreground">
                  <span aria-hidden className="flex size-8 items-center justify-center rounded-full bg-brand-soft font-semibold text-brand">
                    {user.name.trim().charAt(0).toUpperCase() || "?"}
                  </span>
                  <span className="max-w-36 truncate">{user.name}</span>
                </span>
                <button type="button" onClick={signOut} className={buttonVariants({ variant: "ghost", size: "lg" })}>
                  <LogOut /> Sign out
                </button>
              </>
            ) : user === null ? (
              <>
                <Link href="/login" className={buttonVariants({ variant: "ghost", size: "lg" })}>
                  Sign in
                </Link>
                <Link href="/signup" className={buttonVariants({ size: "lg" })}>
                  Get started
                </Link>
              </>
            ) : (
              <span className="h-9 w-40 animate-pulse rounded-lg bg-muted" aria-hidden />
            )}
          </div>
          <button
            ref={menuButton}
            type="button"
            className="ml-auto flex size-11 items-center justify-center rounded-xl hover:bg-muted lg:hidden"
            aria-expanded={open}
            aria-controls="mobile-nav"
            aria-label={open ? "Close menu" : "Open menu"}
            onClick={() => setOpen((v) => !v)}
          >
            {open ? <X className="size-5" /> : <Menu className="size-5" />}
          </button>
        </div>

        {/* Mobile menu: height animates via grid rows (no layout thrash); hidden from tab order when closed. */}
        <div id="mobile-nav" className={`grid transition-[grid-template-rows] duration-300 ease-out lg:hidden ${open ? "grid-rows-[1fr]" : "grid-rows-[0fr]"}`} inert={!open}>
          <nav className="overflow-hidden" aria-label="Main">
            <div className="space-y-1 border-t px-4 py-3">
              {nav.map((n) => (
                <Link
                  key={n.href}
                  href={n.href}
                  onClick={() => setOpen(false)}
                  aria-current={isActive(n) ? "page" : undefined}
                  className="flex min-h-12 items-center gap-3 rounded-xl px-3 font-medium hover:bg-muted aria-[current]:bg-brand-soft aria-[current]:text-brand"
                >
                  <n.Icon className="size-5 text-muted-foreground" aria-hidden /> {n.label}
                </Link>
              ))}
              <div className="mt-2 flex gap-2 border-t pt-3">
                {user ? (
                  <button type="button" onClick={signOut} className={buttonVariants({ variant: "outline", size: "xl", className: "w-full" })}>
                    <LogOut /> Sign out
                  </button>
                ) : (
                  <>
                    <Link href="/login" className={buttonVariants({ variant: "outline", size: "xl", className: "flex-1" })}>
                      Sign in
                    </Link>
                    <Link href="/signup" className={buttonVariants({ size: "xl", className: "flex-1" })}>
                      Get started
                    </Link>
                  </>
                )}
              </div>
            </div>
          </nav>
        </div>
      </header>
    </>
  );
}
