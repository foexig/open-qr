"""Pydantic request/response models."""

from datetime import datetime

from pydantic import BaseModel, ConfigDict, EmailStr, Field, field_validator

from .qr_image import ErrorLevel, QRStyle
from .security import MIN_PASSWORD_LENGTH
from .util import validate_target_url

USERNAME_PATTERN = r"^[A-Za-z0-9_.-]{3,64}$"


class UserOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    username: str
    email: str | None
    is_admin: bool
    created_at: datetime


class LoginIn(BaseModel):
    username: str = Field(min_length=1, max_length=64)
    password: str = Field(min_length=1, max_length=1024)


class SetupIn(BaseModel):
    setup_token: str = Field(min_length=1, max_length=256)
    username: str = Field(pattern=USERNAME_PATTERN)
    email: EmailStr | None = None
    password: str = Field(min_length=MIN_PASSWORD_LENGTH, max_length=1024)


class ChangePasswordIn(BaseModel):
    current_password: str = Field(min_length=1, max_length=1024)
    new_password: str = Field(min_length=MIN_PASSWORD_LENGTH, max_length=1024)


class SessionOut(BaseModel):
    user: UserOut
    csrf_token: str


class AuthStatus(BaseModel):
    setup_required: bool
    authenticated: bool
    user: UserOut | None = None
    csrf_token: str | None = None


def _clean_name(v: str) -> str:
    v = v.strip()
    if not v:
        raise ValueError("Name must not be empty")
    return v


class QRCodeCreate(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    description: str = Field("", max_length=2000)
    target_url: str = Field(max_length=4096)
    is_active: bool = True
    style: QRStyle | None = None

    @field_validator("name")
    @classmethod
    def _name(cls, v: str) -> str:
        return _clean_name(v)

    @field_validator("target_url")
    @classmethod
    def _url(cls, v: str) -> str:
        return validate_target_url(v)

    @field_validator("description")
    @classmethod
    def _desc(cls, v: str) -> str:
        return v.strip()


class QRCodeUpdate(BaseModel):
    name: str | None = Field(None, min_length=1, max_length=120)
    description: str | None = Field(None, max_length=2000)
    target_url: str | None = Field(None, max_length=4096)
    is_active: bool | None = None
    # Explicit null resets to the classic style.
    style: QRStyle | None = None

    @field_validator("name")
    @classmethod
    def _name(cls, v: str | None) -> str | None:
        return None if v is None else _clean_name(v)

    @field_validator("target_url")
    @classmethod
    def _url(cls, v: str | None) -> str | None:
        return None if v is None else validate_target_url(v)

    @field_validator("description")
    @classmethod
    def _desc(cls, v: str | None) -> str | None:
        return None if v is None else v.strip()


class QRCodeOut(BaseModel):
    id: int
    code: str
    short_url: str
    name: str
    description: str
    target_url: str
    is_active: bool
    created_at: datetime
    updated_at: datetime
    scan_count: int = 0
    last_scan_at: datetime | None = None
    style: QRStyle
    has_logo: bool = False


class StylePreviewIn(BaseModel):
    style: QRStyle
    ec: ErrorLevel = "M"
    border: int = Field(4, ge=0, le=20)
