# Live sign recognition in a call

How a sign made in front of the camera becomes a word on the other person's screen, as implemented
(traced from the code on 2026-10-25). Test results and measurements: `docs/DEVELOPMENT_LOG.md`
("Live recognition hardening").

## The path, step by step

| # | Step | Where | Notes |
|---|---|---|---|
| 1 | **Camera** | `lib/call/media.ts` `getLocalMedia()`, called once on pre-join | 640×480 @ 30 fps ideal, `contentHint = "motion"`. The **same** `MediaStream` goes to WebRTC and to recognition, so there is no second camera stream. Errors are mapped to plain messages (denied / not found / in use); the user can still join. |
| 2 | **Frame source** | `hooks/use-sign-recognition.ts` | A hidden `<video>` on the call's video track. A 15 fps timer (the model's rate) grabs an `ImageBitmap` and hands it to the worker. One frame in flight at a time; a frame that arrives while the worker is busy is skipped, never queued. Exactly one loop runs per enabled hook (counters in `window.__signRecognition`). |
| 3 | **Landmarks** | `lib/landmarks/landmark-worker.ts` (Web Worker) running `lib/landmarks/extractor.ts` | MediaPipe pose-lite, hands (×2) and face on the GPU (CPU fallback), **off the main thread**. Warmed up on a blank frame while loading, so MediaPipe's multi-second GPU set-up never freezes the call. Hands and face run on crops around the body and head (`OffscreenCanvas`). Output is one `LandmarkFrame` with normalised x, y, z. Nothing leaves the device. Calls and the `/try` practice page share this exact pipeline (same hook, worker, model and policy). Only the developer tools `/landmarks` and `/import` run the extractor on the page. |
| 4 | **Segmentation** | `lib/signs/segmenter.ts` | A sign starts when a hand rises above the rest line (relative to the shoulders) and ends 450 ms after the hands drop. It keeps 300 ms of pre-roll and 250 ms of post-roll, needs at least 350 ms, and cuts at 4 s. After a 4 s cut, hands must come down before the next sign (no repeats while held up). `clear()` drops a half-made sign when recognition pauses. |
| 5 | **Features** | `lib/signs/features.ts` (twin of `ml/signsense_ml/features.py`, parity-tested) | Shoulder-normalised hand, pose and face features at 15 fps; 3 window placements (start, centre, end) of 48 frames × 333 features. |
| 6 | **Model** | `lib/signs/classifier.ts` | ONNX Runtime Web (WASM, 1 thread), published model `20261021-001816-cnn-candidate`: 39 signs plus `unknown`. Loaded once per page. Feature version, dimension, window size and extractor version are checked against `config.json` at load. |
| 7 | **Decision** | `lib/signs/decision.ts` (twin of `ml/signsense_ml/policy.py`) | Temperature-calibrated probabilities averaged over the 3 placements. **Accept** only if the top class isn't `unknown`, its probability ≥ 0.95, it leads the runner-up by the margin (0 for this model; set on validation) and all 3 placements agree. **Suggest** at ≥ 0.42; otherwise **reject**. |
| 8 | **Signer's confirmation** | `components/call/sign-suggestion.tsx`, in a strip *below* the video | **Accept:** 2 s countdown, with Send now / Cancel. **Suggest:** the signer must tap one of 3 choices; nothing is sent automatically. **Reject:** "No supported sign detected", nothing sent, with an optional "Pick a sign myself". Each card can send at most once. A later "reject" never replaces a card that is counting down or waiting. |
| 9 | **Delivery** | `hooks/use-conversation.ts` → the WebRTC data channel `app` (`hooks/use-call.ts`) | `{type:"sign", id, gloss, text, confidence, at, via}` with `via` "auto" or "chosen". It's the same channel as chat and captions; no extra signaling. If the channel is closed, the signer sees "Not sent — not connected". |
| 10 | **Receiving** | `lib/call/messages.ts` `parseMessage()` → transcript, big caption overlay, read-aloud | Validated (types, lengths, 0 ≤ confidence ≤ 1, non-empty text, `via`). Duplicates are collapsed by id. The receiver never runs the model. A chosen sign is labelled "chosen by the signer" instead of showing a confidence. |

## Warm-up on the practice page

`/try` calls `prewarmRecognition()` 1.2 s after it opens: the classifier and one landmark worker load in the
background (MediaPipe's first GPU set-up takes seconds). When the camera turns on, `useSignRecognition` takes that
worker instead of creating its own, so there is still one pipeline; `releasePrewarmed()` closes it if the page is
left first. Calls do not warm up (the pre-join screen could, later).

## Under heavy load

If the computer is busy, a frame is skipped while the worker is still on the previous one; frames are
never queued. Features are resampled by **timestamp** onto a fixed 15 fps grid (`resampleIndices`), so
skipped frames don't distort a sign's speed. They only make the motion coarser, which lowers
confidence. The effect is more "please confirm" prompts, never faster or riskier sends. Measured on
this laptop: 35–80 ms per frame in the worker depending on load (see `docs/DEVELOPMENT_LOG.md`).

## Personal signs ("My signs")

After the decision (step 7), if the result is not an automatic **accept** and the model returned an
embedding, the embedding is compared (cosine) with the user's own recorded signs
(`lib/signs/personal.ts`, threshold from the model config). A match turns the result into a
**suggestion** headed "Is this your sign?". It is sent only when the signer taps it, and the message
carries `via: "chosen"`. The user's takes are stored as landmarks only, and are re-embedded by the
current model when loaded, so they keep working after model updates. Evidence and limits: see
`docs/DEVELOPMENT_LOG.md` (2026-10-27).

## Signer feedback (`components/call/recognition-bar.tsx`)

No camera / camera off → loading → **paused** (the other person isn't connected) → step into view →
hands not seen → ready (hands down) → watching your sign → recognising → card → "Sent “Hello”" or
"Not sent — not connected". On an error, the message plus a **Retry** button.

## Safety rules enforced in code

- An unsure result (**suggest**) or a rejected one never auto-sends. Only an explicit tap sends it,
  and the receiver sees it marked as chosen.
- The signer is never shown a confidence percentage. A calibrated score isn't a probability of being
  right.
- **One send per sign:** the segmenter emits one segment per hands-up/hands-down, and each card
  sends at most once.
- **Pausing (call reconnecting) or stopping** clears any half-made sign. Results computed while
  paused are dropped. Models stay loaded across reconnects and are only reloaded on Retry.
- **Errors never end the call:** a model-load error, 30 frame errors in a row, or a failed
  classification affects only recognition. One bad frame is skipped, not fatal.
- **Cleanup:** leaving or turning Signs off stops the loop, closes MediaPipe and releases the hidden
  video. Leaving stops the camera and microphone tracks.

## What was only tested with simulated input

Every automated test uses either a recorded INCLUDE clip fed through Chrome's fake camera device
(the real `getUserMedia` path) or a test pattern. **No person signing at a physical webcam has been
tested.**

`npm run check:recognition` (`frontend/scripts/live-call-e2e.mjs`) drives two headless Chrome instances
through a real call and checks:
1. camera start-up, plus the denied and no-camera messages;
2. landmarks, buffering and inference on a known sign, with delivery exactly once;
3. two unseen out-of-vocabulary signs;
4. an unsure result needing a tap;
5. turning Signs off and on;
6. a failed and a corrupt model;
7. cleanup on leave;
8. signaling and data-channel interruptions;
9. layout at 375×812 and 1440×900.

Results and timings are in `docs/DEVELOPMENT_LOG.md`.
