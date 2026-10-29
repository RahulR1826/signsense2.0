from contextlib import contextmanager

import pytest
from fastapi.testclient import TestClient
from starlette.websockets import WebSocketDisconnect

from app.main import app

pytestmark = pytest.mark.usefixtures("db")

ORIGIN = {"origin": "http://localhost:3000"}
HOST = {"name": "Host", "email": "host@example.com", "password": "host password"}


@pytest.fixture
def meeting_code():
    with TestClient(app) as c:
        c.post("/api/auth/signup", json=HOST)
        return c.post("/api/meetings").json()["code"]


@contextmanager
def connect(client: TestClient, code: str, name: str = "Guest", headers=ORIGIN):
    with client.websocket_connect(f"/ws/meetings/{code}", headers=headers) as ws:
        try:
            ws.send_json({"type": "hello", "name": name})
        except Exception:  # refused before the hello (e.g. wrong origin): let the test see the close
            pass
        yield ws


def test_two_peers_meet_and_relay_signals(meeting_code):
    client = TestClient(app)
    with connect(client, meeting_code, "Asha") as a:
        welcome_a = a.receive_json()
        assert welcome_a["type"] == "welcome" and welcome_a["peers"] == [] and welcome_a["iceServers"]

        with connect(client, meeting_code, "Ravi") as b:
            welcome_b = b.receive_json()
            assert welcome_b["peers"] == [{"peerId": welcome_a["peerId"], "name": "Asha"}]
            joined = a.receive_json()
            assert joined == {"type": "peer-joined", "peer": {"peerId": welcome_b["peerId"], "name": "Ravi"}}

            b.send_json({"type": "signal", "to": welcome_a["peerId"], "data": {"sdp": {"type": "offer", "sdp": "v=0"}}})
            relayed = a.receive_json()
            assert relayed == {"type": "signal", "from": welcome_b["peerId"], "data": {"sdp": {"type": "offer", "sdp": "v=0"}}}

        assert a.receive_json() == {"type": "peer-left", "peerId": welcome_b["peerId"]}


def test_third_person_is_refused(meeting_code):
    client = TestClient(app)
    with connect(client, meeting_code) as a, connect(client, meeting_code) as b:
        a.receive_json(), b.receive_json()
        with connect(client, meeting_code) as c:
            assert c.receive_json() == {"type": "error", "code": "room_full"}


def test_unknown_meeting(meeting_code):
    with connect(TestClient(app), "SS-ZZZZZ") as ws:
        assert ws.receive_json() == {"type": "error", "code": "not_found"}


def test_other_sites_cannot_connect(meeting_code):
    with pytest.raises(WebSocketDisconnect):
        with connect(TestClient(app), meeting_code, headers={"origin": "https://evil.example"}) as ws:
            ws.receive_json()


def test_bad_messages_get_errors_not_crashes(meeting_code):
    with connect(TestClient(app), meeting_code) as ws:
        ws.receive_json()
        ws.send_text("not json")
        assert ws.receive_json()["code"] == "bad_message"
        ws.send_json({"type": "signal", "to": "nobody", "data": {}})
        assert ws.receive_json()["code"] == "unknown_peer"
        ws.send_json({"type": "ping"})
        assert ws.receive_json() == {"type": "pong"}


def test_signed_in_user_appears_with_account_name(meeting_code):
    with TestClient(app) as host:
        host.post("/api/auth/login", json={"email": HOST["email"], "password": HOST["password"]})
        with connect(host, meeting_code, "ignored") as ws:
            assert ws.receive_json()["name"] == "Host"


def test_ended_meeting_rejects_joins(meeting_code):
    with TestClient(app) as host:
        host.post("/api/auth/login", json={"email": HOST["email"], "password": HOST["password"]})
        host.post(f"/api/meetings/{meeting_code}/end")
    with connect(TestClient(app), meeting_code) as ws:
        assert ws.receive_json() == {"type": "error", "code": "meeting_ended"}


