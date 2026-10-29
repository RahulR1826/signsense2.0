import base64
import hashlib
import hmac
import time
import uuid
from collections import defaultdict, deque
from datetime import UTC, datetime, timedelta

import jwt
from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerifyMismatchError

from app.core.config import settings

_hasher = PasswordHasher()
ALGORITHM = "HS256"


def hash_password(password: str) -> str:
    return _hasher.hash(password)


def verify_password(password_hash: str, password: str) -> bool:
    try:
        return _hasher.verify(password_hash, password)
    except (VerifyMismatchError, InvalidHashError):
        return False


def create_session_token(user_id: uuid.UUID) -> str:
    now = datetime.now(UTC)
    payload = {"sub": str(user_id), "iat": now, "exp": now + timedelta(days=settings.session_days)}
    return jwt.encode(payload, settings.jwt_secret, algorithm=ALGORITHM)


def read_session_token(token: str) -> uuid.UUID | None:
    try:
        payload = jwt.decode(token, settings.jwt_secret, algorithms=[ALGORITHM])
        return uuid.UUID(payload["sub"])
    except (jwt.PyJWTError, KeyError, ValueError):
        return None


class RateLimiter:
    """In-memory sliding-window limiter (single backend process). Enough for login brute-force protection."""

    def __init__(self, max_events: int, window_s: float):
        self.max_events = max_events
        self.window_s = window_s
        self._events: dict[str, deque[float]] = defaultdict(deque)

    def hit(self, key: str) -> bool:
        """Record an attempt; False if the key is over the limit."""
        now = time.monotonic()
        q = self._events[key]
        while q and now - q[0] > self.window_s:
            q.popleft()
        if len(q) >= self.max_events:
            return False
        q.append(now)
        return True

    def reset(self) -> None:
        self._events.clear()


login_limiter = RateLimiter(max_events=10, window_s=300)
signup_limiter = RateLimiter(max_events=5, window_s=3600)
# Meeting codes are short; stop anyone from enumerating them.
meeting_lookup_limiter = RateLimiter(max_events=60, window_s=60)
ws_join_limiter = RateLimiter(max_events=30, window_s=60)


def turn_credentials(peer_id: str, secret: str, ttl_s: int, now: float | None = None) -> tuple[str, str]:
    """coturn REST-API credentials: username "<expiry>:<peer>", password base64(HMAC-SHA1(secret, username))."""
    username = f"{int((now if now is not None else time.time()) + ttl_s)}:{peer_id}"
    digest = hmac.new(secret.encode(), username.encode(), hashlib.sha1).digest()
    return username, base64.b64encode(digest).decode()
