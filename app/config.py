"""Application settings, read from environment variables."""

from functools import lru_cache
from urllib.parse import urlsplit
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(extra="ignore")

    # Required. Example: postgresql+psycopg://openqr:secret@db:5432/openqr
    database_url: str

    # Base URL that is encoded into every QR code, e.g. https://qr.example.com
    public_base_url: str = "http://localhost:8000"

    # Length of the random public code in /r/{code}
    code_length: int = Field(7, ge=5, le=32)

    session_lifetime_hours: int = Field(168, ge=1, le=24 * 90)
    # None = derive from PUBLIC_BASE_URL (https -> secure cookies)
    cookie_secure: bool | None = None

    # Privacy: raw user agents are not stored by default, only device/browser class.
    store_user_agent: bool = False
    # Only the referrer host is stored, never the full URL.
    store_referrer: bool = True

    stats_timezone: str = "UTC"

    login_max_attempts: int = Field(10, ge=1)
    login_window_seconds: int = Field(900, ge=1)

    enable_api_docs: bool = False

    setup_token_file: str = "/tmp/open-qr-setup-token"

    @field_validator("public_base_url")
    @classmethod
    def _check_base_url(cls, v: str) -> str:
        v = v.strip().rstrip("/")
        parts = urlsplit(v)
        if parts.scheme not in ("http", "https") or not parts.netloc:
            raise ValueError("PUBLIC_BASE_URL must be an absolute http(s) URL")
        return v

    @field_validator("stats_timezone")
    @classmethod
    def _check_tz(cls, v: str) -> str:
        try:
            ZoneInfo(v)
        except (ZoneInfoNotFoundError, ValueError) as exc:
            raise ValueError(f"Unknown STATS_TIMEZONE: {v}") from exc
        return v

    @property
    def secure_cookies(self) -> bool:
        if self.cookie_secure is not None:
            return self.cookie_secure
        return self.public_base_url.startswith("https://")

    def short_url(self, code: str) -> str:
        return f"{self.public_base_url}/r/{code}"


@lru_cache
def get_settings() -> Settings:
    return Settings()
