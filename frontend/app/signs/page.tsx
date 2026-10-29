"use client";

import { Hand, Play, Search } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";

import { SaathiSign } from "@/components/saathi/saathi-sign";
import { SaathiStyleToggle } from "@/components/saathi/saathi-style-toggle";
import { SignPlayer } from "@/components/signs/sign-player";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useMe } from "@/hooks/use-me";
import { textToGloss, type GlossToken } from "@/lib/signs/gloss";
import { loadSignLibrary, type SignLibrary } from "@/lib/signs/library";

/** Class ids the published recogniser knows (public/models/signs/config.json); null if no model. */
function useRecognisedSigns() {
  const [ids, setIds] = useState<Set<string> | null>(null);
  useEffect(() => {
    fetch("/models/signs/config.json", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((c: { classes?: string[] } | null) =>
        setIds(new Set(c?.classes ?? [])),
      )
      .catch(() => setIds(new Set()));
  }, []);
  return ids;
}

const pretty = (category: string) =>
  category.replace(/[_-]/g, " ").replace(/^\w/, (c) => c.toUpperCase());

export default function SignsPage() {
  const { user, setUser } = useMe();
  const [library, setLibrary] = useState<SignLibrary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [tokens, setTokens] = useState<GlossToken[] | null>(null);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const recognised = useRecognisedSigns();
  const playerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    loadSignLibrary()
      .then(setLibrary)
      .catch((err) =>
        setError(err instanceof Error ? err.message : String(err)),
      );
    // Deep link from the landing page: /signs?q=Hello
    const q = new URLSearchParams(window.location.search).get("q");
    // eslint-disable-next-line react-hooks/set-state-in-effect -- read the URL once after hydration
    if (q) setQuery(q.slice(0, 40));
  }, []);

  const categories = useMemo(
    () => [...new Set(library?.signs.map((s) => s.category) ?? [])],
    [library],
  );
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (library?.signs ?? []).filter(
      (s) =>
        (!category || s.category === category) &&
        (!q || s.label.toLowerCase().includes(q) || s.id.includes(q)),
    );
  }, [library, query, category]);

  function play(t: GlossToken[]) {
    setTokens(t);
    setSelected(t.length === 1 && t[0].kind === "sign" ? t[0].id : null);
    // On phones the player sits above the grid: bring it into view.
    requestAnimationFrame(() =>
      playerRef.current?.scrollIntoView({
        behavior: "smooth",
        block: "nearest",
      }),
    );
  }

  function show(e: FormEvent) {
    e.preventDefault();
    if (library) play(textToGloss(text, library.ids));
  }

  return (
    <>
      <SiteHeader user={user} onSignedOut={() => setUser(null)} />
      <main
        id="main"
        className="mx-auto w-full max-w-6xl flex-1 space-y-8 px-4 py-8 sm:px-6"
      >
        <div className="space-y-2">
          <h1 className="text-3xl font-bold sm:text-4xl">
            ISL sign dictionary
          </h1>
          <p className="text-muted-foreground">
            Tap a sign to watch it, or type a sentence to see it signed word by
            word.
          </p>
        </div>
        {error && (
          <p
            role="alert"
            className="rounded-lg bg-destructive/10 p-3 text-sm text-destructive"
          >
            {error}
          </p>
        )}

        <section className="grid gap-6 md:grid-cols-[1fr_340px]">
          <form
            onSubmit={show}
            className="space-y-3 rounded-2xl border bg-card p-5"
          >
            <label htmlFor="sentence" className="font-semibold">
              Type something to see it in signs
            </label>
            <div className="flex flex-col gap-2 sm:flex-row">
              <Input
                id="sentence"
                className="h-12 text-base"
                placeholder="Amma, take your medicine today"
                value={text}
                onChange={(e) => setText(e.target.value)}
              />
              <Button
                type="submit"
                size="xl"
                disabled={!library || !text.trim()}
              >
                <Play /> Show signs
              </Button>
            </div>
            {tokens && tokens.some((t) => t.kind === "text") && (
              <p
                role="status"
                className="rounded-xl bg-warning-soft px-3 py-2 text-sm"
              >
                No sign yet for:{" "}
                <strong>
                  {tokens
                    .filter((t) => t.kind === "text")
                    .map((t) => t.word)
                    .join(", ")}
                </strong>
                .{" "}
                {tokens.some((t) => t.kind === "sign")
                  ? "Those words are shown as text."
                  : "Try one of the signs below."}
              </p>
            )}
            <p className="text-sm text-muted-foreground">
              Signs follow your word order (not full ISL grammar). Words without
              a sign are shown as text — never fingerspelled.
            </p>
          </form>
          <div ref={playerRef} className="scroll-mt-20">
            {tokens && library ? (
              tokens.length > 0 ? (
                <div className="space-y-3">
                  <SignPlayer
                    library={library}
                    tokens={tokens}
                    onClose={() => setTokens(null)}
                  />
                  {selected && library.byId.get(selected) && (
                    <div className="flex flex-wrap items-center gap-2 text-sm">
                      <span className="rounded-full bg-muted px-2.5 py-1">
                        {pretty(library.byId.get(selected)!.category)}
                      </span>
                      {recognised?.has(selected) ? (
                        <span className="inline-flex items-center gap-1 rounded-full bg-brand-soft px-2.5 py-1 font-medium text-brand">
                          <Hand className="size-3.5" aria-hidden /> The
                          recogniser knows this sign
                        </span>
                      ) : (
                        <span className="rounded-full bg-muted px-2.5 py-1 text-muted-foreground">
                          Clip only — not recognised yet
                        </span>
                      )}
                    </div>
                  )}
                </div>
              ) : (
                <p className="rounded-2xl border border-dashed p-6 text-center text-muted-foreground">
                  No signs for that yet.
                </p>
              )
            ) : (
              <div className="hidden h-full min-h-48 flex-col items-center justify-center gap-2 rounded-2xl border border-dashed p-6 text-center text-muted-foreground md:flex">
                <Play className="size-8" aria-hidden />
                <span>Signs play here</span>
              </div>
            )}
          </div>
        </section>

        {library && (
          <section className="space-y-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <h2 className="text-lg font-semibold">
                {shown.length === library.signs.length
                  ? `All ${library.signs.length} signs`
                  : `${shown.length} of ${library.signs.length} signs`}
              </h2>
              <div className="relative sm:w-72">
                <Search
                  className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
                  aria-hidden
                />
                <Input
                  aria-label="Search signs"
                  placeholder="Search signs"
                  className="h-11 pl-9 text-base"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                />
              </div>
            </div>
            {categories.length > 1 && (
              <div
                className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1"
                role="group"
                aria-label="Filter by category"
              >
                {[null, ...categories].map((c) => (
                  <button
                    key={c ?? "all"}
                    type="button"
                    aria-pressed={category === c}
                    onClick={() => setCategory(c)}
                    className={`shrink-0 rounded-full border px-4 py-2 text-sm font-medium transition-colors ${
                      category === c
                        ? "border-brand bg-brand text-brand-foreground"
                        : "bg-card hover:border-brand/40"
                    }`}
                  >
                    {c ? pretty(c) : "All"}
                  </button>
                ))}
              </div>
            )}
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-muted-foreground">
              <p className="flex min-w-0 flex-1 basis-72 items-start gap-2">
                <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-brand-soft px-2 py-0.5 text-xs font-medium text-brand">
                  <Hand className="size-3" aria-hidden /> Recognised
                </span>
                <span>
                  = the recogniser understands this sign. Saathi signs every word; tap a card to watch, or point at it for a preview.
                </span>
              </p>
              <SaathiStyleToggle />
            </div>
            {shown.length === 0 ? (
              <p className="rounded-2xl border border-dashed p-8 text-center text-muted-foreground">
                No signs match “{query}”.
              </p>
            ) : (
              <ul className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-6">
                {shown.map((s) => (
                  <li key={s.id}>
                    <button
                      type="button"
                      onClick={() =>
                        play([{ kind: "sign", id: s.id, word: s.label }])
                      }
                      onPointerEnter={() => setPreview(s.id)}
                      onPointerLeave={() =>
                        setPreview((p) => (p === s.id ? null : p))
                      }
                      onFocus={() => setPreview(s.id)}
                      onBlur={() => setPreview((p) => (p === s.id ? null : p))}
                      className="card-interactive group relative w-full overflow-hidden rounded-2xl border bg-card text-left shadow-[var(--shadow-soft)] hover:border-brand/50"
                    >
                      <span className="saathi-stage block">
                        <SaathiSign
                          sign={s}
                          playing={preview === s.id}
                          loop
                          label=""
                          className="aspect-square w-full"
                        />
                      </span>
                      <span
                        className="absolute inset-0 flex items-center justify-center opacity-0 transition-opacity group-hover:opacity-100"
                        aria-hidden
                      >
                        <span className="rounded-full bg-black/55 p-3 text-white">
                          <Play className="size-5" />
                        </span>
                      </span>
                      {recognised?.has(s.id) && (
                        <span className="absolute top-2 left-2 inline-flex items-center gap-1 rounded-full bg-background/90 px-2 py-0.5 text-xs font-medium text-brand shadow-sm">
                          <Hand className="size-3" aria-hidden /> Recognised
                        </span>
                      )}
                      <span className="block px-3 py-2 font-medium">
                        {s.label}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <p className="text-xs text-muted-foreground">
              {library.attribution}
            </p>
          </section>
        )}
      </main>
      <SiteFooter />
    </>
  );
}
