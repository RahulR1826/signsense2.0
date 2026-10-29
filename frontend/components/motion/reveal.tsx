"use client";

import { usePathname } from "next/navigation";
import { useEffect, type CSSProperties, type ReactNode } from "react";

/**
 * Reveals every element marked `data-reveal` when it scrolls into view (once; never replays).
 * One IntersectionObserver for the whole page, plus a MutationObserver for content that renders later.
 * CSS (globals.css) only hides `[data-reveal]` while <html> has `reveal-ready`, which the head script
 * sets only when this can run and the user hasn't asked for reduced motion.
 */
export function RevealObserver() {
  const pathname = usePathname();

  useEffect(() => {
    (window as unknown as { __revealBooted: boolean }).__revealBooted = true;
    if (!document.documentElement.classList.contains("reveal-ready")) return;

    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (!e.isIntersecting) continue;
          e.target.classList.add("is-visible");
          io.unobserve(e.target);
        }
      },
      { rootMargin: "0px 0px -8% 0px", threshold: 0.12 },
    );
    const scan = () => document.querySelectorAll("[data-reveal]:not(.is-visible)").forEach((el) => io.observe(el));
    scan();
    let queued = false;
    const mo = new MutationObserver(() => {
      if (queued) return;
      queued = true;
      requestAnimationFrame(() => {
        queued = false;
        scan();
      });
    });
    mo.observe(document.body, { childList: true, subtree: true });
    return () => {
      io.disconnect();
      mo.disconnect();
    };
  }, [pathname]);

  return null;
}

/** Wrapper that reveals its content on scroll; `i` staggers siblings. */
export function Reveal({
  children,
  as: Tag = "div",
  i = 0,
  variant,
  className,
  style,
}: {
  children: ReactNode;
  as?: "div" | "section" | "li" | "article" | "figure" | "span";
  i?: number;
  variant?: "fade" | "scale";
  className?: string;
  style?: CSSProperties;
}) {
  return (
    <Tag data-reveal={variant ?? ""} className={className} style={{ ...style, ["--reveal-i" as string]: i }}>
      {children}
    </Tag>
  );
}
