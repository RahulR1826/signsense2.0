import uuid

from pydantic import BaseModel, ConfigDict, EmailStr, Field, field_validator

from app.models import CommunicationMode


class SignupIn(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    email: EmailStr
    password: str = Field(min_length=8, max_length=128)

    @field_validator("name")
    @classmethod
    def strip_name(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("name is required")
        return v


class ProfileIn(BaseModel):
    name: str = Field(min_length=1, max_length=80)

    @field_validator("name")
    @classmethod
    def strip_name(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("name is required")
        return v


class DeleteAccountIn(BaseModel):
    password: str = Field(min_length=1, max_length=128)


class LoginIn(BaseModel):
    email: EmailStr
    password: str = Field(max_length=128)


class PreferencesIn(BaseModel):
    mode: CommunicationMode
    sign_language: str = Field(default="ISL", pattern=r"^ISL$")  # only ISL is supported
    sign_to_text: bool = True
    text_to_sign: bool = True


class PreferencesOut(PreferencesIn):
    model_config = ConfigDict(from_attributes=True)


class UserOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    name: str
    email: str
    preferences: PreferencesOut | None = None
