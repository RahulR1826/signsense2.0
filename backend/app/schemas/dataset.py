from typing import Annotated

from pydantic import BaseModel, Field, StringConstraints, ValidationInfo, field_validator

# Flat per-frame arrays; layout is defined in frontend/lib/landmarks/schema.ts.
HAND_LEN = 21 * 3
POSE_LEN = 33 * 4
FACE_LEN = 72 * 3

Slug = Annotated[str, StringConstraints(pattern=r"^[a-z0-9_-]{1,32}$")]

EXPECTED_LEN = {"leftHand": HAND_LEN, "rightHand": HAND_LEN, "pose": POSE_LEN, "face": FACE_LEN}


class LandmarkFrame(BaseModel):
    t: float = Field(ge=0)
    leftHand: list[float] | None = None
    rightHand: list[float] | None = None
    pose: list[float] | None = None
    face: list[float] | None = None

    @field_validator("leftHand", "rightHand", "pose", "face")
    @classmethod
    def check_length(cls, v: list[float] | None, info: ValidationInfo) -> list[float] | None:
        expected = EXPECTED_LEN[info.field_name]
        if v is not None and len(v) != expected:
            raise ValueError(f"{info.field_name} must have {expected} values, got {len(v)}")
        return v


class SampleIn(BaseModel):
    sign: Slug
    signer: Slug
    extractorVersion: str = Field(max_length=100)
    durationMs: float = Field(gt=0, le=20_000)
    # Camera frame size: landmarks are normalised per axis, so training needs the aspect ratio.
    width: int | None = Field(default=None, gt=0, le=10_000)
    height: int | None = Field(default=None, gt=0, le=10_000)
    frames: list[LandmarkFrame] = Field(min_length=5, max_length=600)


class SampleOut(BaseModel):
    id: str
    sign: str
    signer: str


class Sign(BaseModel):
    id: str
    label: str
    category: str


class DatasetSummary(BaseModel):
    total: int
    # counts[sign][signer] = number of samples
    counts: dict[str, dict[str, int]]
