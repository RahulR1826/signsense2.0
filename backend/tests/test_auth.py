import pytest
from fastapi.testclient import TestClient

from app.core.config import settings
from app.main import app

pytestmark = pytest.mark.usefixtures("db")

USER = {"name": "Rahul", "email": "Rahul@Example.com", "password": "correct horse"}


@pytest.fixture
def client():
    with TestClient(app) as c:
        yield c


def test_signup_sets_session_and_me_works(client):
    res = client.post("/api/auth/signup", json=USER)
    assert res.status_code == 201
    body = res.json()
    assert body["email"] == "rahul@example.com" and body["preferences"] is None
    assert "password" not in str(body) and "hash" not in str(body)
    cookie = res.headers["set-cookie"].lower()
    assert settings.session_cookie in cookie and "httponly" in cookie and "samesite=lax" in cookie

    assert client.get("/api/auth/me").json()["name"] == "Rahul"


def test_duplicate_email_is_rejected_case_insensitively(client):
    client.post("/api/auth/signup", json=USER)
    res = client.post("/api/auth/signup", json=USER | {"email": "rahul@example.com"})
    assert res.status_code == 409


@pytest.mark.parametrize("bad", [{"password": "short"}, {"email": "not-an-email"}, {"name": "   "}])
def test_signup_validation(client, bad):
    assert client.post("/api/auth/signup", json=USER | bad).status_code == 422


def test_login_logout_cycle(client):
    client.post("/api/auth/signup", json=USER)
    client.post("/api/auth/logout")
    assert client.get("/api/auth/me").status_code == 401

    assert client.post("/api/auth/login", json={"email": "rahul@example.com", "password": "wrong pass"}).status_code == 401
    res = client.post("/api/auth/login", json={"email": "RAHUL@example.com", "password": USER["password"]})
    assert res.status_code == 200
    assert client.get("/api/auth/me").status_code == 200


def test_unknown_email_and_wrong_password_look_the_same(client):
    client.post("/api/auth/signup", json=USER)
    client.post("/api/auth/logout")
    a = client.post("/api/auth/login", json={"email": "nobody@example.com", "password": "whatever1"})
    b = client.post("/api/auth/login", json={"email": "rahul@example.com", "password": "whatever1"})
    assert a.status_code == b.status_code == 401 and a.json() == b.json()


def test_login_is_rate_limited(client):
    for _ in range(10):
        client.post("/api/auth/login", json={"email": "x@example.com", "password": "wrong-password"})
    assert client.post("/api/auth/login", json={"email": "x@example.com", "password": "wrong-password"}).status_code == 429


def test_forged_or_garbage_cookie_is_not_a_session(client):
    client.cookies.set(settings.session_cookie, "not-a-jwt")
    assert client.get("/api/auth/me").status_code == 401


def test_preferences_round_trip(client):
    client.post("/api/auth/signup", json=USER)
    res = client.put("/api/users/me/preferences", json={"mode": "signer", "sign_to_text": True, "text_to_sign": True})
    assert res.status_code == 200 and res.json()["mode"] == "signer"
    client.put("/api/users/me/preferences", json={"mode": "both", "text_to_sign": False})
    prefs = client.get("/api/auth/me").json()["preferences"]
    assert prefs == {"mode": "both", "sign_language": "ISL", "sign_to_text": True, "text_to_sign": False}


def test_only_isl_is_accepted(client):
    client.post("/api/auth/signup", json=USER)
    assert client.put("/api/users/me/preferences", json={"mode": "signer", "sign_language": "ASL"}).status_code == 422


def test_preferences_need_login(client):
    assert client.put("/api/users/me/preferences", json={"mode": "signer"}).status_code == 401


def test_rename_profile(client):
    assert client.patch("/api/users/me", json={"name": "X"}).status_code == 401
    client.post("/api/auth/signup", json=USER)
    res = client.patch("/api/users/me", json={"name": "  Rahul R  "})
    assert res.status_code == 200 and res.json()["name"] == "Rahul R"
    assert client.get("/api/auth/me").json()["name"] == "Rahul R"
    assert client.patch("/api/users/me", json={"name": "   "}).status_code == 422
    assert client.patch("/api/users/me", json={"name": "x" * 81}).status_code == 422


def test_signup_is_rate_limited(client):
    from app.core.security import signup_limiter

    for i in range(signup_limiter.max_events):
        assert client.post("/api/auth/signup", json={**USER, "email": f"u{i}@example.com"}).status_code == 201
    assert client.post("/api/auth/signup", json={**USER, "email": "one-more@example.com"}).status_code == 429


def test_dev_tools_are_off_by_default():
    from app.core.config import Settings

    assert Settings.model_fields["enable_dev_tools"].default is False


def test_delete_account_needs_password_and_removes_everything(client):
    client.post("/api/auth/signup", json=USER)
    client.put("/api/users/me/preferences", json={"mode": "signer"})
    code = client.post("/api/meetings").json()["code"]
    assert client.request("DELETE", "/api/users/me", json={"password": "wrong password"}).status_code == 403
    res = client.request("DELETE", "/api/users/me", json={"password": USER["password"]})
    assert res.status_code == 204
    assert client.get("/api/auth/me").status_code == 401  # cookie cleared
    assert client.post("/api/auth/login", json={"email": USER["email"], "password": USER["password"]}).status_code == 401
    assert client.get(f"/api/meetings/{code}").status_code == 404  # hosted meetings are gone
    # The email can be used again.
    assert client.post("/api/auth/signup", json=USER).status_code == 201


def test_delete_account_needs_login(client):
    assert client.request("DELETE", "/api/users/me", json={"password": "x"}).status_code == 401
