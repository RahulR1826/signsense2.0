# Development log

What changed, why, and the evidence. Newest first. Numbers here were measured, not estimated; each
names the command that produced it.

## 2026-10-29 — Live 3D Saathi in calls

- Built a rigged Saathi in Blender by script (`ml/blender/saathi_rig.py`) and baked one clip per sign from the
  recorded landmark motion; rendered live with three.js / React Three Fiber (`components/saathi/saathi-live.tsx`)
  in a new call stage (`components/call/saathi-stage.tsx`). Received signs and received text are performed by
  Saathi; protocol unchanged; fallbacks to the recorded/2D player.
- Bugs found by testing: (1) Blender 4.5 actions created with `fcurves.new` have no slot and never animate — the
  first build exported clips where only the mouth moved; fixed with `keyframe_insert`. (2) Face bones pivoted
  away from the eyes/lips, so blinking moved them; pivots moved onto the parts. (3) Fixed-length arm bones missed
  the wrist by up to 22 cm (contact signs failed); joints are now placed and arm bones stretch (0 cm; 30 → 35/39
  readable). (4) Test-only: chat typed before the data channel opened; session cookie missing for 127.0.0.1.
- Measured: recogniser reads 35/39 rig clips first (17 auto, 0 wrong); `check:saathi-call` 7/7; existing suites
  unchanged. No Deaf-user validation. Details: `docs/SAATHI_3D_LIVE.md`, `PROJECT_PROGRESS_REPORT.md` R7.

## 2026-10-28 (later) — Milestone 1: UI/UX pass, 931-clip retrain, practice-page warm-up

Full results: `PROJECT_PROGRESS_REPORT.md` section R6. Summary:
- **UI/UX:** compact phone call header and in-call Saathi player; Saathi greeting (real "Hello" sign) on the
  landing first screen (phones), dashboard and onboarding; "Watch Saathi first" picker on `/try`; Saathi 3D/2D
  choice in Settings; My signs shortcut; dictionary/About phone layouts; corrected footer attribution; dev badge
  off. `check:ui` now catches content cut off at the screen edge (it would have caught a 320 px regression I
  introduced and then fixed). Journeys 13/13.
- **Retrain:** all 931 OOV training clips, 3 seeds + session split, with/without "gift" (which the published model
  reads as "baby"). Official split: same accuracy, fewer unknown auto-sends (1.9% vs 5.0%) but fewer automatic
  sends and, in one seed, 3 wrong auto-sends. Session split: more real signs rejected (18.2% vs 11.8%), half the
  automatic sends, 1 unseen word auto-sent (vs 0). **Published model kept.** Auto-send floor of 0.95 now enforced
  in threshold tuning and checked on the published config.
- **Practice page:** models warm up in the background after the page opens; camera-on → first result ~3 s after
  a few seconds on the page (was 9–15 s), main thread responsive throughout (simulated camera).
- **Next:** `docs/NEXT_MILESTONE.md` (Learn ISL with Saathi; sign search; vocabulary expansion).

## 2026-10-28 — 3D Saathi (Blender, rendered on the RTX 4060)

**What:** a 3D Saathi in the same look (deep-blue kurta, white cuffs, braid, lighter palms) now signs every
dictionary word as a short pre-rendered video, and is the **default** on the website. A **3D / 2D** toggle
(dictionary and sign player, remembered per browser) switches to the live 2D drawing; if a video fails, the 2D
drawing takes over.

**How:**
- Blender 4.5.15 LTS, portable, at `D:	oolslender-4.5.15-windows-x64` (official zip, SHA-256 checked;
  installed on D: because C: has ~11 GB free). Rendering with EEVEE on the RTX 4060 (OptiX/CUDA visible).
- `ml/tools/build_sign_animations.py` now also writes `sign-library/anim3d/<id>.json` (not served) with depth.
  **MediaPipe's pose depth was unusable for wrists** (it put the "Hello" hand four shoulder widths in front of
  the body), so arm depth comes from fixed bone lengths (upper arm 0.8, forearm 0.7 shoulder widths, or the
  longest on-screen length): depth = sqrt(length² − on-screen length²), with the pose depth deciding only
  forwards/backwards. Hand points use the hand model's depth relative to the wrist.
- `ml/blender/saathi3d.py` builds Saathi from smooth parts and places each arm and finger segment between its
  two tracked joints every frame (no skinning, so the hands match the recorded skeleton seen from the front).
  Head orientation from forehead, chin and eye corners (damped); brows, blinks and mouth from the face values.
- `ml/tools/render_saathi3d.py` renders 480×480 frames and encodes H.264 videos + posters into
  `sign-library/saathi3d/` (39 signs, ~30 KB each, 2.3 MB total). About 15 minutes for all signs.
- Recogniser renders use an **orthographic** camera at the source video's framing: the motion's x/y already are
  a camera projection, and a perspective render added a second perspective (wrist error 7% → 4–5% of a
  shoulder width after the change). Website renders keep a 100 mm lens.

**Can the recogniser read the 3D Saathi?** Same checks as 2D (`eval:saathi --frames3d`, `check:saathi --frames3d`):

