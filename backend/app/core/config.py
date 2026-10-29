import re
from pathlib import Path

from typing import Literal

from pydantic_settings import BaseSettings, SettingsConfigDict

BACKEND_DIR = Path(__file__).resolve().parents[2]
REPO_DIR = BACKEND_DIR.parent


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=BACKEND_DIR / ".env", extra="ignore")

    # "production" refuses to start with unsafe settings (see check_safe below) and hides the API docs.
    environment: Literal["development", "production"] = "development"

    database_url: str
    # Tests run against a fresh event loop per test; pooled asyncpg connections can't cross loops.
    database_nullpool: bool = False
    cors_origins: list[str] = ["http://localhost:3000"]
    # Optional regex for extra allowed origins, e.g. phones on the home Wi-Fi during a demo:
    #   CORS_ORIGIN_REGEX=https?://(192\.168|10)\.\d+\.\d+(\.\d+)?:3000
    cors_origin_regex: str | None = None

    # Dev-only tools (dataset recorder + INCLUDE import endpoints, unauthenticated). Off unless set in .env.
    enable_dev_tools: bool = False

    # WebRTC ICE servers handed to browsers. Add a TURN server (coturn) for production (decisions.md).
    ice_servers: list[dict] = [{"urls": ["stun:stun.l.google.com:19302", "stun:stun1.l.google.com:19302"]}]
    # Optional TURN with short-lived credentials (coturn `use-auth-secret` / TURN REST API). When set, each
    # peer gets its own credentials that expire after turn_ttl_s; the shared secret never leaves the server.
    turn_urls: list[str] = []
    turn_secret: str = ""
    turn_ttl_s: int = 3600
    # An active meeting nobody is connected to is ended this long after it was created.
    meeting_ttl_hours: int = 24
    max_participants: int = 2  # 1:1 calls for the first release

    jwt_secret: str
    session_days: int = 7
    session_cookie: str = "ss_session"
    cookie_secure: bool = False  # set true in production (HTTPS)

    # Landmark dataset collection (M1). Files, not DB rows: the ML pipeline reads them directly.
    dataset_dir: Path = REPO_DIR / "ml" / "data" / "raw"
    vocabulary_file: Path = REPO_DIR / "ml" / "vocabulary.json"
    # INCLUDE dataset: videos/ (downloaded by ml/tools/include_download.py) and landmarks/ (from the import page).
    include_dir: Path = REPO_DIR / "ml" / "data" / "include"


class UnsafeSettings(RuntimeError):
    """Raised at startup. Deliberately not a pydantic ValidationError: those echo the input values,
    which include the database password and JWT secret, into logs."""


def check_settings(s: "Settings") -> None:
    if len(s.jwt_secret) < 32:
        raise UnsafeSettings(
            "JWT_SECRET must be at least 32 characters. Generate one with: "
            'python -c "import secrets; print(secrets.token_urlsafe(48))"'
        )
    if s.environment == "production":
        problems = []
        if not s.cookie_secure:
            problems.append("COOKIE_SECURE must be true (sessions over HTTPS only)")
        if s.enable_dev_tools:
            problems.append("ENABLE_DEV_TOOLS must be false (the dataset endpoints are unauthenticated)")
        if any(o.startswith("http://") and "localhost" not in o for o in s.cors_origins):
            problems.append("CORS_ORIGINS must use https:// outside localhost")
        if problems:
            raise UnsafeSettings("Unsafe production settings: " + "; ".join(problems))


settings = Settings()
check_settings(settings)


def origin_allowed(origin: str | None) -> bool:
    """Same rule as CORS, used for WebSocket upgrades (browsers don't apply CORS to them)."""
    if not origin:
        return False
    if origin in settings.cors_origins:
        return True
    return bool(settings.cors_origin_regex and re.fullmatch(settings.cors_origin_regex, origin))
