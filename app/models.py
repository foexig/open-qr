"""SQLAlchemy ORM models."""

from datetime import UTC, datetime

from sqlalchemy import (
    BigInteger,
    MetaData,
    Boolean,
    DateTime,
    ForeignKey,
    Index,
    LargeBinary,
    String,
    Text,
    false,
    func,
    true,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import DeclarativeBase, Mapped, column_property, mapped_column, relationship


def utcnow() -> datetime:
    return datetime.now(UTC)


# Matches the constraint names used in the Alembic migrations.
NAMING_CONVENTION = {
    "ix": "ix_%(table_name)s_%(column_0_name)s",
    "uq": "uq_%(table_name)s_%(column_0_name)s",
    "fk": "fk_%(table_name)s_%(column_0_name)s",
    "pk": "%(table_name)s_pkey",
}


class Base(DeclarativeBase):
    metadata = MetaData(naming_convention=NAMING_CONVENTION)


class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(primary_key=True)
    username: Mapped[str] = mapped_column(String(64), unique=True)
    email: Mapped[str | None] = mapped_column(String(255), unique=True)
    password_hash: Mapped[str] = mapped_column(String(255))
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, server_default=true())
    is_admin: Mapped[bool] = mapped_column(Boolean, default=False, server_default=false())
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, server_default=func.now()
    )

    qr_codes: Mapped[list["QRCode"]] = relationship(back_populates="user", passive_deletes=True)


class UserSession(Base):
    """Server-side login session. Only a SHA-256 hash of the cookie token is stored."""

    __tablename__ = "sessions"

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    token_hash: Mapped[str] = mapped_column(String(64), unique=True)
    csrf_token: Mapped[str] = mapped_column(String(64))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, server_default=func.now()
    )
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True)

    user: Mapped[User] = relationship(lazy="joined")


class QRCode(Base):
    __tablename__ = "qr_codes"
    __table_args__ = (Index("ix_qr_codes_user_id_created_at", "user_id", "created_at"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    code: Mapped[str] = mapped_column(String(32), unique=True)
    name: Mapped[str] = mapped_column(String(120))
    description: Mapped[str] = mapped_column(Text, default="", server_default="")
    target_url: Mapped[str] = mapped_column(String(2048))
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, server_default=true())
    # Visual style (see qr_image.QRStyle); NULL means the classic black-on-white look.
    style: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    # Optional centre logo, always a re-encoded PNG (see qr_image.clean_logo). Deferred so
    # list queries never load the bytes; has_logo is computed in SQL instead.
    logo: Mapped[bytes | None] = mapped_column(LargeBinary, nullable=True, deferred=True)
    has_logo: Mapped[bool] = column_property(logo.is_not(None))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, onupdate=utcnow, server_default=func.now()
    )
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))

    user: Mapped[User] = relationship(back_populates="qr_codes")
    scans: Mapped[list["Scan"]] = relationship(back_populates="qr_code", passive_deletes=True)


class Scan(Base):
    __tablename__ = "scans"
    __table_args__ = (Index("ix_scans_qr_code_id_scanned_at", "qr_code_id", "scanned_at"),)

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    qr_code_id: Mapped[int] = mapped_column(ForeignKey("qr_codes.id", ondelete="CASCADE"))
    scanned_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, server_default=func.now(), index=True
    )
    user_agent: Mapped[str | None] = mapped_column(String(512))
    device_type: Mapped[str | None] = mapped_column(String(16))
    browser: Mapped[str | None] = mapped_column(String(32))
    referrer: Mapped[str | None] = mapped_column(String(255))
    is_bot: Mapped[bool] = mapped_column(Boolean, default=False, server_default=false())

    qr_code: Mapped[QRCode] = relationship(back_populates="scans")