| | Right sign first | Accepted + right | Wrong word accepted | Rejected | Hands found |
|---|---|---|---|---|---|
| Offline, **3D** | **35/39** | 14 | 0 | 8 | 55% |
| Offline, 2D | 33/39 | 16 | 0 | 10 | 50% |
| Offline, source landmarks (upper bound) | 39/39 | 34 | 0 | 0 | — |
| Camera pass 2, **3D** | **28/39** | 12 | 0 | 9 | — |
| Camera pass 2, 2D | 27/39 | 13 | 0 | 10 | — |
| Camera pass 2, source video | 37/39 | 26 | 0 | 0 | — |

- 3D and 2D are about equally readable by the model, 3D slightly ahead on "right sign first" and with fewer
  rejections; both are well below the real recordings. 3D is the default for its depth cues; this was not tested
  with people.
- Weakest in 3D (offline, rejected): how are you, good night, mother, friend, healthy, good, house, telephone.
- Docs/report call screenshots now use the 3D Saathi's "Hello" as the signer's camera (accepted in a live call).
- Reports: `ml/reports/saathi3d_eval.json`, `saathi3d_check.json`.

**Checks:** tsc, lint, test:signs 39 (+ 3D asset test), ml 15, backend 77, journeys 12/12, live call 12/12,
check:ui, build OK.

**Not verified:** how Deaf viewers rate 2D vs 3D Saathi against real video (no user study).

## 2026-10-27 (later) — Saathi, the 2D signer, replaces real signers on the website

**Why:** the INCLUDE signers did not consent to appearing on this website, so their videos and photos are
no longer shown. Saathi, a drawn young woman (deep-blue kurta, braid, palette chosen by the user), signs every
dictionary word instead: landing hero, the "Words → signs" demo, dictionary cards and player, and text→sign in
calls. The site's brand colour changed from indigo to deep blue `#1d4ed8` with an orange accent `#f97316`.

**How:**
- `ml/tools/build_sign_animations.py` turns the landmarks of each sign's dictionary clip (same segment as the
  old video) into `sign-library/anim/<id>.json`, 10–30 KB each: body-relative coordinates, gaps ≤ 8 frames
  interpolated, light smoothing, face reduced to head position/tilt, brows, eyes, mouth. No pixels.
  "Good morning"'s dictionary clip showed no signing at all in its landmarks (hands at rest throughout);
  the builder now falls back to the best-tracked non-test clip of the same sign that shows signing.
- `components/saathi/saathi-figure.tsx` draws one frame as SVG; `saathi-sign.tsx` plays it (still frame
  with reduced motion; dictionary cards play on hover/focus).
- `npm run setup:runtime` now copies only the motion files to `public/`; videos/posters are removed from
  `public/` (the old URLs return 404, checked by `check:journeys`).

**Can the recogniser read Saathi?** Two checks, both on this machine with the published model:
- `npm run eval:saathi` (offline, deterministic): draw each frame at the source video's framing → the app's
  MediaPipe extractor → features → model + decision policy. Source = the clip's stored landmarks, same model.
- `npm run check:saathi` (camera): Saathi rendered to video and played as the camera of `/try` (Chrome fake
  capture device), versus the source segment. Pass 2 = steady state after start-up.
- The source clips are mostly **training** clips (the dictionary never used test clips), so "source" is an
  upper bound, not a test score. This measures how much is lost by drawing the motion.

| Check | Right sign first | Accepted + right | Wrong word accepted | Rejected | Hands found |
|---|---|---|---|---|---|
| Offline, first drawing (black-outlined hands) | 17/39 | 5 | 1 | 23 | 23% |
| **Offline, final drawing** | **33/39** | **16** | **0** | 10 | 50% |
| Offline, source landmarks | 39/39 | 34 | 0 | 0 | — |
| Camera, first drawing (pass 1) | 9/39 | 3 | 0 | 21 (+5 no result) | — |
| **Camera, final drawing (pass 2)** | **27/39** | **13** | **0** | 10 | — |
| Camera, source video (pass 2) | 37/39 | 26 | 0 | 0 | — |

- **Finding:** MediaPipe barely tracked hands drawn with black outlines. A thin skin-tone outline and slightly
  thinner fingers raised hand tracking from 23% to 50% of frames. Tuned on 10 signs with the worst tracking
  (black outline 2/10 right first; skin-tone outline 10/10; no outline 6/10; larger hands 9/10); all 39 then re-measured above.
- **Weakest signs** (offline, rejected): mother, friend, baby, good, house, bed, telephone, money, tomorrow,
  yesterday. People may also find these harder to read; not measured with people.
- In the docs, call screenshots now use Saathi's rendered "Hello" as the signer's camera (recognised live,
  in a call); recognition tests still use the INCLUDE **test** clips.
- Reports: `ml/reports/saathi_eval.json`, `saathi_eval_black_outline.json`, `saathi_check.json`.

**Not verified:** whether Deaf viewers find Saathi's signs as clear as video (no user study); depth is lost
in 2D. The 3D Saathi is next.

## 2026-10-27 — "My signs": personal signs recorded before a call

**What it does:**
- A signed-in user names a sign (optionally with an emoji picture) and records it 3–5 times on
  `/my-signs`.
- Only landmark frames are stored, never video: per user, owner-only, deleted with the account; at
  most 20 signs, 3–5 takes each, ≤ 90 frames per take.
- In a call, or on `/try`, when no built-in sign is confident, the sign is compared with the user's
  own signs. A match is **offered as "Is this your sign?" and never sent without a tap**; the receiver
  sees it marked "chosen by the signer".

