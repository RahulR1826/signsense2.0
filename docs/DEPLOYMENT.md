# Deploying SignSense

**Status (2026-10-25):** the production *configuration* has been reviewed and tested piece by piece
on the development machine. **Docker itself is not installed there, so the containers have never been
built or run.** The table below says exactly what was verified.

| Piece | Verified how | Result |
|---|---|---|
| Frontend production build | `npm run build` + `next start`, live recognition checks against it | ✅ |
| Backend in production mode | `ENVIRONMENT=production COOKIE_SECURE=true ENABLE_DEV_TOOLS=false uvicorn …` | ✅ health 200, database 200, `/docs` and dev endpoints 404, security headers present |
| Unsafe settings refused | `ENVIRONMENT=production COOKIE_SECURE=false` | ✅ refuses to start, message names the problem, no secrets echoed (tested) |
| Database migrations | `backend/scripts/check_migrations.py`: fresh database → `alembic upgrade head` → compare with models → `downgrade base` | ✅ 0 differences |
| `docker-compose.yml` | parsed as YAML; services, health dependencies and the TURN profile checked | ✅ structure only |
| Docker images, compose up, coturn | — | ❌ **not run** (no Docker on this machine) |
| Calls across different networks | — | ❌ **not tested** (needs a TURN server) |

## Quick start with Docker

```bash
cp .env.docker.example .env      # set POSTGRES_PASSWORD and JWT_SECRET (32+ characters)
docker compose up --build        # http://localhost:3000
```

- **Database:** stored in the `db-data` volume. It survives `docker compose down`; `down -v` deletes
  it. Back it up with `docker compose exec db pg_dump -U signsense signsense > backup.sql`.
- **Migrations:** run automatically when the backend starts (`alembic upgrade head` is idempotent).
  No development accounts are created; the dev seed file is never loaded.
- **Health checks:** the database (`pg_isready`), the backend (`/api/health/db`) and the frontend
  (`/`). The frontend only starts once the backend is healthy.
- **Shutdown:** uvicorn and Next run as PID 1, so `docker compose stop` shuts them down cleanly
  (open calls get their sockets closed) instead of killing them after 10 s.
- **Containers run as non-root users.**

## A real (public) deployment

Browsers only allow camera and microphone on **HTTPS**, so a public deployment needs TLS in front of
both services, for example a reverse proxy such as Caddy or nginx. Set, in `.env`:

```
ENVIRONMENT=production          # refuses unsafe settings, hides /docs
COOKIE_SECURE=true
CORS_ORIGINS=["https://signsense.example"]
NEXT_PUBLIC_API_URL=https://api.signsense.example
```

- The proxy must pass WebSocket upgrades for `/ws/meetings/…`.
- Run **one backend process**. Meeting rooms and rate limits are kept in memory, so several workers
  would not see each other's calls.
- Nothing here is paid or deployed anywhere yet.

## TURN: calls across networks

Two devices on the same Wi-Fi connect directly (STUN is enough). Over mobile data, or behind strict
company or university networks, direct connections often fail and the call needs a **TURN relay**.

SignSense uses coturn's **TURN REST API** (`use-auth-secret`):
- The backend gives each call participant its own username (`<expiry>:<peer id>`) and password
  (`HMAC-SHA1(secret, username)`), valid for `TURN_TTL_S` seconds (default 1 h).
- The shared secret stays on the server and is never sent to browsers.
- Expired credentials stop working on their own, so there's nothing to revoke.

**Setup:**
1. Use a server with a public IP address. A small VM is enough for a few calls.
2. Open ports **3478/udp+tcp**, **5349/tcp** (TLS) and **49160–49200/udp** (relay range).
3. In `.env`:
   ```
   TURN_SECRET=<long random string>      # python -c "import secrets; print(secrets.token_urlsafe(48))"
   TURN_REALM=signsense.example
   TURN_URLS=["turn:turn.signsense.example:3478","turns:turn.signsense.example:5349"]
   ```
4. Run `docker compose --profile turn up -d`. The config is `deploy/coturn/turnserver.conf`.
   - For `turns:` (TLS on 5349), uncomment the `cert` and `pkey` lines.
   - On a cloud VM behind NAT, set `external-ip`.
   - `network_mode: host` does not work on Docker Desktop for Windows/Mac. Run coturn on a Linux host.

**What the config does to prevent abuse:**
- No anonymous use: only credentials signed with the secret work, and they expire.
- **Relaying into private and loopback networks is denied** (`denied-peer-ip` for 10/8, 172.16/12,
  192.168/16, 127/8, link-local, …), so the server can't be used to reach machines inside your network.
- No TCP relaying and no multicast; per-user and total quotas; a bandwidth cap per session.
- The secret is passed to coturn on the command line from `.env`. On a shared host, put it in the
  config file with restricted permissions instead.

**To verify TURN once it's running** (not done yet):
1. Open a call with one device on mobile data and the other on Wi-Fi.
2. In Chrome, open `chrome://webrtc-internals`; the selected candidate pair should show `relay`.

## Without Docker (what the developer machine uses)

See the README. In short: PostgreSQL 17, then `backend`: `alembic upgrade head` + `uvicorn`, then
`frontend`: `npm run setup:runtime && npm run build && npm start`.
