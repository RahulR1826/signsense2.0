# Live 3D Saathi in calls

Saathi, SignSense's signing guide, as a **rigged 3D character rendered live in the browser**: received signs and
received text are performed by Saathi on the recipient's screen, word by word, with replay and speed control.
Captions and read-aloud stay as they were.

## Status (2026-10-29)

| Level | Status | Evidence |
|---|---|---|
| Rendering integration (three.js + React Three Fiber) | ✅ done | `components/saathi/saathi-live.tsx`, screenshots |
| Rigged character available | ✅ built (see "Rig" — rigid parts on a skeleton, no skin deformation) | GLB has 1 skeleton, 56 animated bones |
| Animations imported and playable | ✅ 39 clips, one per dictionary sign | `scripts/saathi-rig.test.mjs`, dev page |
| Animations mapped to supported signs | ✅ all 39 recogniser labels → clips (validated by test) | `lib/signs/saathi-rig.ts`, tests |
| Animations validated for sign correctness | ⚠️ **proxy only**: the app's own recogniser reads 35/39 rendered clips as the intended sign first (17 auto-accepted, 0 wrong). **No Deaf signer or ISL expert has reviewed them.** | `ml/reports/saathi_rig_eval.json` |
| Live call integration tested | 🔵 automated two-browser calls with a recorded clip as the camera | `npm run check:saathi-call` |
| Physical-device / real-user testing | ❌ not done | — |

## How it works

```
Sender webcam → MediaPipe (worker) → sign model + policy (95 % + whole-clip agreement, unsure → signer picks)
  → data channel message {type: "sign", id, gloss: [label], text, confidence, via}         (unchanged protocol)
  → recipient: parseMessage() validates → transcript + read-aloud (as before)
             → tokensForReceivedSign(gloss): only dictionary ids become signs (personal / unknown → text)
             → stepsFor(): sign id → clip in saathi.glb, or a text step ("no sign" / "no animation")
             → SaathiStage: plays the clips locally in three.js (no video is sent)
```
- The recipient never runs the recognition model; only the semantic message travels.
- Unsure signs still need the signer's tap before anything is sent (`sign-suggestion.tsx`, unchanged).
- Each message is performed once (tracked by message id); messages are already de-duplicated by id on receipt.
- Received **signs** are shown to everyone; received **typed/spoken text** is shown as signs to people who sign
  (preference "I sign" / "Both"), as before.

### Text → signs
`textToGloss()` (multi-word phrases first, synonyms, never fingerspelling) → steps. Signs with a clip play in
order with 0.25 s cross-fades; a word without a sign is shown as a large text card ("No sign in the dictionary
yet") and struck through in the word list, never replaced by another sign. The stage says "Word by word, not full
ISL grammar" for sequences. Replay and 0.5× / 0.75× / 1× speed are always available.

## Rig (`ml/blender/saathi_rig.py`)
- **Format / location:** `sign-library/saathi-rig/saathi.glb` (glTF 2.0 binary, ~3.6 MB, Y-up, metres) and
  `clips.json` (clip list with frame counts, fps and source recording); served from `public/sign-library/saathi-rig/`.
- **Skeleton:** root, neck, head; per side clavicle, upper arm, elbow, forearm, hand, 5 metacarpals and 3 bones
  per finger (thumb included); brow, eye and mouth bones. Saathi's parts (kurta, head, hair/braid, eyes, lips,
  arms, palms, finger segments) are **rigidly attached** to bones — no skin weights, so nothing deforms like skin.
- **Clips:** made automatically from the recorded landmark motion (`sign-library/anim3d/<id>.json`, the same
  INCLUDE clip as the dictionary):
  - upper arm and forearm are placed at the tracked shoulder/elbow and **stretch lengthwise** to the next joint,
    so the wrist lands where the signer's wrist was (placement error 0 cm in Blender; implausible lengths from
    tracking glitches capped at 1.3× rest length);
  - the hand aims at the middle knuckle and turns about its axis towards the index knuckle (**palm
    orientation**); every finger bone aims at the next tracked finger joint (**independent fingers**);
  - head turn from forehead/chin/eye points (damped 60 %); brows, blinks and mouth opening from face landmarks;
  - baked to keyframes (one action per sign, named by sign id) and exported with the glTF exporter.
