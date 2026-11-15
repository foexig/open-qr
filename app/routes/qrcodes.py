"""Authenticated management API for QR codes."""

import re
from datetime import datetime
from typing import Annotated, Literal

from fastapi import APIRouter, HTTPException, Query, Response, status
from sqlalchemy import Select, func, or_, select
from sqlalchemy.exc import IntegrityError

from .. import stats
from ..config import get_settings
from ..deps import DB, CurrentUser
from ..models import QRCode, Scan
from ..qr_image import ErrorLevel, render
from ..schemas import QRCodeCreate, QRCodeOut, QRCodeUpdate
from ..util import generate_code

router = APIRouter(prefix="/api", tags=["qr-codes"])


def _with_counts(stmt_filter) -> Select:
    counts = (
        select(
            Scan.qr_code_id.label("qid"),
            func.count(Scan.id).label("n"),
            func.max(Scan.scanned_at).label("last"),
        )
        .group_by(Scan.qr_code_id)
        .subquery()
    )
    return (
        select(QRCode, func.coalesce(counts.c.n, 0).label("scan_count"), counts.c.last)
        .outerjoin(counts, counts.c.qid == QRCode.id)
        .where(*stmt_filter)
    )


def _out(qr: QRCode, scan_count: int = 0, last_scan_at: datetime | None = None) -> QRCodeOut:
    return QRCodeOut(
        id=qr.id,
        code=qr.code,
        short_url=get_settings().short_url(qr.code),
        name=qr.name,
        description=qr.description,
        target_url=qr.target_url,
        is_active=qr.is_active,
        created_at=qr.created_at,
        updated_at=qr.updated_at,
        scan_count=scan_count,
        last_scan_at=last_scan_at,
    )


def _get_owned(db: DB, user_id: int, qr_id: int) -> QRCode:
    qr = db.scalar(select(QRCode).where(QRCode.id == qr_id, QRCode.user_id == user_id))
    if qr is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "QR code not found")
    return qr


def _reject_self_redirect(url: str) -> None:
    prefix = get_settings().public_base_url.lower() + "/r/"
    if url.lower().startswith(prefix):
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_CONTENT, "Target URL must not point to another QR code"
        )


@router.get("/qr-codes", response_model=list[QRCodeOut])
def list_qr_codes(
    user: CurrentUser,
    db: DB,
    q: Annotated[str | None, Query(max_length=200)] = None,
    sort: Literal["created", "name", "scans"] = "created",
    limit: Annotated[int, Query(ge=1, le=1000)] = 500,
) -> list[QRCodeOut]:
    filters = [QRCode.user_id == user.id]
    if q:
        like = f"%{q.strip()}%"
        filters.append(
            or_(QRCode.name.ilike(like), QRCode.target_url.ilike(like), QRCode.code.ilike(like))
        )
    stmt = _with_counts(filters)
    if sort == "name":
        stmt = stmt.order_by(func.lower(QRCode.name))
    elif sort == "scans":
        stmt = stmt.order_by(stmt.selected_columns.scan_count.desc(), QRCode.id.desc())
    else:
        stmt = stmt.order_by(QRCode.created_at.desc(), QRCode.id.desc())
    rows = db.execute(stmt.limit(limit)).all()
    return [_out(qr, n, last) for qr, n, last in rows]


@router.post("/qr-codes", response_model=QRCodeOut, status_code=status.HTTP_201_CREATED)
def create_qr_code(payload: QRCodeCreate, user: CurrentUser, db: DB) -> QRCodeOut:
    _reject_self_redirect(payload.target_url)
    length = get_settings().code_length
    for _ in range(8):
        qr = QRCode(
            code=generate_code(length),
            name=payload.name,
            description=payload.description,
            target_url=payload.target_url,
            is_active=payload.is_active,
            user_id=user.id,
        )
        db.add(qr)
        try:
            db.commit()
        except IntegrityError:
            db.rollback()  # code collision, try again
            continue
        return _out(qr)
    raise HTTPException(status.HTTP_500_INTERNAL_SERVER_ERROR, "Could not allocate a unique code")


@router.get("/qr-codes/{qr_id}", response_model=QRCodeOut)
def get_qr_code(qr_id: int, user: CurrentUser, db: DB) -> QRCodeOut:
    row = db.execute(_with_counts([QRCode.id == qr_id, QRCode.user_id == user.id])).first()
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "QR code not found")
    return _out(*row)


@router.patch("/qr-codes/{qr_id}", response_model=QRCodeOut)
def update_qr_code(qr_id: int, payload: QRCodeUpdate, user: CurrentUser, db: DB) -> QRCodeOut:
    qr = _get_owned(db, user.id, qr_id)
    data = payload.model_dump(exclude_unset=True, exclude_none=True)
    if "target_url" in data:
        _reject_self_redirect(data["target_url"])
    for key, value in data.items():
        setattr(qr, key, value)
    db.commit()
    return get_qr_code(qr_id, user, db)


@router.delete("/qr-codes/{qr_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_qr_code(qr_id: int, user: CurrentUser, db: DB) -> Response:
    qr = _get_owned(db, user.id, qr_id)
    db.delete(qr)
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


def _filename(name: str, code: str, ext: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")[:40] or "qr"
    return f"{slug}-{code}.{ext}"


@router.get("/qr-codes/{qr_id}/image.{fmt}")
def qr_image(
    qr_id: int,
    fmt: Literal["png", "svg"],
    user: CurrentUser,
    db: DB,
    size: Annotated[int, Query(ge=64, le=4096)] = 512,
    ec: ErrorLevel = "M",
    border: Annotated[int, Query(ge=0, le=20)] = 4,
    download: bool = False,
) -> Response:
    qr = _get_owned(db, user.id, qr_id)
    content = render(get_settings().short_url(qr.code), fmt, size, ec, border)
    headers = {"Cache-Control": "private, max-age=300"}
    if download:
        headers["Content-Disposition"] = f'attachment; filename="{_filename(qr.name, qr.code, fmt)}"'
    media = "image/png" if fmt == "png" else "image/svg+xml"
    return Response(content, media_type=media, headers=headers)


@router.get("/qr-codes/{qr_id}/stats")
def qr_stats(
    qr_id: int, user: CurrentUser, db: DB, days: Annotated[int, Query(ge=7, le=365)] = 30
) -> dict:
    qr = _get_owned(db, user.id, qr_id)
    return stats.qr_code_stats(db, qr.id, get_settings().stats_timezone, days)


@router.get("/stats/overview")
def overview(
    user: CurrentUser, db: DB, days: Annotated[int, Query(ge=7, le=365)] = 30
) -> dict:
    data = stats.user_overview(db, user.id, get_settings().stats_timezone, days)
    recent = db.execute(
        _with_counts([QRCode.user_id == user.id])
        .order_by(QRCode.created_at.desc(), QRCode.id.desc())
        .limit(5)
    ).all()
    top_stmt = _with_counts([QRCode.user_id == user.id])
    top = db.execute(
        top_stmt.order_by(top_stmt.selected_columns.scan_count.desc(), QRCode.id.desc()).limit(5)
    ).all()
    data["recent"] = [_out(*r).model_dump(mode="json") for r in recent]
    data["top"] = [_out(*r).model_dump(mode="json") for r in top if r[1] > 0]
    return data
