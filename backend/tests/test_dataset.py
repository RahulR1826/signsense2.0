import pytest
from fastapi.testclient import TestClient

from app.core.config import settings
from app.main import app

client = TestClient(app)


@pytest.fixture(autouse=True)
def tmp_dataset(tmp_path, monkeypatch):
    monkeypatch.setattr(settings, "dataset_dir", tmp_path)
    return tmp_path


def frame(t: float) -> dict:
    return {"t": t, "leftHand": [0.5] * 63, "rightHand": None, "pose": [0.5] * 132, "face": [0.5] * 216}


def sample(**overrides) -> dict:
    body = {
        "sign": "hello",
        "signer": "rahul",
        "extractorVersion": "test",
        "durationMs": 3000,
        "frames": [frame(i * 33.3) for i in range(10)],
    }
    return body | overrides


def test_vocabulary_includes_no_sign_class():
    ids = [s["id"] for s in client.get("/api/dataset/vocabulary").json()]
    assert "hello" in ids and "no_sign" in ids


def test_save_then_summarize_then_delete(tmp_dataset):
    res = client.post("/api/dataset/samples", json=sample())
    assert res.status_code == 201
    sample_id = res.json()["id"]
    assert (tmp_dataset / "hello" / "rahul" / f"{sample_id}.json").is_file()

    assert client.get("/api/dataset/summary").json() == {"total": 1, "counts": {"hello": {"rahul": 1}}}

    assert client.delete(f"/api/dataset/samples/hello/rahul/{sample_id}").status_code == 204
    assert client.get("/api/dataset/summary").json()["total"] == 0


def test_rejects_unknown_sign():
    assert client.post("/api/dataset/samples", json=sample(sign="not_a_sign")).status_code == 422


@pytest.mark.parametrize("signer", ["../etc", "Rahul Kumar", "", "a" * 33])
def test_rejects_unsafe_signer(signer):
    assert client.post("/api/dataset/samples", json=sample(signer=signer)).status_code == 422


def test_rejects_wrong_landmark_length():
    bad = frame(0) | {"pose": [0.1] * 10}
    assert client.post("/api/dataset/samples", json=sample(frames=[bad] * 10)).status_code == 422


def test_delete_rejects_bad_sample_id():
    assert client.delete("/api/dataset/samples/hello/rahul/not-an-id").status_code == 404
