from fastapi import APIRouter, HTTPException, Query, status
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field

from app.core.config import settings
from app.schemas.dataset import LandmarkFrame
from app.services import include_import

# Dev-only (mounted when ENABLE_DEV_TOOLS is true): used to build the training set on a developer machine.
router = APIRouter(prefix="/dataset/include", tags=["dataset"])


class Pending(BaseModel):
    done: int
    todo: list[dict[str, str]]


class LandmarksIn(BaseModel):
    sign: str
    file: str
    extractorVersion: str = Field(max_length=100)
    fps: float = Field(gt=0, le=120)
    frames: list[LandmarkFrame] = Field(min_length=1, max_length=2000)


@router.get("/pending")
def pending(extractor_version: str = Query(max_length=100)) -> Pending:
    todo, done = include_import.pending(settings.include_dir, extractor_version)
    return Pending(done=done, todo=todo)


@router.get("/videos/{sign}/{file}")
def video(sign: str, file: str) -> FileResponse:
    path = include_import.video_path(settings.include_dir, sign, file)
    if path is None:
        raise HTTPException(status_code=404, detail="video not found")
    return FileResponse(path, media_type="video/mp4")


@router.post("/landmarks", status_code=status.HTTP_201_CREATED)
def save_landmarks(body: LandmarksIn) -> dict[str, str]:
    if include_import.video_path(settings.include_dir, body.sign, body.file) is None:
        raise HTTPException(status_code=404, detail="video not found")
    include_import.save(settings.include_dir, body.sign, body.file, body.extractorVersion, body.fps, body.frames)
    return {"status": "saved"}
