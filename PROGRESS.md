# Progress

Read this first at the start of every session. Update it at the end of every session.

## Milestones

- [x] **M0 Setup** — git, monorepo, Next.js + FastAPI skeletons, docs. *Done when frontend + backend run and the backend reaches Postgres.*

- [x] **M1 Landmark viewer + recorder** — live MediaPipe landmarks; record labelled landmark sequences per sign/signer; export. → user starts collecting data.

- [x] **M2 Auth + preferences + meetings** — signup/login (JWT httpOnly cookie), communication preferences, create/join by meeting code.

- [x] **M3 Video call** — WebSocket signaling, WebRTC 1:1, camera/mic toggles, leave, STUN.

- [x] **M4 Chat + captions + speech** — DataChannel messages, captions panel, speech-to-text, text-to-speech.

- [x] **M5 Training pipeline** — normalisation, augmentation, GRU baseline, signer-independent eval, confusion matrix, MLflow, ONNX export.

- [x] **M6 Live recognition in call** — ONNX Runtime Web (main thread), smoothing, threshold, no-sign class, sender confirm, receiver TTS. ✅ = full prototype.

- [x] **M7 Text/speech → sign** — sign-library clips, gloss mapping, picture quick-phrase board.

- [x] **M8 Experiments + demo hardening** — model comparison & ablations, latency numbers, local HTTPS for phone demo, **add docker-compose.yml** (reminder requested by user), TURN.

## Current state (2026-10-29) — live 3D Saathi in calls

- Rigged Saathi GLB (`sign-library/saathi-rig/`, 39 clips) built by `ml/blender/saathi_rig.py`; rendered live in calls (three.js + R3F, code-split). Received signs and text are performed by Saathi; replay + speed; honest text fallbacks; WebGL/model fallbacks. Docs: `docs/SAATHI_3D_LIVE.md`; report R7.
- Proxy readability 35/39 (17 auto, 0 wrong). Not reviewed by Deaf signers; no real-device tests.
- Rebuild after motion changes: `blender -b --factory-startup -P ml/blender/saathi_rig.py` then `npm run setup:runtime`; check with `npm run test:signs`, `node scripts/saathi-eval.mjs --rig`, `npm run check:saathi-call`.
- Pending: Learn ISL with Saathi (`docs/NEXT_MILESTONE.md`), real users, TURN, deployment, `next` security advisory upgrade, no git commit yet.

## Earlier state (2026-10-28, later) — Milestone 1 done

- UI/UX pass across all pages (call header/player on phones, Saathi on landing/dashboard/onboarding/practice/settings); details `PROJECT_PROGRESS_REPORT.md` R6.
- Retrain with all 931 OOV clips **ran and was not promoted** (worse on the session split; one seed auto-sent wrong signs). Published model unchanged. `ml/tools/compare_retrain.py`, `reports/retrain_comparison.json`.
- Auto-send floor 0.95 enforced in `policy.py` (`MIN_ACCEPT`) and checked on the published config.
- `/try` warms the models in the background (`prewarmRecognition`): ~3 s camera-on → first result after a few seconds on the page.
- **Next milestone:** `docs/NEXT_MILESTONE.md` — Learn ISL with Saathi, then sign search, then vocabulary expansion. Still open: physical-webcam tests with real people, TURN, deployment, report placeholders, no git commit yet.

## Earlier state (2026-10-28)

**3D Saathi done** and the website default (3D / 2D toggle; 2D is the fallback). Details: `docs/DEVELOPMENT_LOG.md` (2026-10-28).
- Blender 4.5.15 LTS portable at `D:	oolslender-4.5.15-windows-x64`. Pipeline: `ml/tools/build_sign_animations.py` (anim + anim3d) → `ml/tools/render_saathi3d.py` (Blender `ml/blender/saathi3d.py`, EEVEE on the RTX 4060, ~15 min for 39 signs) → `sign-library/saathi3d/` → `npm run setup:runtime`.
- Model reads 3D Saathi: offline 35/39 right first (14 auto, 0 wrong); camera pass 2 28/39 (12 auto, 0 wrong). 2D: 33 / 27. Source video: 39 / 37.
- **Adding a sign later:** add it to the vocabulary + dictionary (build_sign_library.py), then run build_sign_animations.py, render_saathi3d.py, setup:runtime, and `eval:saathi` (2D) / `eval:saathi --frames3d` (3D) to check readability.
- Open: user study of 2D vs 3D vs video; report placeholders (name, register no., project no.); real-device tests; TURN; Docker run; decide about `sign-library/videos|posters` before a public push; no commit yet.

