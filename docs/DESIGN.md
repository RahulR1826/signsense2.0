# SignSense design system

One reference for how the interface looks and moves. Tokens live in `frontend/app/globals.css`; the
components named below are the ones to reuse.

## Direction

**Human, clear, trustworthy, modern.**
- One light "paper" foundation for the site, with deep **ink** sections for depth on the landing page.
- The call screen is dark because video and signing read best on dark.
- One brand colour, **deep blue** `#1d4ed8` (Saathi's kurta), and one warm accent, **orange** `#f97316`
  (token name `coral`, kept for compatibility), for human moments. No purple.
- Pictures, Saathi's signs and big buttons come first; text supports them, because users may not read.

## Tokens

| Token | Use |
|---|---|
| `background` (warm off-white), `card` (white), `muted` | page, raised surfaces, quiet fills |
| `foreground`, `muted-foreground` | text (AA contrast on all light surfaces) |
| `brand` / `brand-soft` | primary actions, links, focus ring, selected states |
| `coral` / `coral-soft` | warm accents: step numbers, highlights on dark. **Not for small text on white** (contrast). |
| `success`, `warning`, `destructive` (+ `-soft`) | state colours, always paired with an icon or words |
| `ink`, `ink-foreground`, `ink-muted` | dark showcase sections, the auth side panel, the illustrated call |
| `--shadow-soft`, `--shadow-lift` | resting cards, hovered or primary elements |
| `--radius` 0.75 rem (`rounded-xl`), cards `rounded-2xl`/`3xl` | consistent corners |

**Type:**
- **Bricolage Grotesque** (`font-heading`, applied to h1–h3) for headings.
- **Geist** for body text, **Geist Mono** for meeting codes.
- Headings use balanced wrapping.

**Spacing:** Tailwind's 4 px scale. Page gutters `px-4 sm:px-6`, content max width `max-w-6xl`,
section rhythm `py-20 md:py-28` on the landing page.

## Saathi, the signing guide

Saathi is a drawn young woman who signs every dictionary word. She replaces the INCLUDE signers' videos and
photos everywhere on the site, because those people did not consent to appearing on this website.

- **Look:** deep-blue kurta `#1e40af` with darker side panels, a plain chest (signs are made in front of
  it), 3/4 sleeves with white cuffs that mark the elbow, a braid behind the shoulder, dark outlines `#1b1d2e`.
- **Hands:** the palm is lighter (`#e6b08c`) than the back of the hand (skin `#b97a52`), so the viewer can
  tell which way the hand faces.
- **Stage:** `.saathi-stage`, a light radial blue backdrop, so outlines and hands read clearly.
- **2D and 3D:** viewers choose with the **3D / 2D** toggle (dictionary and sign player; remembered per
  browser, `lib/saathi-style.ts`). **3D is the default**: short pre-rendered videos of a 3D Saathi in the same
  look (Blender, `ml/blender/saathi3d.py`, rendered by `ml/tools/render_saathi3d.py`). If a video cannot play,
  the 2D drawing takes over.
- **Where Saathi appears:** landing (hero call illustration; on phones a greeting next to the headline chip),
  dashboard and onboarding greetings (`saathi-greeting.tsx`, her real "Hello" sign), dictionary, sign player
  in calls (`compact`), the practice page's "Watch Saathi first" picker (`components/try/watch-saathi.tsx`) and the
  Settings style choice (`saathi-style-setting.tsx`). Never as a static stand-in for a sign she does not perform.
- **Code:** `components/saathi/saathi-figure.tsx` draws one 2D frame; `saathi-sign.tsx` plays a sign in the
  chosen style. Motion files are built by `ml/tools/build_sign_animations.py` (`anim/` for 2D, `anim3d/`
  with depth for Blender).
- **Motion:** with reduced motion, Saathi shows a still frame of the sign (the landing demo does not
  play); the dictionary plays a preview only on hover or focus.

## Components

- **`Button` / `buttonVariants`** (`components/ui/button.tsx`):
  - variants `default`, `outline`, `secondary`, `ghost`, `destructive`; sizes up to **`xl`** (48 px, for
    primary actions and touch).
  - `buttonVariants()` merges classes, so a `className` colour override always wins.
- **`SiteHeader`:**
  - sticky, and gains a background after scrolling (sentinel, no scroll listener);
  - highlights landing sections as you scroll past them (scroll-spy);
  - phone menu with an animated height, Escape to close, focus returned, closed menus `inert`.
- **`SiteFooter`:** every link points to a real page or section, enforced by `npm run check:journeys`.
- **`Toaster` / `useToast()`** (`components/ui/toaster.tsx`): confirmations of things that really
  happened (link copied, saved, deleted, failed). Polite live region, auto-dismiss, max 3 at once.
- **`Reveal` / `RevealObserver`** (`components/motion/reveal.tsx`): scroll-in reveal, see Motion.
- **Status:**
  - call connection chip and recognition strip: icon + words, never colour alone;
  - loading uses skeletons (`animate-pulse`) only while a request is really in flight.
- **Forms** (`auth-form.tsx` pattern):
  - visible labels;
  - per-field errors linked with `aria-describedby` and `aria-invalid`;
  - focus moves to the first invalid field;
  - input is kept after errors;
  - busy buttons show a spinner and say what is happening.

## Motion

Purpose first. Only `transform` and `opacity` are animated, and the timing curve is
`--ease-out-soft`.

| Motion | Where | How |
|---|---|---|
| Page entrance | every route (`app/template.tsx`) | 0.45 s fade + 8 px rise; `backwards` fill, so nothing persists (fixed-position children stay correct) |
| Scroll reveal | landing, dashboard guide | one shared IntersectionObserver; each element once, never replayed; `i` staggers siblings by 90 ms |
| Smooth anchor scroll | landing nav, About contents | CSS `scroll-behavior: smooth`; Next 16 turns it off for route changes (`data-scroll-behavior="smooth"` on `<html>`); `scroll-padding-top` clears the sticky header |
| Micro-interactions | buttons (lift/press), `.card-interactive` (lift), nav underline, toasts (slide in), mobile menu (grid-rows) | CSS transitions |
| Illustrations | hero call, decision examples | state machine on timers, paused when off screen, static under reduced motion; labelled "Illustration" |

**Safety nets:**
- Content is hidden for a reveal only when `<html class="reveal-ready">` is set. A tiny head script
  sets it only if IntersectionObserver exists *and* reduced motion is off, and removes it after 4 s if
  the app never boots. So content stays readable without JavaScript or if the app fails.
- `prefers-reduced-motion: reduce` turns off reveals, smooth scrolling, the hero loop, and every
  transition and animation duration.

## Accessibility checklist (all pages)

- "Skip to content" link first; every page has `<main id="main">`.
- Visible `:focus-visible` ring everywhere; essential controls are never hover-only.
- Touch targets ≥ 44 px for primary actions (the `xl` button is 48 px; call controls are 48–56 px).
- No horizontal scrolling at 320, 375, 768 or 1440 px wide (`npm run check:ui`).
- No state shown by colour alone (connection, recognition, decisions, dashboard steps).
