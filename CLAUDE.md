# SignSense 2.0

Web video-call platform with Indian Sign Language (ISL) assistance. Personal project to showcase in an ML class; built by one developer with Claude. Full spec: `docs/original-spec.md`. Deviations from it: `docs/decisions.md` (these win over the spec).

**Start every session by reading `PROGRESS.md`; update it before the session ends.**

## Three independent systems (keep them decoupled)
1. **Real-time communication** — WebRTC (media + DataChannel) with WebSocket signaling via FastAPI.
2. **Sign intelligence** — browser MediaPipe landmarks (Web Worker in calls) → ONNX model (main thread, ~10 ms per decision) → gloss → text. Workflow: `docs/LIVE_RECOGNITION.md`. Must work outside the call too.
3. **Sign generation** — text/speech → gloss → Saathi (`components/saathi/*`): in calls the **live rigged 3D Saathi** (`sign-library/saathi-rig/saathi.glb`, built by `ml/blender/saathi_rig.py`, rendered with three.js/R3F in `components/call/saathi-stage.tsx`; see `docs/SAATHI_3D_LIVE.md`); elsewhere 3D videos (`sign-library/saathi3d/`) or the 2D drawing (`sign-library/anim/`); plus pictures. Received signs are performed by Saathi too (the message's `gloss` id → clip; never a substitute sign). Real INCLUDE signers' videos/photos must never be served on the website (no consent).

## Users
Design for a Deaf user who may not read, talking with family who don't sign. Visual-first: Saathi's signs, pictures, big icons; text-to-speech for the hearing side. Never require reading to use the core flow.

## Stack
- `frontend/`: Next.js 16 (App Router) + TypeScript + Tailwind 4 + shadcn/ui. Next 16 has breaking changes — check `frontend/node_modules/next/dist/docs/` before using unfamiliar APIs.
- `backend/`: FastAPI, SQLAlchemy 2 async + asyncpg, Alembic, Pydantic, PyJWT, argon2. Python venv at `backend/.venv`.
- `ml/`: PyTorch, NumPy, scikit-learn, MLflow; export to ONNX.
- PostgreSQL 17 native on Windows (no Docker yet).

## Where things are
- Call: `frontend/app/m/[code]/page.tsx` -> `components/call/*` (pre-join, call view, conversation, sign suggestion, picture board), hooks `use-call` (WebRTC), `use-conversation` (data channel), `use-speech-captions`, `use-sign-recognition`.
- Sign intelligence: `frontend/lib/landmarks/*` (MediaPipe extractor, ROI crops), `frontend/lib/signs/*` (features port, segmenter, ONNX classifier, gloss, library). Python twin: `ml/signsense_ml/`.
- Backend: `backend/app/api/*` (auth, meetings, signaling WS, dev-only dataset/import), models in `app/models`, migrations in `backend/migrations`.
- Dev test cameras: `/m/<code>?fake=1` (pattern) and `?fakevideo=<sign>/<file>` (INCLUDE clip through the real recognizer).
- Checks: `backend: pytest`, `ml: pytest`, `frontend: npx tsc --noEmit && npm run lint && npm run test:signs && npm run check:features && npm run build`. With dev servers up: `npm run check:recognition` (live call, recorded clip as camera), `check:ui`, `check:reconnect`, `eval:saathi` / `check:saathi` (can the model read Saathi; `node scripts/saathi-eval.mjs --rig` for the live rig), `check:saathi-call` (live 3D Saathi in calls). After changing Saathi's drawing, re-run `eval:saathi`: hand style decides whether MediaPipe can track her hands.

## Rules
- Work milestone by milestone (see PROGRESS.md); verify each "done when" before moving on.
- No new dependency without saying why. No hard-coded secrets — use `.env` (only `.env.example` is committed).
- Write backend tests for important behaviour; run `pytest` and `npx tsc --noEmit` / `npm run lint` before calling work done.
- Validate WebRTC without ML first, and the ML model independently before integrating.
- Never claim the model works without measured results. Evaluate signer-independently.
- Never present a low-confidence prediction as certain; unknown gestures must not produce words.
- ISL only — never substitute ASL signs, datasets or fingerspelling.
- Verify dataset/media licences before use.
- Don't store raw video. Don't store translation content without a clear reason.