**Design study** (`ml/tools/personal_study.py` → `ml/reports/personal_study.json`):
- Real INCLUDE clips of words the model never saw (word-disjoint OOV val/test words, 3 clips each).
- Simulate a user with 5 personal words, 2 enrolment clips each, 300 draws.
- Positives: the held-out clip of each enrolled word. Negatives: clips of other unseen words and the
  121 known-sign test clips.
- Thresholds chosen on **validation** words, scored once on **test** words.
- Enrolment and query clips are mostly **different INCLUDE signers**, so these numbers are pessimistic
  for a real user, who enrols and signs themself.

| Matcher | Right word among 5 (forced choice) | Matched correctly at ~0.6% false matches | at ~3.3% false matches |
|---|---|---|---|
| **Model embedding** (pooled 192-d representation, cosine) | **91.3%** | 27.8% | **52.4%** |
| DTW over hand/pose/handshape features | 57.3% | 3.3% | 6.1% |

**Decision:**
- Use the embedding, with the val-chosen threshold for the 5% target (cosine ≥ 0.9537; test: 52%
  matched, 3.3% false matches).
- The more sensitive point is acceptable because a personal match is **only ever a suggestion**: a
  false match costs one dismiss, never a wrong word.
- **Same-person accuracy is not yet measured.**

**Enrolment checks:**
- **Takes are consistent:** every pair's similarity must be ≥ 0.57, the 5th percentile of same-word
  pairs on validation words (median 0.91; different words median 0.73).
- **Built-in sign:** the user is told when the takes already look like a built-in sign.
- **Clash:** the user is told when the sign is close to another of their own signs.
- **Take quality:** a take under 0.6 s or with fewer than 8 frames is ignored (the e2e run showed that a
  busy device can produce 6-frame takes).

**Model change, no retraining:**
- The published ONNX was re-exported with a second output, `embedding`
  (`ml/tools/add_embedding_output.py`). Logits are unchanged: max |new − old| = 0.0.
- `config.json` gained `embeddingDim` and `personal.threshold`.
- `export.py` now always exports both outputs, and `model.features()` gives the pooled representation.

**Bug found while testing:** sorting ONNX Runtime Web's `session.outputNames` in place scrambles the
output mapping (the embedding came back with 40 values). The test now sorts a copy.

**Files:**
- **Backend:** `app/models` (PersonalSign, PersonalSignSample), `app/schemas/personal_signs.py`,
  `app/api/personal_signs.py`, migration `b7c1e2d4f901`, `tests/test_personal_signs.py` (11 tests).
- **Frontend:** `lib/signs/personal.ts`, `lib/signs/embedding.ts`, `lib/personal-signs.ts`,
  `hooks/use-personal-signs.ts`, `app/my-signs/page.tsx`; `use-sign-recognition` returns the segment
  and the embedding; personal suggestions in `call-view` / `sign-suggestion` and on `/try`; "My signs"
  in the header (the header now switches to the menu below 1024 px, because the extra link overflowed
  at 768 px).
- **Tests:** `scripts/personal.test.mjs` (5), an embedding contract test in `inference.test.mjs`, and
  `npm run check:my-signs` (`scripts/my-signs-e2e.mjs`).
  - The e2e test is a **plumbing test**: it records takes from a fake camera playing an unseen-word
    clip, saves them, and then in a call with the same clip checks that the "Is this your sign?" card
    appears, nothing is sent before the tap, and the listener receives it marked "chosen".
  - It uses the same recording for enrolling and calling, so it does not measure accuracy.

**Not yet verified:** a real person enrolling and using their own signs at a webcam.

## 2026-10-25 (later) — Website transformation, practice page, hardening, deployment readiness

### Audit (before changing anything)

- **Routes:**
  - public: `/`, `/login`, `/signup`, `/signs`, `/try`, `/m/[code]` (guests);
  - signed-in: `/` (dashboard), `/onboarding`, `/settings`;
  - developer tools: `/landmarks`, `/record`, `/import`.
- **Existing pieces:** shadcn Button / Input / Label / Card; a site header and logo; the call
  components.
- **Missing:**
  - no animation library and no motion system;
  - no shared footer, help or privacy page;
  - no toasts (each page showed its own inline "Saved").
- **Problems found:**
  - **`buttonVariants()` did not merge classes**, so `className` colour overrides lost to the
    variant: white buttons with white text on dark sections. Fixed for every call site.
  - `/try` still ran MediaPipe on the page: a **6.3 s freeze** at start, then 75 long tasks per 10 s
    (measured below).
  - The auth form showed raw server text (for example email-validator details).
  - Settings promised nothing about account deletion, and none existed.
  - The progress-report figures were re-checked first: backend 62, ml 11, frontend 29 (all passed
    before changes).

### Design system and motion (details: `docs/DESIGN.md`)

- **Tokens:**
  - warm paper background, deep ink sections, indigo brand, coral accent, success/warning soft tints;
  - two shadow levels; one easing curve.
- **Type:** Bricolage Grotesque for headings, Geist for body.
- **Motion:**
  - page entrance (`app/template.tsx`);
  - one-shot scroll reveal through a single shared IntersectionObserver
    (`components/motion/reveal.tsx`);
  - smooth in-page anchors with a sticky-header offset (Next 16 `data-scroll-behavior="smooth"`
    keeps route changes instant);
  - button lift/press, card lift, nav underline, animated mobile menu, toasts.
  - Only transform and opacity are animated, with no scroll listeners.
  - Reduced motion turns all of it off. Content can't stay hidden if JavaScript fails: a 4 s fallback
    removes the hiding class.
