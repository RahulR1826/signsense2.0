import json

import pytest
from fastapi.testclient import TestClient

from app.core.config import settings
from app.main import app

client = TestClient(app)
VERSION = "test-v1"


@pytest.fixture(autouse=True)
def include_dir(tmp_path, monkeypatch):
    monkeypatch.setattr(settings, "include_dir", tmp_path)
    videos = tmp_path / "videos" / "hello"
    videos.mkdir(parents=True)
    (videos / "Greetings__Hello__MVI_0001.MOV").write_bytes(b"fake video")
    (videos / "Greetings__Hello__MVI_0002.MOV.part").write_bytes(b"unfinished download")
    return tmp_path


def frames(n: int = 3) -> list[dict]:
    return [{"t": i * 40, "leftHand": None, "rightHand": [0.1] * 63, "pose": [0.2] * 132, "face": None} for i in range(n)]


def test_pending_lists_finished_videos_only():
    body = client.get("/api/dataset/include/pending", params={"extractor_version": VERSION}).json()
    assert body == {"done": 0, "todo": [{"sign": "hello", "file": "Greetings__Hello__MVI_0001.MOV"}]}


def test_save_marks_video_done_for_that_version_only(include_dir):
    res = client.post(
        "/api/dataset/include/landmarks",
        json={"sign": "hello", "file": "Greetings__Hello__MVI_0001.MOV", "extractorVersion": VERSION, "fps": 25, "frames": frames()},
    )
    assert res.status_code == 201
    saved = json.loads((include_dir / "landmarks" / "hello" / "Greetings__Hello__MVI_0001.json").read_text())
    assert saved["source"] == "INCLUDE" and len(saved["frames"]) == 3

    assert client.get("/api/dataset/include/pending", params={"extractor_version": VERSION}).json()["done"] == 1
    other = client.get("/api/dataset/include/pending", params={"extractor_version": "other"}).json()
    assert other["done"] == 0 and len(other["todo"]) == 1


def test_streams_video():
    res = client.get("/api/dataset/include/videos/hello/Greetings__Hello__MVI_0001.MOV")
    assert res.status_code == 200 and res.content == b"fake video"


@pytest.mark.parametrize("path", ["hello/..%2F..%2Fsecret.MOV", "HELLO/x.MOV", "hello/notes.txt", "hello/missing.MOV"])
def test_rejects_bad_or_missing_video_paths(path):
    assert client.get(f"/api/dataset/include/videos/{path}").status_code == 404


def test_save_rejects_unknown_video():
    res = client.post(
        "/api/dataset/include/landmarks",
        json={"sign": "hello", "file": "nope.MOV", "extractorVersion": VERSION, "fps": 25, "frames": frames()},
    )
    assert res.status_code == 404
