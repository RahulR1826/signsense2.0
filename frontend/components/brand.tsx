import { Hand } from "lucide-react";
import Link from "next/link";

/** SignSense mark + wordmark. */
export function Logo({ href = "/", inverted = false }: { href?: string; inverted?: boolean }) {
  return (
    <Link href={href} className="flex items-center gap-2 rounded-lg font-semibold tracking-tight" aria-label="SignSense home">
      <span className="flex size-8 items-center justify-center rounded-lg bg-brand text-brand-foreground shadow-sm">
        <Hand className="size-4.5" strokeWidth={2.2} aria-hidden />
      </span>
      <span className={inverted ? "text-white" : "text-foreground"}>SignSense</span>
    </Link>
  );
}
