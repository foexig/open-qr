"""Public redirect endpoint: GET /r/{code}."""

import logging

from fastapi import APIRouter, Request, Response
from fastapi.responses import RedirectResponse
from sqlalchemy import select
from sqlalchemy.exc import SQLAlchemyError

from ..config import get_settings
from ..deps import DB
from ..errors import error_page
from ..models import QRCode, Scan
from ..util import CODE_PATTERN, classify_user_agent, referrer_host

log = logging.getLogger("open_qr.redirect")
router = APIRouter(tags=["redirect"])

NO_CACHE = {"Cache-Control": "no-store, private", "Referrer-Policy": "no-referrer"}


@router.api_route("/r/{code}", methods=["GET", "HEAD"], include_in_schema=False)
def redirect(code: str, request: Request, db: DB) -> Response:
    if not CODE_PATTERN.fullmatch(code):
        return error_page(404, "QR code not found", "This QR code does not exist.")
    qr = db.scalar(select(QRCode).where(QRCode.code == code))
    if qr is None:
        return error_page(404, "QR code not found", "This QR code does not exist.")
    if not qr.is_active:
        return error_page(
            410, "QR code deactivated", "This QR code has been deactivated by its owner."
        )

    # HEAD requests come from link checkers and previews; they are not counted.
    if request.method == "GET":
        settings = get_settings()
        ua = request.headers.get("user-agent", "")
        info = classify_user_agent(ua)
        db.add(
            Scan(
                qr_code_id=qr.id,
                user_agent=ua[:512] if settings.store_user_agent and ua else None,
                device_type=info.device_type,
                browser=info.browser,
                is_bot=info.is_bot,
                referrer=referrer_host(request.headers.get("referer"))
                if settings.store_referrer
                else None,
            )
        )
        try:
            db.commit()
        except SQLAlchemyError:
            # Statistics must never break the redirect itself.
            db.rollback()
            log.exception("Failed to record scan for code %s", code)

    return RedirectResponse(qr.target_url, status_code=302, headers=NO_CACHE)