- **New shared pieces:** `SiteFooter`, `Toaster`/`useToast`, `Reveal`, `/about` (how to use it, what
  it can't do yet, accessibility, privacy), skip-to-content link, `<main id="main">` on every page.

### Pages

- **Landing:**
  - hero with an *illustrated* call (labelled) that plays the real "Hello" dictionary clip;
  - "both directions" demo: the **Words → signs** half is the real text-to-sign feature; the
    **Sign → words** half illustrates the real accept / ask / reject rules (labelled) and links to
    `/try`;
  - three-step how-it-works, feature grid;
  - vocabulary chips loaded from the real library and model config;
  - an honest-limits panel and a final CTA with join-by-code.
- **Auth:**
  - per-field validation with `aria-invalid` / `aria-describedby` and focus moved to the first error;
  - show/hide password, length hint, server errors mapped to fields;
  - input kept after errors; spinner; signed-in visitors redirected.
- **Dashboard:**
  - "Getting started" guide driven by real state (preferences saved, any meeting created);
  - loading, error and empty states; copy-link toasts; developer tools folded away (dev builds only).
- **Settings:** toasts for saves; **Delete account** (password required; see Backend).
- **Dictionary:** `?q=` deep links; names exactly which typed words have no sign; shows whether the
  recogniser knows the selected sign.
- **Practice (`/try`):** see below.
- **Call:**
  - connection chip with icon + words (Live / Waiting / Connecting / Reconnecting / Offline, longer
    labels on wider screens);
  - reconnecting overlay; copy-link toasts;
  - camera error messages now say how to fix them.

### Practice page: same pipeline as calls

`/try` now uses `useSignRecognition`, so it shares the call's Web Worker, model cache, decision policy
and cleanup. There is no second pipeline. The camera starts on an explicit **Turn on camera** button,
with plain help for blocked, missing or busy cameras, a **Stop camera** button, and Retry on errors.

Measured with `npm run check:try` (`scripts/try-perf.mjs`: recorded "Hello" clip as the camera,
headless Chrome, dev server):

| `/try` | Before (main thread) | After (worker), final run | After, runs under heavy load |
|---|---|---|---|
| Longest main-thread task during start-up | **6,280 ms** | 143 ms | 90–144 ms |
| Long tasks in 10 s of steady use | **75** (max 150 ms) | **0** | 1–5 (max 57–96 ms) |
| Worst timer delay (how late input handling can run) | 112 ms | — | 17–82 ms |
| First result after opening the page | 13.7 s | **10.1 s** (warm-up 5.7 s, MediaPipe 36 ms/frame) | 19–27 s (warm-up 16–20 s) |

**Trade-off:**
- The page never freezes, but the first result arrives later. GPU warm-up on this laptop varied from
  6 to 25 s between runs today, and machine load drove MediaPipe from 35 to 150 ms per frame (the
  same in calls: 35.6 → 78 ms within one hour).
- Removing a `backdrop-blur` that sat over the live preview cut `/try` from 151 to 102 ms per frame.
- Features resample by timestamp, so skipped frames only lower confidence (more confirmations), never
  speed signs up.

### Unknown-sign false accepts: investigated, policy unchanged

`ml/tools/rejection_study.py` → `ml/reports/rejection_study.json`.
- **Setup:** extra gates that can only downgrade an auto-send to "ask"; each threshold chosen on
  **validation** (54 known clips, 153 unknown clips of 51 words), then scored once on the **same
  official test set** (121 known, 141 unknown clips of 47 unseen words).

| Rule | Val unknown auto-sent | Test unknown auto-sent | Test known auto-sent correct | Wrong |
|---|---|---|---|---|
| Published policy (unchanged) | 2/153 | **7/141 (5.0%)** | 86/121 | 0 |
| G1 every placement ≥ t | no threshold passed the keep rule | 7/141 | 86/121 | 0 |
| G2 p(unknown) ≤ t | — | 7/141 | 86/121 | 0 |
| G3 energy ≥ t | — | 7/141 | 86/121 | 0 |
| G4 per-class raised thresholds | 0/153 (but loses 2 of 38 correct) | 7/141 | 82/121 | 0 |

- **Conclusion:** validation has only 2 false accepts, too few to tune anything. G4, the only rule
  that changed anything, did not reduce test false accepts and cost 4 correct auto-sends, so **no
  change was made**.
- Test false accepts by predicted class: **yesterday 3**, i 1, bathroom 1, hot 1, friend 1.
- Next lever: more varied unknown-sign *training* data (below).

### Backend, security, deployment

- **Account deletion:** `DELETE /api/users/me`, password required again (rate-limited like login).
  - Deletes preferences and hosted meetings (with their participants), and closes any live call
    first.
  - In other hosts' meeting history the person becomes "Deleted user" with no account link.
  - Tests: deletion, wrong password, not signed in, anonymisation.
- **Settings safety:**
  - `JWT_SECRET` must be ≥ 32 characters.
  - `ENVIRONMENT=production` refuses insecure cookies, dev tools on, or `http://` CORS origins, and
    hides `/docs` and `/openapi.json`.
  - Errors are plain `UnsafeSettings`, deliberately **not** pydantic errors, which echoed input values
    including the database URL into the log (found while testing; a test now checks that no secret
    appears).
- **Production check without Docker:** backend in production mode → health 200, database 200,
  `/docs` 404, dev endpoints 404, headers present.
- **Migrations:** `backend/scripts/check_migrations.py`: fresh throwaway database → `upgrade head` →
  **0 differences** from the models → `downgrade base` OK → database dropped.
- **Docker:**
  - `exec` so uvicorn and Next get SIGTERM (graceful shutdown); non-root users; health checks on all
    services;
  - frontend waits for a healthy backend; restart policies;
  - optional **coturn** service (`--profile turn`) with `use-auth-secret`, private-network relays
    denied, quotas. Guide: `docs/DEPLOYMENT.md`.
  - **Docker is not installed here, so none of it has been built or run.**
- **Not done:** revoking stolen sessions before expiry (stateless JWT, 7 days); multi-process
  backends (rooms and rate limits are in memory).

### Automated verification added

| Command | What it does |
|---|---|
| `npm run check:journeys` (`scripts/journeys.mjs`) | 11 first-time-user journeys against the real app and database: landing nav + smooth anchor + reveal; reduced motion; mobile menu (Escape, focus return, inert when closed); sign-up validation → account → onboarding → dashboard guide → new meeting → settings rename → delete account (wrong then right password); login error keeps input; dictionary deep link + playback + missing words; **no dead internal links** (52 checked) |
| `npm run check:ui` | now also `/about` and `/try`, and a **320 px** width (4 sizes × 14 screens); fails on horizontal overflow |
| `npm run check:try` | practice-page start-up and responsiveness |

Bugs these checks found and that were fixed:
- the gradient headline rendered as solid blocks (minified `background` shorthand);
- white-on-white buttons (`buttonVariants` merge);
- sideways scrolling on About at 320 px and on the landing page at 768 px (grid `minmax(0,1fr)`);
- a reserved-domain email showing raw validator text;
- deleting an account redirected to the sign-in page instead of home (redirect race);
- lint: a ref read during render.

## 2026-10-25 — Live recognition hardening

**Goal:** make the published model work reliably in a real call, with recognised signs delivered to
the other person and unsure results handled safely. The traced workflow is in
`docs/LIVE_RECOGNITION.md`. The model and vocabulary are **unchanged**:
`20261021-001816-cnn-candidate`, 39 ISL signs plus `unknown`, thresholds as published.

### Audit: what was already wired, and the defects found

The path was complete:
- one camera stream shared by WebRTC and recognition;
- MediaPipe → segmenter → ONNX + policy → suggestion card → data channel → the receiver's transcript,
  captions and TTS;
- no cloud step, and the receiver runs no model.

Defects found by reading the code and by measurement:

| # | Defect | Fix |
|---|---|---|
| D1 | One exception in `detect()` escaped the timer callback and **stopped the loop silently** | Per-frame error handling: a bad frame is skipped; 30 failures in a row show an error with **Retry** |
| D2 | Recognition was gated on the data channel, so **every connection blip reloaded** the ONNX model and three MediaPipe models (and Signs off/on re-fetched the model) | `enabled` (models loaded) and `active` (frames processed) are separate; the model is cached per page; pausing clears any half-made sign |
| D3 | Holding hands up produced **a new sign every 4 s** (the max-length cut restarted immediately) | After a too-long cut, hands must come down before the next sign (`segmenter.ts`, tested) |
| D4 | A later "reject" **replaced a card that was counting down** or waiting, losing a valid sign | Rejects never replace an accept or suggest card |
| D5 | Countdown, Send now and Enter could **all send** the same card | Each card sends at most once |
| D6 | When the channel was closed, `sendSign` failed **silently** | "Sent “Hello”" / "Not sent — not connected" feedback |
| D7 | The signer only saw Loading / Signing / Ready, and errors were tooltip-only | Status strip: no camera, camera off, loading, paused, step into view, hands not seen, ready, watching, recognising, sent / not sent, error + Retry |
| D8 | The recognition card **covered the remote video** | The card moved to its own strip below the video; video area measured, never overlapped |
| D9 | **MediaPipe's first frame froze the main thread for 6.75 s**, right when the other person connected; then 36 ms of main-thread work per frame (11 long tasks per 10 s) | MediaPipe moved to a **Web Worker** (`lib/landmarks/landmark-worker.ts`), warmed up while loading |
| D10 | A confidence % was shown to the signer as if it were a probability of being right | Removed. The receiver sees "N% model confidence" for auto-sent signs and "chosen by the signer" for picked ones (new `via` field) |
| D11 | A raw ONNX error ("ERROR_CODE: 7 …") was shown to users | Plain messages; technical detail goes to the console |
| D12 | Test scripts called the API on `localhost`, which Node resolves to `::1`, while uvicorn listens on `127.0.0.1` | Scripts use `127.0.0.1` and copy the session cookie to `localhost`; the live test logs in once (login rate limit) |

**Kept as is, after checking:**
- The policy: accept ≥ 0.95, which implies a lead of ≥ 0.90 over the runner-up. Accept also needs
  all 3 window placements to agree. A test now enforces both for any future model.
- The 2 s cancellable countdown.
- Suggest always needs a tap.
- No threshold was lowered.

### Automated end-to-end verification (SIMULATED camera)

`npm run check:recognition` → `frontend/scripts/live-call-e2e.mjs`.

**How it works.** Chrome's fake capture device plays a recorded INCLUDE **test-split** clip at
640×360, 15 fps (`--use-file-for-fake-video-capture`). So the app's real `getUserMedia`, MediaPipe,
segmenter, model, policy, data channel and the receiver's UI all run for real, in two separate
headless Chrome instances. **It's a recording of an INCLUDE signer, not a person at a physical
webcam.**

Final run, dev server, 2026-10-25 (12/12 pass):

| Check | Result |
|---|---|
| Camera start-up; denied / no camera | live track via `getUserMedia`; both errors show their message and still allow joining |
| Known sign "Hello" | cards accept, accept, accept; **2 sent = 2 received**, unique ids, text "Hello"; phases hands-down → signing → recognising |
| Unseen sign "alive" | 4 × reject; **0** delivered |
| Unseen sign "curved" | 3 × suggest; **0** delivered without a tap |
| Unsure result | not sent within 2.5 s (longer than the countdown); after tapping a choice, the listener sees it marked "chosen" |
| Signs off / on | off: 0 loops, frames frozen, strip hidden; on: exactly 1 loop, 14.7 frames/s |
| Model 404 | plain error, the call and chat keep working, **Retry** recovers |
| Corrupt model file | "The sign model couldn't be loaded." + Retry |
| Leave | all camera/mic tracks `ended`, 0 loops, no frames processed afterwards |
| Backend restart mid-call | new signaling socket; the P2P data channel stayed up; 1 sent = 1 received |
| Listener drops out and rejoins | recognition paused, resumed without reloading models; 1 sent = 1 received |
| Layout 375×812 / 1440×900 | card below the video (video 512 / 588 px tall), controls visible, no overflow |

**Production build** (`next build && next start`): known sign, unsure-needs-tap, cleanup and
375×812 layout pass (4/4). The worker is bundled and works in production.

The "alive" result differs from the earlier offline fixture, where one 1080p clip of "alive" was
auto-sent as "I". These live runs use a different clip of the same word at 640×360, so the two
results are not comparable. The measured false-accept rate stays the offline 7/141.

### Performance (headless Chrome, simulated camera, this laptop: RTX 4060)

| Measure | Before (main thread) | After (worker), dev | After, production |
|---|---|---|---|
| Model (ONNX) load | 1.4 s | 1.4 s | 1.2 s |
| MediaPipe ready (incl. GPU warm-up) | 1.6 s, then a **6.75 s freeze** on the first frame | 11.4 s, **off the main thread** (warm-up 9.7 s) | 7.7 s (warm-up 6.4 s) |
| MediaPipe per frame | 36 ms on the main thread | 31–38 ms in the worker (pose 10–13, hands 13–16, face 9) | 35 ms in the worker |
| Frames processed | 14.9/s | 14.6–14.8/s (1–3 skipped) | 14.8/s |
| Decision (3 placements, ONNX) | 14 ms | 10–13 ms | 10 ms |
| Main-thread long tasks, start-up | 18, max 6,752 ms | 4, max 213 ms | 2, max 141 ms |
| Main-thread long tasks, 10 s steady | 11, max 79 ms | **0** | **0** |
| JS heap over 10 s | 46 → 54 MB | 18 → 23 MB | 15 → 16 MB |

The trade-off: recognition becomes ready later (the warm-up is now visible as "Loading sign
recognition…"), but the call never freezes.

### Other checks run 2026-10-25

| Check | Result |
|---|---|
| tsc, lint | clean |
| `test:signs` | 29 / 29 (+ segmenter rest rule, message validation, published-policy margin) |
| `check:features` | 9 / 9 |
| backend pytest | 62 |
| ml pytest | 11 |
| `check:ui` | 3 sizes, no overflow |
| `check:reconnect` | ✅ |
| build | ✅ |

### Still not verified

- **A person signing at a physical webcam:** lighting, distance, signing speed, other people. Everything
  above uses recordings of INCLUDE signers.
- **Real microphones and speakers, phones, calls across networks** (no TURN server).
- **The 7–11 s readiness time on other GPUs or integrated graphics:** unknown; the CPU fallback is
  untested in a call.
- `/try` and `/landmarks` still run MediaPipe on the page, so they show the start-up pause. Only
  calls use the worker.

## 2026-10-20 → 2026-10-21 — autonomous development phase

### 1. Unknown-sign rejection (without a fabricated `no_sign` class)

**Problem.** The published model (`20261013-002324-cnn`) had only the 39 vocabulary classes and a fixed
60% threshold. Evaluated on real clips of 47 *other* ISL words, it **auto-sent a word for 78 of 141
(55%)** of them (`python -m signsense_ml.evaluate --model runs/20261013-002324-cnn`). CLAUDE.md says
unknown gestures must not produce words.

**What was done.**
- **Real negatives, no fake labels.** INCLUDE has 263 words; 39 are our vocabulary. The other 223 words
  are genuine ISL signs the app doesn't support. `tools/include_download.py --oov-per-word 3` fetched
  669 clips (3 per word, spread across each word's recordings; 0 failed). They form one `unknown`
  class. No "no sign" or idle footage was invented.
- **Word-disjoint split.** Unknown words are split by word (`data.oov_split`: crc32 of the slug,
  60/20/20) into train 375 / val 153 / test 141 clips (125 / 51 / 47 words). The test words are never
  seen in training, so the test measures rejection of *new* signs, not memorised ones.
- **Landmarks without a person.** `frontend/scripts/extract-landmarks.mjs` drives the app's own
  `/import` page in headless Chrome (GPU), so training landmarks come from exactly the browser
  extractor used live. Parity with in-app extraction: hand/face median difference ~0.002, same
  prediction. 9–19 videos/min; all 1,377 videos extracted, 0 failures.
- **Calibration + decision policy** (`signsense_ml/policy.py`, twin `frontend/lib/signs/decision.ts`).
  - Temperature scaling is fitted on validation.
  - Each segment is classified at 3 window placements (start / centre / end).
  - **Accept** (auto-send after a 2 s cancellable countdown) only if the top class isn't `unknown`,
    its calibrated probability ≥ the accept threshold, and all 3 placements agree.
  - **Suggest** (signer must pick from the top 3; nothing is sent automatically) above the suggest
    threshold.
  - **Reject** ("No supported sign detected") otherwise.
  - Thresholds are chosen on validation only: unknown false-accept ≤ 2%, auto-send precision ≥ 97%.
- **Browser twin verified.** `npm run test:signs` runs real test clips (8 known, 4 unknown) through
  the published ONNX file in ONNX Runtime Web inside Node. It must reproduce Python's logits
  (|Δ| < 2e-3) and decisions: 20/20 pass.

**Result: model `20261021-001816-cnn-candidate`, published 2026-10-21.**
Measured with `python -m signsense_ml.evaluate --protocol official`. Reports are in `ml/reports/eval_*_official.json`.

| Official test split | Old model | New model |
|---|---|---|
| Known-sign top-1 accuracy (121 clips) | 98.3% (119) | 96.7% (117) |
| Known sign auto-sent as the **wrong** word | 2 | **0** |
| Known sign auto-sent correctly | 119 | 86 |
| Known sign → "which sign?" (right one in the top 3) | 0 | 31 |
| Known sign rejected | 0 | 4 |
| **Unknown sign auto-sent as a word** (141 clips, 47 unseen words) | **78 (55%)** | **7 (5.0%)** |
| Unknown sign shown as a choice / rejected | — | 21 / 113 |
| Latency per decision (1 CPU thread, 3 placements) | ~10 ms | ~10 ms |

**Publishing decision.** The new model loses 2 clips of top-1 accuracy (within the noise of a
121-clip test). In return it sends no wrong words for known signs, and it cuts unknown signs sent as
words from 55% to 5%. It also makes the signer confirm more often (26% of known signs).

The rule the pipeline now applies (`signsense_ml/pipeline.py`, tested in `ml/tests/test_pipeline.py`):
replace the published model only if it sends strictly fewer wrong words and loses ≤ 2 points of
accuracy. **This tolerance was set at the time of this decision, not in advance;** it is written down
so later models are judged by the same rule. The old model remains in `ml/runs/20261013-002324-cnn`
(republish: `python tools/publish_model.py runs/20261013-002324-cnn`).

**Known failure.** An unseen "alive" clip (`Adjectives__alive__MVI_9703`) is auto-sent as **"I"**:
both point at the chest. It's one of the 7 false accepts. Same root cause as the old I/you confusion:
2D landmarks lose pointing depth.

### 2. Honest generalisation estimate (session-held-out)

INCLUDE's official split shares recording sessions across train and test. Camera file numbers show
57 of 74 sessions spanning splits (`python -m signsense_ml.audit`). So the official numbers are
optimistic.

`--protocol session` holds out whole sessions: train 476 / val 122 / test 110 (all 39 signs in test).
Run `20261021-002954-cnn-session`, with results in `ml/reports/eval_session_heldout.json`:

| Measure | Value |
|---|---|
| Known-sign top-1 / top-3 accuracy | 86.4% / 94.5% |
| Known auto-sent correctly / wrongly | 16 / **0** (of 110) |
| Known offered as a choice containing the right sign | 80 |
| Known offered as a choice without the right sign | 1 |
| Known rejected | 13 |
| Unknown auto-sent / choice / rejected (141) | **0** / 26 / 115 |

**What to expect with new people:** the model rarely says something wrong, but it is far less sure.
Most signs will need a tap on the right choice.

**Still not signer-independent:** INCLUDE publishes no signer IDs, and the same people may appear in
several sessions. A real signer-independent number needs recordings from people outside INCLUDE
(`docs/ML_DATA_COLLECTION_GUIDE.md`).

### 3. Data checks (`python -m signsense_ml.audit` → `ml/reports/dataset_audit.json`)

- 1,377 videos (all 1920×1080): 708 known-sign clips, 669 unknown-sign clips.
- 0 corrupt, 0 duplicate files (MD5), 0 identical landmark sequences.
- 1 clip with too little hand tracking. It's flagged and excluded from training automatically.
- Smallest class: "sad" (8 clips).
- The sign-library clips are never taken from the test split, so the app never shows an evaluation clip.

### 4. One-command ML workflow

`ml/.venv/Scripts/python -m signsense_ml.pipeline`

- **Steps:** environment check (pinned versions in `ml/requirements.txt`) → optional `--download` →
  video dimensions → landmark extraction (headless, needs the dev servers) → audit → train → evaluate
  candidate and published model → compare → publish (unless `--no-publish`) → regenerate fixtures →
  ML + browser contract tests.
- **Resuming:** state is saved after every step, so a rerun resumes. A failed step stops with a
  plain explanation.

### 5. UI/UX redesign

**Design system** (`app/globals.css`):
- indigo brand colour plus success and warning tokens;
- 0.75 rem radius;
- a global `:focus-visible` ring and `prefers-reduced-motion` support;
- an `xl` button (48 px) for primary actions;
- shared `Logo` and `SiteHeader` (with a phone menu).

**Pages:**
- **Landing** (signed out): sign-clip hero, three ways to communicate, how a call works, join without
  an account, and an honest limitations note.
- **Dashboard** (signed in): new meeting, join by code, open meetings with copy-link/rejoin, recent calls.
- **Auth**: split layout.
- **Onboarding and the new `/settings`**: a shared picture-first `PreferencesForm`; settings also
  covers name change and a privacy note.
- **`/signs`**: search, category filters, and a "Recognised" badge on signs the model knows.
- **`/try`**: uses the same accept / suggest / reject decisions as calls, and states whether its
  thresholds came from validation.

**Call view (the reported mobile issue):**
- Six large controls fit at 375 px: mic, camera, signs, pictures, chat, leave.
- Captions, read-aloud and speech language moved into the panel header.
- The panel is a side column on ≥ 1024 px and a bottom sheet on smaller screens (closed by default).
- Unread badge on Chat; smaller self-view; "waiting" card with copy link and share.
- Host "End meeting" needs a second tap to confirm.
- A sign suggestion closes the sheet so it is never hidden.

**Captions are now opt-in.** Chrome sends microphone audio to Google for them, and the panel says so.

**Verified:**
- `npm run check:ui`: 12 screens × 375×812, 768×1024 and 1440×900 in headless Chrome, a real
  two-person call, chat delivered, no horizontal overflow. Screenshots are in `docs/screenshots/`.
- `npm run check:recognition`: in a live call, "Hello" was auto-sent at 98% and delivered; unknown
  "alive" was rejected; unknown "curved" became a "which sign?" choice.

### 6. Call reliability

- **Signaling reconnect.** The client reconnects with backoff (1 s → 10 s). After a drop, a
  temporary "room full" is retried. The server's welcome lists the other person and the newcomer
  re-offers.
  - Verified by `npm run check:reconnect`: the backend was restarted mid-call, the page opened a new
    signaling socket, and a chat message was delivered afterwards.
- **Server cleanup:**
  - a 70 s idle timeout frees the seat of a dead connection (clients ping every 25 s);
  - participant rows left open by a crash are closed at startup;
  - an active meeting with nobody in it is ended 24 h after creation (`MEETING_TTL_HOURS`).
- **End for everyone.** The host's end tells every connected peer (`meeting_ended`) and closes their
  sockets.
- **TURN.**
  - `ICE_SERVERS` (static) or, preferably, `TURN_URLS` + `TURN_SECRET`: per-peer coturn REST
    credentials that expire after `TURN_TTL_S`, so the secret never reaches browsers.
  - **No TURN server is configured.** Calls across different networks (mobile data, strict NAT) are
    unverified and will likely fail without one.

### 7. Security

- `ENABLE_DEV_TOOLS` now defaults to **off**. The local `backend/.env` turns it on for the recorder,
  import, `?fakevideo` and the extraction script.
- Rate limits:
  - signup: 5 per hour per IP;
  - meeting-code lookup: 60 per minute per IP (stops code enumeration);
  - WebSocket join: 30 per minute per IP;
  - login: unchanged.
- The guest display name moved out of the WebSocket URL (so it no longer lands in access logs) into
  the first message (`hello`).
- Security headers:
  - **Next.js:** nosniff, `X-Frame-Options: DENY`, `frame-ancestors 'none'`, a referrer policy, and
    `Permissions-Policy` (camera/mic for this site only, no geolocation).
  - **FastAPI:** nosniff, DENY, no-referrer, and `Cache-Control: no-store` on account endpoints.
- **Not done:** a full Content-Security-Policy. ONNX Runtime WASM, MediaPipe and the separate API
  origin need a policy tested on real devices.

### 8. Dependencies

- `ml/requirements.txt` pins the ML environment (torch 2.14.1+cu130 via the PyTorch index).
- `playwright-core` and `shadcn` are devDependencies; `tw-animate-css` was removed (unused).
- `npm audit --omit=dev`: 0 vulnerabilities.

### Checks run at the end of this phase (2026-10-21)

| Suite | Result |
|---|---|
| `backend: pytest` | 62 passed |
| `ml: pytest` | 11 passed |
| `frontend: tsc --noEmit`, `npm run lint` | clean |
| `npm run test:signs` | 20 / 20 |
| `npm run check:features` | 9 / 9 |
| `npm run build` | success (11 routes + 404) |
| `check:ui`, `check:reconnect`, `check:recognition` | pass |

**Not verifiable here:** a person signing at a real webcam, real-microphone captions, audible
text-to-speech, phones, calls across networks, Docker. See `docs/REAL_DEVICE_TEST_CHECKLIST.md`.