## Earlier state (2026-10-27, later)

**2D Saathi done** — a drawn signer replaces every real INCLUDE signer on the website (hero, demo, dictionary, call text→sign, report screenshots); site colours now deep blue `#1d4ed8` + orange `#f97316`. Details and numbers: `docs/DEVELOPMENT_LOG.md` (2026-10-27 later).
- Model reads Saathi: offline 33/39 right first (16 auto-accepted, 0 wrong); camera pass 2 27/39 (13 auto, 0 wrong) vs source video 37/39.
- Checks: journeys 12/12 (incl. "no real signers' media"), live call 12/12, test:signs 38, ml 15, backend 77, build OK. Report rebuilt (56 pages).
- **Next: 3D Saathi** (user reminded 2026-10-27). Plan: install Blender (approved), rig a 3D Saathi in the same look, drive it with the same `sign-library/anim` motions (add depth from MediaPipe z), render on the RTX 4060 to video, measure with `eval:saathi`-style + `check:saathi`, compare with 2D.
- `sign-library/videos|posters` still exist in the repo (CC BY 4.0, dev only, not served). Decide before any public push whether to keep them.

## Earlier state (2026-10-27)

**"My signs" added** (record your own signs before a call; offered as "Is this your sign?" in calls and on /try, never auto-sent). Details: `docs/DEVELOPMENT_LOG.md` (2026-10-27).
- Study: embedding matching beats DTW (91.3% vs 57.3% forced choice; 52% matched at 3.3% false matches, cross-signer). Same-person accuracy unmeasured.
- Published ONNX re-exported with an `embedding` output (same weights; logits identical). Backend: personal_signs tables (migration b7c1e2d4f901, applied to the dev DB), owner-only API, 11 tests.
- **Mascot decisions (user, 2026-10-27):** name **Saathi**, a **human** character. Order: My signs (done), then the **2D mascot** (replace every real-person clip/poster on the site, dictionary, calls and report screenshots), then the **3D mascot** (Blender install approved for that phase; render on the RTX 4060; validate each sign by running the recogniser on the rendered mascot).
- Real INCLUDE signers must not appear on the website (consent); the clips are kept only for training until the mascot replaces them.
- Pending: the retrain experiment with the extra OOV clips (931 train clips now); real-device tests.

## Earlier state (2026-10-25, later)

**Website transformed (design system, motion, every page redesigned), /try on the call's worker pipeline, account deletion, production safety checks, deployment config reviewed.** Details: `PROJECT_PROGRESS_REPORT.md` R5, `docs/DEVELOPMENT_LOG.md`, `docs/DESIGN.md`, `docs/DEPLOYMENT.md`.
- All checks pass: tsc/lint clean, test:signs 29/29, check:features 9/9, backend 66, ml 11, migrations 0 diff, check:journeys 11/11, check:ui 4 sizes no overflow, check:reconnect, check:recognition 12/12, build.
- Unknown-sign false accepts: rejection-gate study found no val-supported improvement (policy unchanged, 7/141). An extra-OOV-data retrain was started (train words only, test set unchanged); see the dev log for its result.
- Not verified: real webcams/people, Docker (not installed), cross-network calls (no TURN), Deaf user review. No git commit (awaiting approval).

## Earlier state (2026-10-25)

