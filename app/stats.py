"""Scan statistics queries (PostgreSQL)."""

from datetime import date, datetime, time, timedelta
from typing import Any, Literal
from zoneinfo import ZoneInfo

from sqlalchemy import ColumnElement, func, select
from sqlalchemy.orm import Session

from .models import QRCode, Scan

Unit = Literal["day", "week", "month"]


def _period_start(d: date, unit: Unit) -> date:
    if unit == "week":
        return d - timedelta(days=d.weekday())
    if unit == "month":
        return d.replace(day=1)
    return d


def _shift(d: date, unit: Unit, n: int) -> date:
    """Move a period start by n periods (n may be negative)."""
    if unit == "day":
        return d + timedelta(days=n)
    if unit == "week":
        return d + timedelta(weeks=n)
    month = d.month - 1 + n
    return date(d.year + month // 12, month % 12 + 1, 1)


def _local_start(d: date, tz: str) -> datetime:
    return datetime.combine(d, time.min, tzinfo=ZoneInfo(tz))


def time_series(
    db: Session, where: list[ColumnElement[bool]], unit: Unit, periods: int, tz: str
) -> list[dict[str, Any]]:
    today = datetime.now(ZoneInfo(tz)).date()
    last = _period_start(today, unit)
    first = _shift(last, unit, -(periods - 1))
    bucket = func.date_trunc(unit, func.timezone(tz, Scan.scanned_at)).label("bucket")
    rows = db.execute(
        select(bucket, func.count(Scan.id), func.count(Scan.id).filter(Scan.is_bot))
        .where(*where, Scan.scanned_at >= _local_start(first, tz))
        .group_by(bucket)
    ).all()
    found = {row[0].date(): (row[1], row[2]) for row in rows}
    out = []
    d = first
    for _ in range(periods):
        total, bots = found.get(d, (0, 0))
        out.append({"period": d.isoformat(), "count": total, "bots": bots})
        d = _shift(d, unit, 1)
    return out


def _count_since(db: Session, where: list[ColumnElement[bool]], since: datetime | None) -> int:
    stmt = select(func.count(Scan.id)).where(*where)
    if since is not None:
        stmt = stmt.where(Scan.scanned_at >= since)
    return db.scalar(stmt) or 0


def _breakdown(db: Session, where: list[ColumnElement[bool]], column, limit: int = 8) -> list[dict]:
    rows = db.execute(
        select(column, func.count(Scan.id).label("n"))
        .where(*where, column.is_not(None))
        .group_by(column)
        .order_by(func.count(Scan.id).desc())
        .limit(limit)
    ).all()
    return [{"label": r[0], "count": r[1]} for r in rows]


def summary(db: Session, where: list[ColumnElement[bool]], tz: str) -> dict[str, Any]:
    today = datetime.now(ZoneInfo(tz)).date()
    return {
        "total": _count_since(db, where, None),
        "likely_bots": _count_since(db, [*where, Scan.is_bot.is_(True)], None),
        "today": _count_since(db, where, _local_start(today, tz)),
        "this_week": _count_since(db, where, _local_start(_period_start(today, "week"), tz)),
        "this_month": _count_since(db, where, _local_start(_period_start(today, "month"), tz)),
        "last_scan_at": db.scalar(select(func.max(Scan.scanned_at)).where(*where)),
    }


def qr_code_stats(db: Session, qr_id: int, tz: str, days: int) -> dict[str, Any]:
    where = [Scan.qr_code_id == qr_id]
    return {
        **summary(db, where, tz),
        "timezone": tz,
        "daily": time_series(db, where, "day", days, tz),
        "weekly": time_series(db, where, "week", 12, tz),
        "monthly": time_series(db, where, "month", 12, tz),
        "devices": _breakdown(db, where, Scan.device_type),
        "browsers": _breakdown(db, where, Scan.browser),
        "referrers": _breakdown(db, where, Scan.referrer),
    }


def user_overview(db: Session, user_id: int, tz: str, days: int) -> dict[str, Any]:
    owned = select(QRCode.id).where(QRCode.user_id == user_id)
    where = [Scan.qr_code_id.in_(owned)]
    total_codes = db.scalar(select(func.count(QRCode.id)).where(QRCode.user_id == user_id)) or 0
    active_codes = (
        db.scalar(
            select(func.count(QRCode.id)).where(QRCode.user_id == user_id, QRCode.is_active)
        )
        or 0
    )
    return {
        "total_codes": total_codes,
        "active_codes": active_codes,
        "scans": summary(db, where, tz),
        "timezone": tz,
        "daily": time_series(db, where, "day", days, tz),
    }
