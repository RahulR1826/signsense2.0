from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)


def test_health_ok():
    response = client.get("/api/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


def test_security_headers():
    from fastapi.testclient import TestClient

    from app.main import app

    res = TestClient(app).get("/api/health")
    assert res.headers["x-content-type-options"] == "nosniff"
    assert res.headers["x-frame-options"] == "DENY"


def test_settings_refuse_weak_secret_and_unsafe_production():
    import pytest

    from app.core.config import Settings, UnsafeSettings, check_settings

    secret_db = "postgresql+asyncpg://u:SECRET-DB-PASSWORD@localhost/x"
    base = {"database_url": secret_db, "jwt_secret": "x" * 40, "_env_file": None}
    with pytest.raises(UnsafeSettings, match="at least 32") as weak:
        check_settings(Settings(**{**base, "jwt_secret": "short"}))
    with pytest.raises(UnsafeSettings, match="COOKIE_SECURE") as prod:
        check_settings(Settings(**base, environment="production", cookie_secure=False, enable_dev_tools=False))
    with pytest.raises(UnsafeSettings, match="ENABLE_DEV_TOOLS"):
        check_settings(Settings(**base, environment="production", cookie_secure=True, enable_dev_tools=True))
    # The error messages never echo secrets.
    for e in (weak, prod):
        assert "SECRET-DB-PASSWORD" not in str(e.value) and "x" * 40 not in str(e.value)
    check_settings(Settings(**base, environment="production", cookie_secure=True, enable_dev_tools=False, cors_origins=["https://signsense.example"]))
