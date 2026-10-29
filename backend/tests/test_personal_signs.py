import pytest
from fastapi.testclient import TestClient

from app.main import app

pytestmark = pytest.mark.usefixtures("db")

ALICE = {"name": "Alice", "email": "alice@example.com", "password": "alice password"}
BOB = {"name": "Bob", "email": "bob@example.com", "password": "bob password"}


def client_for(user):
    c = TestClient(app)
    c.post("/api/auth/signup", json=user)
    return c


def frame(t):
    return {"t": t, "rightHand": [0.5] * 63, "pose": [0.5] * 132, "face": [0.5] * 216}


def sign(label="Chai", samples=3, frames=20):
    return {
        "label": label,
        "emoji": "\u2615",
        "extractorVersion": "mp-tasks-1.0.1|test",
        "samples": [{"aspect": 1.333, "frames": [frame(i * 66) for i in range(frames)]} for _ in range(samples)],
    }


def test_create_list_delete_own_signs():
    alice = client_for(ALICE)
    res = alice.post("/api/personal-signs", json=sign())
    assert res.status_code == 201
    created = res.json()
    assert created["label"] == "Chai" and len(created["samples"]) == 3
    assert len(created["samples"][0]["frames"]) == 20 and "leftHand" not in created["samples"][0]["frames"][0]

    listed = alice.get("/api/personal-signs").json()
    assert [s["label"] for s in listed] == ["Chai"]
    assert alice.delete(f"/api/personal-signs/{created['id']}").status_code == 204
    assert alice.get("/api/personal-signs").json() == []


def test_signs_are_private_to_their_owner():
    alice = client_for(ALICE)
    sid = alice.post("/api/personal-signs", json=sign()).json()["id"]
    bob = client_for(BOB)
    assert bob.get("/api/personal-signs").json() == []
    assert bob.delete(f"/api/personal-signs/{sid}").status_code == 404
    assert TestClient(app).get("/api/personal-signs").status_code == 401
    assert len(alice.get("/api/personal-signs").json()) == 1


@pytest.mark.parametrize("bad", [
    sign(samples=2),                 # too few takes
    sign(samples=6),                 # too many takes
    sign(frames=3),                  # take too short
    sign(frames=91),                 # take too long
    sign(label="   "),               # empty name
    sign(label="x" * 41),            # name too long
])
def test_validation(bad):
    assert client_for(ALICE).post("/api/personal-signs", json=bad).status_code == 422


def test_bad_landmark_shapes_are_rejected():
    body = sign()
    body["samples"][0]["frames"][0]["rightHand"] = [0.5] * 10
    assert client_for(ALICE).post("/api/personal-signs", json=body).status_code == 422


def test_duplicate_names_and_limit():
    alice = client_for(ALICE)
    assert alice.post("/api/personal-signs", json=sign("Chai")).status_code == 201
    assert alice.post("/api/personal-signs", json=sign("chai")).status_code == 409
    for i in range(19):
        assert alice.post("/api/personal-signs", json=sign(f"Sign {i}")).status_code == 201
    assert alice.post("/api/personal-signs", json=sign("One too many")).status_code == 409


def test_deleting_the_account_deletes_the_signs():
    alice = client_for(ALICE)
    alice.post("/api/personal-signs", json=sign())
    assert alice.request("DELETE", "/api/users/me", json={"password": ALICE["password"]}).status_code == 204
    again = client_for(ALICE)  # same email, new account
    assert again.get("/api/personal-signs").json() == []
