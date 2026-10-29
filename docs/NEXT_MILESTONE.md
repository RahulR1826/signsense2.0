# Next milestone: Learn ISL with Saathi (plan) + sign search and vocabulary expansion (proposals)

Status: **planned, not built.** Written 2026-10-28 from the code as it is today. Nothing here is a claim about
results; every feature below must be measured before it is presented as working.

## 1. Learn ISL with Saathi

**Who:** hearing family members and other beginners. **Promise (honest):** "Watch Saathi, copy the sign, and the
recogniser tells you what it saw." Not "we grade your signing": the model was trained on INCLUDE signers and has
not been measured on new people at webcams, so feedback is phrased as what the recogniser understood.

### Flow (one lesson = 3–5 signs from one category)
1. **Watch** — Saathi signs the word (3D video or 2D, the viewer's choice), loop / slow-motion (0.5×) / replay.
   Slow motion: `playbackRate` on the 3D video; the 2D player already steps by time, so a speed factor is trivial.
2. **Try** — the camera turns on (same pre-warmed pipeline as `/try`); the learner signs once, hands down.
3. **Feedback** — from the existing decision policy, never a made-up score:
   - `accept` with the target → "Saathi's recogniser understood **Hello**." ✓
   - `suggest` with the target first → "Close — it thought this was probably Hello." (partial)
   - another sign / `reject` → "It didn't recognise Hello. Watch again: …" plus one visual hint (see below).
   - Unknown gestures still never become words (the `unknown` class and 95% auto-accept stay unchanged).
4. **Repeat or next.** A sign counts as *practised* after 2 understood attempts (not "mastered").

**Visual hints without claims:** compare the learner's segment with Saathi's motion on things we can measure
reliably: which hand(s) moved, where (face / chest / side, from wrist height vs shoulders), and whether the hand
moved or stayed. E.g. "Saathi uses one hand near the forehead; you used both hands at chest height." These come
from landmarks the app already extracts (`LandmarkFrame`), not from the classifier.

### Reuse (no second pipeline)
| Need | Existing piece |
|---|---|
| Vocabulary, categories, labels | `sign-library/library.json`, `ml/vocabulary.json` (39 signs) |
| Demonstration | `components/saathi/saathi-sign.tsx` (3D video / 2D drawing), `sign-library/anim*/` motions |
| Camera + landmarks | `useSignRecognition` (Web Worker extractor, segmenter) + `prewarmRecognition()` |
| Recognition + safety | `SignClassifier.decide` + `lib/signs/decision.ts` policy (unchanged thresholds) |
| Hints | landmark frames of the segment (`SignResult.segment`) vs `anim3d` motion of the sign |
| Accounts | existing auth; lessons work signed-out with progress in `localStorage`, synced when signed in |
| Progress | new table `lesson_progress(user_id, sign_id, attempts, understood, last_at)` — counts only, **no landmarks or video stored** |
| UI | design tokens, `Reveal`, toasts, `SaathiGreeting`, `WatchSaathi` (the `/try` picker is the seed of this) |

### Routes and components
- `/learn` (lesson list by category, progress rings), `/learn/[category]` (lesson player).
- `components/learn/lesson-player.tsx` (watch → try → feedback state machine), `feedback-card.tsx`, `hint.ts`.
- Backend: `api/learn.py` (GET/PUT progress), Alembic migration, tests (owner-only, deleted with the account).

### Done when (measured)
- Lesson flow works end to end with the fake camera (Saathi's own rendered clips and INCLUDE test clips):
  understood / close / not understood paths all shown correctly, nothing stored but counts.
- A small real-person check (3–5 beginners): how often the recogniser understands a beginner's attempt per sign.
  Signs the recogniser rarely understands from beginners are marked "practice only" (no ✓ feedback) rather than
  frustrating learners. Report the numbers; do not claim teaching effectiveness without a study.

## 2. Proposal: search the dictionary by signing

Sign at the camera on `/signs` → "Did you mean: Doctor / Hospital / …" with Saathi's version of each.
- **How:** one `SignResult` from the existing pipeline; show `ranked` top-3 (calibrated probabilities) as
  candidates — a *search*, so suggestions are fine even below the auto-accept threshold, but `reject` shows
  "Not in the dictionary yet" and never a forced guess. Personal signs (`matchPersonal`) appear as "Your sign".
- **Cost:** small (UI + reuse); camera opt-in; prewarm on opening the search panel.
- **Measure:** top-3 hit rate on INCLUDE test clips through the camera path (`check:saathi`-style script).

## 3. Proposal: vocabulary expansion (39 → ~100 → 263 INCLUDE words)

- **Data:** INCLUDE has 263 words (CC BY 4.0, already licensed for this project). The pipeline already downloads,
  extracts landmarks, audits, trains, evaluates and gates publishing (`python -m signsense_ml.pipeline`).
- **Order:** add words in batches of ~20 chosen for family/health use (e.g. water, food, pain, help, tomorrow-like
  time words), re-run the pipeline, and publish only if the gate passes (fewer wrong words, ≤ 2 points accuracy
  loss) **and** unknown false acceptance does not rise. Words promoted from the OOV pool leave the `unknown`
  class (they must be removed from OOV training, or the model learns to reject them).
- **Generation side:** each new word gets its Saathi motion and 3D video automatically
  (`build_sign_library.py` → `build_sign_animations.py` → `render_saathi3d.py`, ~25 s per sign on the RTX 4060),
  then `eval:saathi` checks Saathi's readability for it.
- **Risks:** more classes → lower per-class accuracy and more confusable pairs; INCLUDE has few signers per word
  (no signer IDs), so session-held-out evaluation remains the honest number.
- **Measure:** official + session protocols, per-class recall, confusion pairs, auto-send rate, FAR on held-out
  unknown words, model size/latency (must stay ~10 ms per decision in the browser).

## Order
1. Learn ISL with Saathi (biggest product value; reuses everything).
2. Sign search (small, high delight).
3. Vocabulary expansion in batches (feeds both).
