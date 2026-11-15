"""Initial schema: users, sessions, qr_codes, scans.

Revision ID: 0001_initial
Revises:
Create Date: 2026-11-15
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0001_initial"
down_revision: str | None = None
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "users",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("username", sa.String(64), nullable=False),
        sa.Column("email", sa.String(255), nullable=True),
        sa.Column("password_hash", sa.String(255), nullable=False),
        sa.Column("is_active", sa.Boolean(), server_default=sa.true(), nullable=False),
        sa.Column("is_admin", sa.Boolean(), server_default=sa.false(), nullable=False),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.UniqueConstraint("username", name="uq_users_username"),
        sa.UniqueConstraint("email", name="uq_users_email"),
    )

    op.create_table(
        "sessions",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column(
            "user_id",
            sa.Integer(),
            sa.ForeignKey("users.id", ondelete="CASCADE", name="fk_sessions_user_id"),
            nullable=False,
        ),
        sa.Column("token_hash", sa.String(64), nullable=False),
        sa.Column("csrf_token", sa.String(64), nullable=False),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint("token_hash", name="uq_sessions_token_hash"),
    )
    op.create_index("ix_sessions_user_id", "sessions", ["user_id"])
    op.create_index("ix_sessions_expires_at", "sessions", ["expires_at"])

    op.create_table(
        "qr_codes",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("code", sa.String(32), nullable=False),
        sa.Column("name", sa.String(120), nullable=False),
        sa.Column("description", sa.Text(), server_default="", nullable=False),
        sa.Column("target_url", sa.String(2048), nullable=False),
        sa.Column("is_active", sa.Boolean(), server_default=sa.true(), nullable=False),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.Column(
            "user_id",
            sa.Integer(),
            sa.ForeignKey("users.id", ondelete="CASCADE", name="fk_qr_codes_user_id"),
            nullable=False,
        ),
        sa.UniqueConstraint("code", name="uq_qr_codes_code"),
    )
    op.create_index("ix_qr_codes_user_id_created_at", "qr_codes", ["user_id", "created_at"])

    op.create_table(
        "scans",
        sa.Column("id", sa.BigInteger(), primary_key=True),
        sa.Column(
            "qr_code_id",
            sa.Integer(),
            sa.ForeignKey("qr_codes.id", ondelete="CASCADE", name="fk_scans_qr_code_id"),
            nullable=False,
        ),
        sa.Column(
            "scanned_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.Column("user_agent", sa.String(512), nullable=True),
        sa.Column("device_type", sa.String(16), nullable=True),
        sa.Column("browser", sa.String(32), nullable=True),
        sa.Column("referrer", sa.String(255), nullable=True),
        sa.Column("is_bot", sa.Boolean(), server_default=sa.false(), nullable=False),
    )
    op.create_index("ix_scans_qr_code_id_scanned_at", "scans", ["qr_code_id", "scanned_at"])
    op.create_index("ix_scans_scanned_at", "scans", ["scanned_at"])


def downgrade() -> None:
    op.drop_table("scans")
    op.drop_table("qr_codes")
    op.drop_table("sessions")
    op.drop_table("users")
