import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.services.meetings import CODE_PATTERN, new_code, normalize_code

HOST = {"name": "Host", "email": "host@example.com", "password": "host password"}
OTHER = {"name": "Other", "email": "other@example.com", "password": "other password"}


def signed_in(user):
    c = TestClient(app)
    c.post("/api/auth/signup", json=user)
    return c


def test_codes_are_well_formed_and_unambiguous():
    for _ in range(200):
        code = new_code()
        assert CODE_PATTERN.match(code)
        assert not set(code[3:]) & set("01OIL")


@pytest.mark.parametrize(
    "raw,expected",
    [("SS-7F4K2", "SS-7F4K2"), ("ss-7f4k2", "SS-7F4K2"), ("7F4K2", "SS-7F4K2"), (" ss 7f4k2 ", "SS-7F4K2"),
     ("SS-0OIL1", None), ("SS-7F4K", None), ("hello", None)],
)
def test_normalize_code(raw, expected):
    assert normalize_code(raw) == expected


@pytest.mark.usefixtures("db")
def test_create_and_lookup_meeting():
    host = signed_in(HOST)
    res = host.post("/api/meetings")
    assert res.status_code == 201
    meeting = res.json()
    assert CODE_PATTERN.match(meeting["code"]) and meeting["is_host"] and meeting["status"] == "active"

    # A guest (no account) can look it up with a sloppy-typed code.
    guest = TestClient(app)
    found = guest.get(f"/api/meetings/{meeting['code'].lower().replace('-', '')}")
    assert found.status_code == 200
    assert found.json()["host_name"] == "Host" and not found.json()["is_host"]


@pytest.mark.usefixtures("db")
def test_creating_needs_login():
    assert TestClient(app).post("/api/meetings").status_code == 401


@pytest.mark.usefixtures("db")
def test_unknown_or_malformed_code_is_404():
    c = TestClient(app)
    assert c.get("/api/meetings/SS-ZZZZZ").status_code == 404
    assert c.get("/api/meetings/not-a-code").status_code == 404


@pytest.mark.usefixtures("db")
def test_only_host_can_end():
    host = signed_in(HOST)
    code = host.post("/api/meetings").json()["code"]
    other = signed_in(OTHER)
    assert other.post(f"/api/meetings/{code}/end").status_code == 403
    res = host.post(f"/api/meetings/{code}/end")
    assert res.status_code == 200 and res.json()["status"] == "ended"
    assert TestClient(app).get(f"/api/meetings/{code}").json()["status"] == "ended"


@pytest.mark.usefixtures("db")
def test_list_my_meetings_newest_first_and_private():
    host = signed_in(HOST)
    codes = [host.post("/api/meetings").json()["code"] for _ in range(3)]
    mine = host.get("/api/meetings")
    assert mine.status_code == 200
    assert [m["code"] for m in mine.json()] == codes[::-1]
    assert signed_in(OTHER).get("/api/meetings").json() == []
    assert TestClient(app).get("/api/meetings").status_code == 401


def test_stale_meeting_rules(monkeypatch):
    from datetime import UTC, datetime, timedelta

    from app.models import Meeting, MeetingStatus
    from app.services.meetings import is_stale

    now = datetime(2026, 10, 21, 12, tzinfo=UTC)
    old = Meeting(code="SS-AAAAA", host_id=None, status=MeetingStatus.active, created_at=now - timedelta(hours=25))
    fresh = Meeting(code="SS-BBBBB", host_id=None, status=MeetingStatus.active, created_at=now - timedelta(hours=1))
    assert is_stale(old, connected=0, now=now)
    assert not is_stale(old, connected=1, now=now)  # never end a call that is in progress
    assert not is_stale(fresh, connected=0, now=now)


@pytest.mark.usefixtures("db")
def test_old_unused_meeting_is_ended_on_lookup():
    import asyncio
    from datetime import UTC, datetime, timedelta

    from sqlalchemy import update
    from sqlalchemy.ext.asyncio import create_async_engine
    from sqlalchemy.pool import NullPool

    import os
    from app.models import Meeting

    host = signed_in(HOST)
    code = host.post("/api/meetings").json()["code"]

    async def age():
        engine = create_async_engine(os.environ["DATABASE_URL"], poolclass=NullPool)
        async with engine.begin() as conn:
            await conn.execute(update(Meeting).where(Meeting.code == code).values(created_at=datetime.now(UTC) - timedelta(days=2)))
        await engine.dispose()

    asyncio.run(age())
    assert host.get(f"/api/meetings/{code}").json()["status"] == "ended"


@pytest.mark.usefixtures("db")
def test_dangling_participants_closed_at_startup():
    import asyncio

    from sqlalchemy import select

    from app.core.database import SessionLocal
    from app.models import Meeting, Participant
    from app.services.meetings import close_dangling_participants

    host = signed_in(HOST)
    code = host.post("/api/meetings").json()["code"]

    async def scenario():
        async with SessionLocal() as s:
            meeting = await s.scalar(select(Meeting).where(Meeting.code == code))
            s.add(Participant(meeting_id=meeting.id, display_name="Cut off"))
            await s.commit()
        async with SessionLocal() as s:
            assert await close_dangling_participants(s) == 1
        async with SessionLocal() as s:
            return await s.scalar(select(Participant.left_at))

    assert asyncio.run(scenario()) is not None
