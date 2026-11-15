"""FastAPI application entry point."""

import logging
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from sqlalchemy import text
from sqlalchemy.exc import SQLAlchemyError

from . import setup_state
from .config import get_settings
from .db import get_sessionmaker
from .routes import auth, qrcodes, redirect

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
log = logging.getLogger("open_qr")

STATIC_DIR = Path(__file__).parent / "static"

CSP = (
    "default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; "
    "connect-src 'self'; font-src 'self'; object-src 'none'; base-uri 'none'; "
    "form-action 'self'; frame-ancestors 'none'"
)


@asynccontextmanager
async def lifespan(_app: FastAPI):
    setup_state.init_if_needed()
    log.info("open-qr ready, public base URL: %s", get_settings().public_base_url)
    yield


def create_app() -> FastAPI:
    settings = get_settings()
    docs = settings.enable_api_docs
    app = FastAPI(
        title="open-qr",
        version="1.0.0",
        lifespan=lifespan,
        docs_url="/api/docs" if docs else None,
        redoc_url=None,
        openapi_url="/api/openapi.json" if docs else None,
    )

    @app.middleware("http")
    async def security_headers(request: Request, call_next):
        response = await call_next(request)
        response.headers.setdefault("X-Content-Type-Options", "nosniff")
        response.headers.setdefault("X-Frame-Options", "DENY")
        response.headers.setdefault("Referrer-Policy", "same-origin")
        response.headers.setdefault("Permissions-Policy", "camera=(), microphone=(), geolocation=()")
        if not request.url.path.startswith("/api/docs"):
            response.headers.setdefault("Content-Security-Policy", CSP)
        if request.url.path.startswith("/api/"):
            response.headers.setdefault("Cache-Control", "no-store")
        elif request.url.path.startswith("/static/"):
            # Revalidate via ETag so upgrades are picked up without a hard reload.
            response.headers.setdefault("Cache-Control", "no-cache")
        return response

    app.include_router(auth.router)
    app.include_router(qrcodes.router)
    app.include_router(redirect.router)
    app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")

    @app.get("/healthz", include_in_schema=False)
    def healthz() -> JSONResponse:
        try:
            with get_sessionmaker()() as db:
                db.execute(text("SELECT 1"))
        except SQLAlchemyError:
            log.exception("Health check: database unreachable")
            return JSONResponse({"status": "error", "database": "unreachable"}, status_code=503)
        return JSONResponse({"status": "ok"})

    @app.get("/", include_in_schema=False)
    def index() -> FileResponse:
        return FileResponse(STATIC_DIR / "index.html", headers={"Cache-Control": "no-cache"})

    return app


app = create_app()
