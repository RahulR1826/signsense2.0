import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.schemas.dataset import LandmarkFrame

MAX_SIGNS_PER_USER = 20
MIN_SAMPLES, MAX_SAMPLES = 3, 5
# Segments arrive at ~15 fps and are cut at 4 s by the segmenter (plus pre/post-roll): 90 frames is plenty.
MIN_FRAMES, MAX_FRAMES = 6, 90


class PersonalSampleIn(BaseModel):
    aspect: float = Field(gt=0.2, lt=5)
    frames: list[LandmarkFrame] = Field(min_length=MIN_FRAMES, max_length=MAX_FRAMES)


class PersonalSignIn(BaseModel):
    label: str = Field(min_length=1, max_length=40)
    emoji: str | None = Field(default=None, max_length=16)
    extractorVersion: str = Field(min_length=1, max_length=100)
    samples: list[PersonalSampleIn] = Field(min_length=MIN_SAMPLES, max_length=MAX_SAMPLES)

    @field_validator("label")
    @classmethod
    def clean_label(cls, v: str) -> str:
        v = " ".join(v.split())
        if not v:
            raise ValueError("label is required")
        return v


class PersonalSampleOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    aspect: float
    extractor_version: str
    frames: list


class PersonalSignOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    label: str
    emoji: str | None
    created_at: datetime
    samples: list[PersonalSampleOut]
