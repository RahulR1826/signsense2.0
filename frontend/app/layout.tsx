import type { Metadata, Viewport } from "next";
import { Bricolage_Grotesque, Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

import { RevealObserver } from "@/components/motion/reveal";
import { Toaster } from "@/components/ui/toaster";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

// Display face for headings: humanist and characterful, still very legible at large sizes.
const display = Bricolage_Grotesque({
  variable: "--font-display",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: { default: "SignSense — video calls with Indian Sign Language assistance", template: "%s · SignSense" },
  description:
    "Video calls where Deaf and hearing family understand each other: on-device ISL sign recognition, sign video clips and a picture board.",
};

export const viewport: Viewport = {
  themeColor: "#fbfaf7",
};

// Runs before first paint: scroll-reveal animations may hide content only if the browser can show it
// again and the user hasn't asked for reduced motion. If the app never boots, content is shown anyway.
const REVEAL_BOOT = `(function(){try{var d=document.documentElement;if('IntersectionObserver' in window&&!matchMedia('(prefers-reduced-motion: reduce)').matches){d.classList.add('reveal-ready');setTimeout(function(){if(!window.__revealBooted)d.classList.remove('reveal-ready')},4000)}}catch(e){}})();`;

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      // Next.js disables smooth scrolling during route changes; in-page anchors still scroll smoothly.
      data-scroll-behavior="smooth"
      suppressHydrationWarning
      className={`${geistSans.variable} ${geistMono.variable} ${display.variable} h-full antialiased`}
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: REVEAL_BOOT }} />
      </head>
      <body className="flex min-h-full flex-col">
        <a
          href="#main"
          className="sr-only z-50 rounded-lg bg-brand px-4 py-2 text-brand-foreground focus:not-sr-only focus:fixed focus:top-3 focus:left-3"
        >
          Skip to content
        </a>
        <Toaster>{children}</Toaster>
        <RevealObserver />
      </body>
    </html>
  );
}
