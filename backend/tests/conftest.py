import asyncio
import os
import re
from pathlib import Path

import pytest

# Point the app at the separate test database (same server/credentials as backend/.env, db "signsense_test").
# Must run before `app` is imported. Never touches the real `signsense` database.
_env = Path(__file__).resolve().parents[1] / ".env"
_url = next(
    (line.split("=", 1)[1].strip() for line in (_env.read_text(encoding="utf-8").splitlines() if _env.exists() else [])
     if line.startswith("DATABASE_URL=")),
    "postgresql+asyncpg://test:test@localhost:5432/signsense",
)
os.environ["DATABASE_URL"] = re.sub(r"/[^/?]+(\?.*)?$", r"/signsense_test\1", _url)
os.environ["DATABASE_NULLPOOL"] = "true"
os.environ["JWT_SECRET"] = "test-only-secret-" + "x" * 40
# Pin settings a developer may have customised in backend/.env.
os.environ["CORS_ORIGINS"] = '["http://localhost:3000"]'
os.environ["CORS_ORIGIN_REGEX"] = ""
os.environ["ENABLE_DEV_TOOLS"] = "true"
os.environ["COOKIE_SECURE"] = "false"


@pytest.fixture
def db():
    """Fresh schema for each test. Skips the test if Postgres isn't reachable."""
    from sqlalchemy.ext.asyncio import create_async_engine
    from sqlalchemy.pool import NullPool

    from app import models  # noqa: F401  (register tables)
    from app.core.database import Base

    engine = create_async_engine(os.environ["DATABASE_URL"], poolclass=NullPool)

    async def reset():
        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.drop_all)
            await conn.run_sync(Base.metadata.create_all)

    try:
        asyncio.run(reset())
    except OSError as exc:
        pytest.skip(f"test database not reachable: {exc}")
    yield
    asyncio.run(engine.dispose())


@pytest.fixture(autouse=True)
def reset_rate_limits():
    from app.core.security import login_limiter, meeting_lookup_limiter, signup_limiter, ws_join_limiter

    for limiter in (login_limiter, signup_limiter, meeting_lookup_limiter, ws_join_limiter):
        limiter.reset()
