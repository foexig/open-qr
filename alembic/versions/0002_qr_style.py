"""Add qr_codes.style and qr_codes.logo for styled QR codes.

Revision ID: 0002_qr_style
Revises: 0001_initial
Create Date: 2026-11-15
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0002_qr_style"
down_revision: str | None = "0001_initial"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("qr_codes", sa.Column("style", postgresql.JSONB(), nullable=True))
    op.add_column("qr_codes", sa.Column("logo", sa.LargeBinary(), nullable=True))


def downgrade() -> None:
    op.drop_column("qr_codes", "logo")
    op.drop_column("qr_codes", "style")