def test_lan_origin_allowed_only_when_configured(meeting_code, monkeypatch):
    from app.core.config import settings

    lan = {"origin": "https://192.168.1.20:3000"}
    with pytest.raises(WebSocketDisconnect):
        with connect(TestClient(app), meeting_code, headers=lan) as ws:
            ws.receive_json()
    monkeypatch.setattr(settings, "cors_origin_regex", r"https?://(192\.168|10)\.\d+\.\d+(\.\d+)?:3000")
    with connect(TestClient(app), meeting_code, headers=lan) as ws:
        assert ws.receive_json()["type"] == "welcome"


def test_host_ending_meeting_disconnects_everyone():
    host = TestClient(app)
    host.post("/api/auth/signup", json=HOST)
    code = host.post("/api/meetings").json()["code"]
    with connect(TestClient(app), code, "Asha") as guest:
        assert guest.receive_json()["type"] == "welcome"
        assert host.post(f"/api/meetings/{code}/end").json()["status"] == "ended"
        assert guest.receive_json() == {"type": "error", "code": "meeting_ended"}
        with pytest.raises(WebSocketDisconnect) as closed:
            guest.receive_json()
        assert closed.value.code == 4410


def test_name_comes_from_hello_not_url(meeting_code):
    client = TestClient(app)
    with client.websocket_connect(f"/ws/meetings/{meeting_code}", headers=ORIGIN) as ws:
        ws.send_json({"type": "ping"})  # anything but a hello first is refused
        assert ws.receive_json() == {"type": "error", "code": "bad_message"}
        with pytest.raises(WebSocketDisconnect):
            ws.receive_json()
    with connect(client, meeting_code, "  Meera  ") as a:
        assert a.receive_json()["name"] == "Meera"


def test_turn_credentials_are_per_peer_and_expire(meeting_code, monkeypatch):
    import base64
    import hashlib
    import hmac

    from app.core.config import settings

    monkeypatch.setattr(settings, "turn_urls", ["turn:turn.example.test:3478"])
    monkeypatch.setattr(settings, "turn_secret", "test-turn-secret")
    with connect(TestClient(app), meeting_code) as a:
        welcome = a.receive_json()
    turn = welcome["iceServers"][-1]
    assert turn["urls"] == ["turn:turn.example.test:3478"]
    expiry, peer = turn["username"].split(":")
    assert peer == welcome["peerId"] and int(expiry) > 0
    expected = base64.b64encode(hmac.new(b"test-turn-secret", turn["username"].encode(), hashlib.sha1).digest()).decode()
    assert turn["credential"] == expected
    assert "test-turn-secret" not in str(welcome)


def test_ws_joins_are_rate_limited(meeting_code):
    from app.core.security import ws_join_limiter

    client = TestClient(app)
    for _ in range(ws_join_limiter.max_events):
        ws_join_limiter.hit("testclient")
    with connect(client, meeting_code) as a:
        assert a.receive_json() == {"type": "error", "code": "rate_limited"}


def test_deleted_account_is_anonymised_in_other_peoples_meetings(meeting_code):
    import asyncio

    from sqlalchemy import select

    from app.core.database import SessionLocal
    from app.models import Participant

    guest_user = {"name": "Meera", "email": "meera@example.com", "password": "meera password"}
    client = TestClient(app)
    client.post("/api/auth/signup", json=guest_user)
    with connect(client, meeting_code, "ignored") as ws:
        assert ws.receive_json()["name"] == "Meera"  # signed-in users appear under their account name
    assert client.request("DELETE", "/api/users/me", json={"password": guest_user["password"]}).status_code == 204

    async def rows():
        async with SessionLocal() as s:
            return [(p.display_name, p.user_id) for p in await s.scalars(select(Participant))]

    assert asyncio.run(rows()) == [("Deleted user", None)]