**Live recognition in calls hardened and verified end to end with a SIMULATED camera.** Not yet tested with a person at a real webcam. Details: `docs/LIVE_RECOGNITION.md`, `docs/DEVELOPMENT_LOG.md` (2026-10-25).
- MediaPipe runs in a Web Worker during calls (no UI freeze; 0 main-thread long tasks while recognising). The model stays loaded across reconnects; status strip below the video; the card never covers video; one send per card; `via: auto|chosen` on sign messages.
- `npm run check:recognition` = `scripts/live-call-e2e.mjs`: 12/12 (recorded INCLUDE test clips via Chrome's fake camera device, two browsers). The production build was checked too (4/4).
- Checks: tsc, lint clean; test:signs 29/29; check:features 9/9; backend 62; ml 11; check:ui and check:reconnect pass; build OK.
- Next: a real-webcam session (`docs/REAL_DEVICE_TEST_CHECKLIST.md`); move `/try` to the worker; measure readiness time on other machines; TURN.

## Earlier state (2026-10-21)

**M0-M8 done. Autonomous-development phase done: unknown-sign rejection, new model, UI/UX redesign, reliability + security. No commit yet (user hasn't said yes).** Details: `docs/DEVELOPMENT_LOG.md`.

- **Model:** published `20261021-001816-cnn-candidate` (39 signs + `unknown`, trained on 375 real out-of-vocabulary INCLUDE clips; calibrated; policy T=0.89, accept>=0.95, suggest>=0.42). Official test (121 known / 141 unknown clips from 47 unseen words): known acc 96.7%, wrong words auto-sent 0/121, unknown auto-sent 7/141 (5.0%) vs old model 98.3% / 2/121 / 78/141 (55%). Honest session-held-out run: known acc 86.4%, 16/110 auto-sent (all correct), 80 more offered as a choice incl. the right sign, 0 wrong words, 0/141 unknown sent. Not signer-independent (INCLUDE has no signer IDs).
- **One command:** `ml/.venv/Scripts/python -m signsense_ml.pipeline` (env -> optional download -> dims -> landmarks -> audit -> train -> evaluate -> compare -> publish -> contract tests; resumable, `ml/reports/pipeline_state.json`).
- **Checks (all passing 2026-10-21):** backend 62, ml 11, frontend tsc + lint + test:signs 20/20 + check:features 9/9 + build; browser checks `npm run check:ui` (12 screens x 3 sizes, no overflow), `check:reconnect` (backend restart mid-call -> recovers), `check:recognition` (known -> sent, unknown -> rejected / asks).
- **UI:** new design system, landing + dashboard, auth, onboarding, settings, /signs, /try, pre-join, call view (mobile 375x812 fixed). Screenshots: `docs/screenshots/`.
- **Backend:** rename, list my meetings, host "end for everyone", WS hello (name out of URL), idle timeout, reconnect-safe, meeting expiry (24 h), startup participant cleanup, TURN REST credentials (`TURN_URLS`/`TURN_SECRET`), rate limits (signup, lookup, WS join), security headers, `ENABLE_DEV_TOOLS` default off (on in local .env).
- **Needs the user / external:** real-webcam + real-mic + phone tests (`docs/REAL_DEVICE_TEST_CHECKLIST.md`), a TURN server for calls across networks, Docker test, Deaf user review, git commit approval.
- **Next ideas:** I vs you confusion (depth/pointing features), more vocabulary, CSP header, signer-independent evaluation once own recordings exist (`docs/ML_DATA_COLLECTION_GUIDE.md`).

## Earlier state (2026-10-20)

**M0-M7 done; M8 mostly done (2026-10-20).**
- M8 done: production build passes; `ENABLE_DEV_TOOLS` (dataset/import endpoints off in prod); runtime API URL (works from phones on LAN); `CORS_ORIGIN_REGEX` + WebSocket origin check share one rule (`origin_allowed`); self-signed HTTPS for phone demo (`scripts/make_dev_cert.py`, `npm run dev:https`, launch configs `frontend-https`/`backend-https`) — verified with curl on the LAN IP (browser pane rejects self-signed certs); Dockerfiles + docker-compose.yml (UNTESTED: no Docker on this machine); README rewritten; ablation experiments (`ml/tools/run_experiments.py` -> `docs/experiments.md`, running).
- Git: published model (`frontend/public/models/signs`) and `sign-library/` are tracked; landmarks (143 MB), videos, runs, certs, .env are ignored. Pre-commit secret scan clean. Still NO commit — user hasn't said yes.
- Open items: TURN server for real networks (config via `ICE_SERVERS`), `no_sign` training data + personal test set (needs user), real-device tests (webcam, mic captions, TTS audio, phone), Deaf user review, 'I' vs 'you' confusion (add depth/pointing features).
- M7: sign library (39 clips, 2.6 MB), `lib/signs/gloss.ts` (6 tests), `components/signs/sign-player.tsx`, picture board, `/signs` dictionary. Verified in a call: typed text plays as signs for the signer; picture tap arrives and is read aloud.
- M4: data-channel chat, live speech captions (Web Speech API), read-aloud (speechSynthesis), conversation panel + big caption overlay. Chat verified both ways in the pane; speech parts need a real mic (user test).
- M6: `hooks/use-sign-recognition.ts` + `components/call/sign-suggestion.tsx` in the call view ("Signs" toggle, status chip). Verified end to end with `?fakevideo=` INCLUDE test clips: 12/12 correct, received + shown on the other side.
- Fixed in passing: Join enabled before the camera was ready (joined without video).
- Still needs the user: real-webcam test of /try and of a call (two windows), captions with a real mic, ~10 min no_sign recording + personal test set (honest real-world accuracy).

## Earlier state (2026-10-13)

**M2 + M3 done. M5 pipeline built; import nearly finished, then full training.**

M3 (video call): `/ws/meetings/{code}` signaling (7 tests; 49 backend tests total), `hooks/use-call.ts` (WebRTC 1:1, data channel "app", ICE restart on failure), pre-join (preview, mic/cam toggles, guest name, sign/speak choice), call view (remote never cropped, self-view PiP, mic/cam/leave), leave/rejoin. Verified in the browser pane with two tabs on the dev test camera (`?fake=1`): connect, video both ways 640x480, leave -> other side waits, rejoin. Real webcam two-window test is for the user.

M2 (accounts + meetings):
- Backend: models users / communication_preferences / meetings / participants (Alembic `96fae9592cf3`, round-trip tested). Endpoints: `POST /api/auth/{signup,login,logout}`, `GET /api/auth/me`, `PUT /api/users/me/preferences` (ISL only), `POST /api/meetings`, `GET /api/meetings/{code}` (public, accepts sloppy codes), `POST /api/meetings/{code}/end` (host only). argon2 hashes, JWT in httpOnly SameSite=Lax cookie (`JWT_SECRET` in backend/.env), login rate limit 10/5 min, equal-time unknown-email login. 42 backend tests pass (DB tests use database `signsense_test`).
- Frontend: /signup, /login, /onboarding (picture tiles: signer / non-signer / both + ISL toggles), home with create meeting (code + copy + join) and join-by-code (guests allowed), /m/[code] placeholder for M3. Verified end to end in the browser pane with dev account from `backend/seed/dev_users.json`.
- TODO: dataset/import endpoints are still unauthenticated dev tools (don't change until the import is done).

M5 (training) — first full results (2026-10-13):
- Import complete: 708 clips, 39 signs, 42,928 frames; face/pose 100%, hands 71% of frames.
- INCLUDE official split: train 533 / val 54 / test 121. GRU (1.26M params) and CNN (0.88M) both **98.3% test accuracy** (119/121), top-3 100%, macro-F1 0.986. Only errors: "I" predicted as "you" (pointing at self vs camera — depth lost in 2D features; candidate fix: add hand z / pointing direction).
- Published **CNN** run `20261013-002324-cnn` (3.5 MB ONNX, ~1.1 ms per prediction on 1 CPU thread) to `frontend/public/models/signs/`.
- CAVEAT: INCLUDE's split is not documented as signer-independent (signer IDs unpublished; overlap likely). Real-world accuracy must be measured on the user's own recordings (`own` split) — not done yet.
- Fixed: onnxruntime-web broke server rendering of /try (now imported lazily in the browser). All pages SSR 200.

Earlier M5 notes:
- Import running in the pane tab `/import`: ~600/663 of this batch; afterwards rerun once for the ~45 videos that arrived late.
- `ml/signsense_ml/` pipeline ready (see decisions); smoke test on partial data OK.
- Browser side ready: `lib/signs/features.ts` (parity-checked, `npm run check:features`), `lib/signs/segmenter.ts` (`npm run test:signs`, 5 tests), `lib/signs/classifier.ts` (onnxruntime-web WASM from public/ort), `/try` page. Publish a model with `ml/tools/publish_model.py`.
- Next: finish import -> train GRU + CNN -> publish best -> user tests /try on webcam, records ~10 min no_sign + small personal test set -> threshold tuning -> M3 video call.

Dev notes: first visit to a page in `next dev` compiles it (can take ~10 s) — not a bug.
- No git commit yet (user hasn't answered).

## Notes

- Postgres 17.11 installed at `D:\postgresql` (service `postgresql-x64-17`), database `signsense`. Password only in `backend/.env` (set via `scripts/set-db-password.ps1`).

- Machine: MSI laptop, Windows 11, Node 24, Python 3.11.9, NVIDIA GPU. No Docker.
