# SignSense 2.0

Real-time video calls with **Indian Sign Language (ISL)** assistance, designed for Deaf people talking with
family members who don't sign — including people who may not read.

- **Sign → text + speech:** the signer's browser recognises ISL signs from the webcam (MediaPipe landmarks →
  a small neural network, all on-device). Confident signs are sent after a 2-second cancellable countdown,
  unsure ones ask the signer to pick, and signs it doesn't know are rejected instead of guessed.
- **Speech / text → sign:** what the hearing person says (live captions) or types is shown to the signer as
  ISL signs by **Saathi**, an animated signer (3D video by default, 2D drawing on request) whose movements come from real ISL recordings (landmarks only;
  no real signer's video or photo is shown on the site).
- **Picture board:** one-tap pictures (water, food, toilet, pain, help, yes/no…) — no reading or signing needed.
- Video, audio and recognition stay **peer-to-peer / on-device**; the server only handles accounts, meeting
  codes and connecting the call. No video is ever uploaded or stored.

Current scope: 1:1 calls, **39 ISL signs** (from the INCLUDE dataset), isolated-sign recognition.
See `docs/` for the spec, decisions and research.

## What's where

| Folder | What |
|---|---|
| `frontend/` | Next.js 16 + TypeScript + Tailwind + shadcn/ui — the app (calls, recognition, sign player) |
| `backend/` | FastAPI + SQLAlchemy (async) + Alembic + PostgreSQL — auth, meetings, WebSocket signaling |
| `ml/` | Landmark data, training (PyTorch), evaluation, ONNX export, experiments |
| `sign-library/` | Saathi's motions for 39 ISL signs (`anim/`, served) and the INCLUDE clips they came from (`videos/`, dev only, not served) — CC BY 4.0, see its ATTRIBUTION.md |
| `docs/` | `DESIGN.md` (design system + motion), `LIVE_RECOGNITION.md`, `DEPLOYMENT.md` (Docker, TURN), `DEVELOPMENT_LOG.md`, `REAL_DEVICE_TEST_CHECKLIST.md`, `original-spec.md`, `decisions.md`, `experiments.md` |

Pages: `/` landing / dashboard · `/m/<code>` call · `/signs` sign dictionary · `/try` practice signing · `/about` help, limits, accessibility, privacy ·
`/settings` · `/login`, `/signup`, `/onboarding` · dev tools (only with `ENABLE_DEV_TOOLS=true`): `/landmarks`,
`/record`, `/import`. Screenshots at phone, tablet and desktop size: `docs/screenshots/`.

## Run locally (Windows)

Prerequisites: Node 20+, Python 3.11, PostgreSQL 17 on port 5432. Use **Chrome or Edge**.

```bash
# backend — one-time setup
cd backend
python -m venv .venv
.venv/Scripts/python -m pip install -r requirements-dev.txt
cp .env.example .env                 # then set your Postgres password + JWT_SECRET (see the file);
                                     # add ENABLE_DEV_TOOLS=true for the recorder/import dev tools
.venv/Scripts/alembic upgrade head   # creates tables in database "signsense"
.venv/Scripts/uvicorn app.main:app --reload --port 8000
```

```bash
# frontend (second terminal)
cd frontend
npm install
npm run setup:runtime    # MediaPipe + ONNX Runtime WASM, landmark models, Saathi motions -> public/
npm run dev
```

Open http://localhost:3000. To try a call alone: open it in a normal **and** an incognito window, create a
meeting in one, join with the code in the other.

### Test on a phone (same Wi-Fi)

Phones only allow camera/microphone over HTTPS:

```bash
backend/.venv/Scripts/python scripts/make_dev_cert.py   # self-signed cert for localhost + your LAN IP
```

Add to `backend/.env`: `CORS_ORIGIN_REGEX=https?://(localhost|127\.0\.0\.1|192\.168\.[0-9]+\.[0-9]+|10\.[0-9]+\.[0-9]+\.[0-9]+):3000`
then start the backend with `--host 0.0.0.0 --ssl-keyfile ../certs/dev-key.pem --ssl-certfile ../certs/dev-cert.pem`
and the frontend with `npm run dev:https`. On the phone, first open `https://<laptop-ip>:8000/api/health` and
accept the warning, then `https://<laptop-ip>:3000`. (Windows Firewall may ask to allow Node/Python — allow on
private networks.)

### Docker

```bash
cp .env.docker.example .env   # set POSTGRES_PASSWORD and JWT_SECRET
docker compose up --build     # http://localhost:3000
```

Written but **not yet run** (Docker wasn't available on the development machine).

### Calls across networks (TURN)

Two devices on the same Wi-Fi connect with STUN alone. For mobile data or strict networks, run a TURN server
(e.g. coturn with `use-auth-secret`) and set `TURN_URLS` + `TURN_SECRET` in `backend/.env`. Each person then
gets short-lived credentials; the secret never reaches browsers. **No TURN server is set up yet.**

## Tests

```bash
cd backend && .venv/Scripts/python -m pytest     # API, auth, meetings, signaling (needs Postgres; uses db signsense_test)
cd ml && .venv/Scripts/python -m pytest          # features, decision policy, publish rule
cd frontend && npm run test:signs                # segmenter, text->sign, decision policy, published model in ORT-web
cd frontend && npm run check:features            # browser features == Python features (needs fixtures, see below)
cd frontend && npx tsc --noEmit && npm run lint && npm run build
# Browser checks (dev servers running; headless Chrome, no camera or person needed):
cd frontend && npm run check:ui                  # every page at 375x812 / 768x1024 / 1440x900 + a real 2-person call
cd frontend && npm run check:reconnect           # backend restart mid-call -> call recovers
cd frontend && npm run check:recognition         # live call: recorded INCLUDE clips as a fake camera -> recognition -> delivery (12 checks)
cd frontend && npm run check:journeys            # first-time-user journeys: sign-up -> onboarding -> call -> settings -> delete; dead links
cd frontend && npm run check:try                 # practice page start-up and responsiveness
cd frontend && npm run eval:saathi               # can the sign model read Saathi? drawing -> MediaPipe -> model, per sign (offline)
cd frontend && npm run check:saathi              # Saathi rendered to video as the camera of /try, vs the source clip (~25 min)
cd frontend && npm run check:saathi-call         # live 3D Saathi in two-browser calls: received signs/text, fallbacks, layout
# Live rigged Saathi (Blender 4.5): blender -b --factory-startup -P ml/blender/saathi_rig.py   (then npm run setup:runtime)
# 3D Saathi (Blender 4.5, GPU): cd ml && .venv/Scripts/python tools/render_saathi3d.py   (then npm run setup:runtime)
# check it: blender -b --factory-startup -P ml/blender/saathi3d.py -- --mode camera; npm run eval:saathi -- --frames3d ../ml/data/cache/saathi3d/camera
cd backend && .venv/Scripts/python scripts/check_migrations.py   # migrations on a throwaway DB == models
```

## The ML pipeline

One command, resumable (progress saved after every step in `ml/reports/pipeline_state.json`):

```bash
cd ml
.venv/Scripts/python -m pip install -r requirements.txt --extra-index-url https://download.pytorch.org/whl/cu130
.venv/Scripts/python -m signsense_ml.pipeline --download   # needs the dev servers for landmark extraction
```

Steps: environment check → download INCLUDE clips → video sizes → landmarks (the app's own MediaPipe
extractor, headless) → data audit (`ml/reports/dataset_audit.json`) → train → evaluate candidate and published
model on the same clips → publish only if it sends fewer wrong words and loses ≤ 2 points of accuracy →
regenerate browser fixtures → run the contract tests. `--no-publish` never touches the app's model.

- **Data:** INCLUDE (CC BY 4.0): 708 clips of our 39 signs plus 669 clips of 223 *other* ISL words, which
  train an `unknown` class from real signs (no invented "no sign" data). Details:
  `docs/ML_DATA_COLLECTION_GUIDE.md`.
- **Features** (`ml/signsense_ml/features.py` = `frontend/lib/signs/features.ts`, parity-tested): hands, upper
  body and face landmarks normalised to the shoulders, 48 frames at 15 fps, 3 window placements per sign.
- **Decision policy** (`policy.py` = `lib/signs/decision.ts`): temperature calibration, then accept / suggest /
  reject with thresholds chosen on validation data only.

**Results** (published model `20261021-001816-cnn-candidate`; full tables in `docs/DEVELOPMENT_LOG.md`):

| | INCLUDE official test (published model) | Held-out recording sessions (same recipe, retrained with those sessions held out; more honest) |
|---|---|---|
| Known-sign accuracy (top-1 / top-3) | 96.7% / 99.2% | 86.4% / 94.5% |
| Known signs sent as a **wrong** word | 0 / 121 | 0 / 110 |
| Unknown signs sent as a word | 7 / 141 (5%) | 0 / 141 |

The official split shares recording sessions between train and test, so its numbers are optimistic. Neither
split is signer-independent (INCLUDE publishes no signer IDs). Accuracy on *new people* has not been measured.

## Credits

Sign videos and training data: **INCLUDE** — Sridhar, Ganesan, Kumar, Khapra, ACM MM 2020,
https://zenodo.org/records/4010759 (CC BY 4.0); signed by Deaf students of St. Louis School for the Deaf,
Chennai. Official split from github.com/AI4Bharat/INCLUDE (MIT). Landmarks: Google MediaPipe (Apache-2.0).
Inference: ONNX Runtime Web (MIT).
