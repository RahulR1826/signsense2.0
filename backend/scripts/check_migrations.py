"""Migrations produce exactly the schema the models describe.

Creates a throwaway database (signsense_migcheck) on the server in DATABASE_URL, runs
`alembic upgrade head`, compares the result with the SQLAlchemy models (alembic autogenerate diff),
then downgrades to base and drops the database. Never touches the real `signsense` database.
Needs a role allowed to CREATE DATABASE.

Usage (from backend/): .venv/Scripts/python scripts/check_migrations.py
"""

import asyncio
import os
import re
import subprocess
import sys
from pathlib import Path

BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND))
NAME = "signsense_migcheck"


def base_url() -> str:
    env = BACKEND / ".env"
    for line in env.read_text(encoding="utf-8").splitlines() if env.exists() else []:
        if line.startswith("DATABASE_URL="):
            return line.split("=", 1)[1].strip()
    return os.environ["DATABASE_URL"]


async def admin(sql: str, url: str) -> None:
    import asyncpg

    conn = await asyncpg.connect(re.sub(r"^postgresql\+asyncpg", "postgresql", url))
    try:
        await conn.execute(sql)
    finally:
        await conn.close()


async def diff(url: str) -> list:
    from alembic.autogenerate import compare_metadata
    from alembic.migration import MigrationContext
    from sqlalchemy.ext.asyncio import create_async_engine

    from app import models  # noqa: F401
    from app.core.database import Base

    engine = create_async_engine(url)
    async with engine.connect() as conn:
        result = await conn.run_sync(lambda c: compare_metadata(MigrationContext.configure(c), Base.metadata))
    await engine.dispose()
    return result


def main() -> None:
    url = base_url()
    server_db = re.sub(r"/[^/?]+(\?.*)?$", r"/postgres\1", url)
    check_url = re.sub(r"/[^/?]+(\?.*)?$", rf"/{NAME}\1", url)
    asyncio.run(admin(f'DROP DATABASE IF EXISTS "{NAME}"', server_db))
    asyncio.run(admin(f'CREATE DATABASE "{NAME}"', server_db))
    env = {**os.environ, "DATABASE_URL": check_url}
    try:
        for args in (["upgrade", "head"],):
            r = subprocess.run([sys.executable, "-m", "alembic", *args], cwd=BACKEND, env=env, capture_output=True, text=True)
            if r.returncode:
                raise SystemExit(f"alembic {' '.join(args)} failed:\n{r.stderr[-2000:]}")
        os.environ["DATABASE_URL"] = check_url
        changes = asyncio.run(diff(check_url))
        print(f"upgrade head: OK; differences between migrated schema and models: {len(changes)}")
        for c in changes:
            print("  ", c)
        r = subprocess.run([sys.executable, "-m", "alembic", "downgrade", "base"], cwd=BACKEND, env=env, capture_output=True, text=True)
        print("downgrade base:", "OK" if r.returncode == 0 else f"FAILED\n{r.stderr[-1500:]}")
        if changes or r.returncode:
            sys.exit(1)
    finally:
        asyncio.run(admin(f'DROP DATABASE IF EXISTS "{NAME}"', server_db))


if __name__ == "__main__":
    main()