- **Measured readability (proxy, offline):** each clip rendered at the source video's framing → the app's MediaPipe
  extractor → published model and policy.

| Version | Right sign first | Auto-accepted, right | Wrong word auto-accepted | Rejected | Hands found |
|---|---|---|---|---|---|
| Rig, bones aimed only (first build) | 30/39 | 13 | 0 | 9 | 67% |
| **Rig, joints placed + stretch (current)** | **35/39** | **17** | **0** | 8 | 61% |
| Pre-rendered 3D video (for comparison) | 35/39 | 14 | 0 | 8 | 55% |
| Source recording landmarks (upper bound) | 39/39 | 34 | 0 | 0 | — |

  Weakest (rejected or another sign first): how are you, mother, friend, family, i, healthy, doctor, good, school,
  telephone, yesterday, morning (see `ml/reports/saathi_rig_eval.json` per sign). This shows whether the
  *recogniser* can read Saathi — not whether Deaf viewers find the signs correct and natural.

## Fallbacks (the call never depends on Saathi)
| Situation | What happens |
|---|---|
| Viewer chose 2D | 2D drawing player |
| No WebGL | recorded 3D Saathi video / 2D player; note "3D isn't available in this browser" |
| `saathi.glb` or `clips.json` fails to load | same fallback; note shown; load error counted |
| Rendering throws (lost context etc.) | error boundary → fallback player |
| Sign id without a clip | text step "No Saathi animation for this sign yet" |
| Word not in the dictionary | text step "No sign in the dictionary yet" |

## Performance
- three.js is code-split: it is downloaded only when Saathi first has something to show in a call.
- `frameloop="demand"`: the canvas renders only while a clip or fade is running (no work between signs).
- One canvas at a time (desktop column *or* phone stage), `powerPreference: "low-power"`, DPR ≤ 1.75.
- The model is loaded once per page and cloned per stage; leaving the call disposes the renderer (checked).
- Saathi runs on the recipient; sign recognition on the sender. On one device that both signs and receives, both
  share the GPU — not yet measured on low-end phones.
- Verified in the production build: none of the three.js chunks is in the call page's initial JavaScript.
- A/B in the two-browser test on one laptop (same machine state, `enable-disable` check): signer recognition ran at
  6.0–6.7 frames/s with the listener showing the live 3D Saathi, 6.7–7.3 with the rig blocked and 6.0–6.7 with no
  Saathi at all — no measurable cost. (The day before, the same check ran at 14–15 frames/s; the whole machine was
  slower during this run — MediaPipe GPU warm-up 20 s vs 6 s — so absolute numbers are not comparable across days.)

## Adding a sign
1. Add the word to the vocabulary/dictionary (`ml/vocabulary.json`, `ml/tools/build_sign_library.py`).
2. `ml/tools/build_sign_animations.py` (motion incl. `anim3d`), then
   `blender -b --factory-startup -P ml/blender/saathi_rig.py` (all clips, ~15 s) and `npm run setup:runtime`.
3. `npm run test:signs` (clip ↔ registry ↔ recogniser labels) and `node scripts/saathi-eval.mjs --rig --only <id>`.
4. Have a Deaf signer review the clip before calling it correct.

## Tests
- `scripts/saathi-rig.test.mjs` (in `npm run test:signs`): GLB clip discovery from the file, every clip animates
  all finger/wrist/elbow/shoulder/head bones, label ↔ clip ↔ dictionary mapping, received-sign validation, text →
  steps with honest text fallbacks.
- `npm run check:saathi-call` (`scripts/saathi-call-e2e.mjs`), real two-browser calls: received sign performed by
  the 3D Saathi without recognition on the recipient, once per message; typed text sequence + unsupported word +
  replay + 0.5× speed; WebGL unavailable; model missing; renderer released on leave; phone/desktop layout.
- `node scripts/saathi-eval.mjs --rig`: recogniser readability of every clip (above).

## Limitations
- Signs are copied from **one INCLUDE recording each**; no sign has been checked by a Deaf signer.
- Rigid parts: no skin deformation, simplified face (brows, blink, mouth opening); no mouthing of words.
- Arms stretch to reach the recorded joints (lengths can differ by up to 30% from rest).
- Word-by-word signs, not ISL grammar; no transitions designed between signs beyond cross-fades through rest.
- Not tested on physical phones or with real users.
