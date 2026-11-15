"""Authentication: first-run setup, login, logout, session status, password change."""

import hmac
import logging
from datetime import timedelta

from fastapi import APIRouter, HTTPException, Request, Response, status
from sqlalchemy import delete, select, text
from sqlalchemy.exc import IntegrityError

from .. import setup_state
from ..config import get_settings
from ..deps import DB, SESSION_COOKIE, Auth
from ..models import User, UserSession, utcnow
from ..schemas import AuthStatus, ChangePasswordIn, LoginIn, SessionOut, SetupIn, UserOut
from ..security import (
    hash_password,
    hash_token,
    login_limiter,
    new_token,
    password_needs_rehash,
    verify_password,
)

log = logging.getLogger("open_qr.auth")
router = APIRouter(prefix="/api/auth", tags=["auth"])


def _client_key(request: Request) -> str:
    return request.client.host if request.client else "unknown"


def _start_session(db: DB, response: Response, user: User) -> SessionOut:
    settings = get_settings()
    now = utcnow()
    db.execute(delete(UserSession).where(UserSession.expires_at <= now))
    token = new_token()
    sess = UserSession(
        user_id=user.id,
        token_hash=hash_token(token),
        csrf_token=new_token(),
        expires_at=now + timedelta(hours=settings.session_lifetime_hours),
    )
    db.add(sess)
    db.commit()
    response.set_cookie(
        SESSION_COOKIE,
        token,
        max_age=settings.session_lifetime_hours * 3600,
        httponly=True,
        secure=settings.secure_cookies,
        samesite="strict",
        path="/",
    )
    return SessionOut(user=UserOut.model_validate(user), csrf_token=sess.csrf_token)


@router.get("/status", response_model=AuthStatus)
def auth_status(request: Request, db: DB) -> AuthStatus:
    setup_required = not setup_state.users_exist(db)
    token = request.cookies.get(SESSION_COOKIE)
    if token and not setup_required:
        sess = db.scalar(
            select(UserSession).where(
                UserSession.token_hash == hash_token(token), UserSession.expires_at > utcnow()
            )
        )
        if sess and sess.user.is_active:
            return AuthStatus(
                setup_required=False,
                authenticated=True,
                user=UserOut.model_validate(sess.user),
                csrf_token=sess.csrf_token,
            )
    return AuthStatus(setup_required=setup_required, authenticated=False)


@router.post("/setup", response_model=SessionOut, status_code=status.HTTP_201_CREATED)
def setup(payload: SetupIn, request: Request, response: Response, db: DB) -> SessionOut:
    settings = get_settings()
    key = "setup:" + _client_key(request)
    if login_limiter.is_blocked(key, settings.login_max_attempts, settings.login_window_seconds):
        raise HTTPException(status.HTTP_429_TOO_MANY_REQUESTS, "Too many attempts, try later")
    # Serialize concurrent setup attempts so only one admin can be created.
    db.execute(text("SELECT pg_advisory_xact_lock(727401)"))
    if setup_state.users_exist(db):
        raise HTTPException(status.HTTP_409_CONFLICT, "Setup has already been completed")
    expected = setup_state.get_token()
    if not expected or not hmac.compare_digest(payload.setup_token.encode(), expected.encode()):
        login_limiter.record_failure(key, settings.login_window_seconds)
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Invalid setup token")
    user = User(
        username=payload.username,
        email=str(payload.email).lower() if payload.email else None,
        password_hash=hash_password(payload.password),
        is_admin=True,
    )
    db.add(user)
    try:
        db.flush()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(status.HTTP_409_CONFLICT, "User already exists") from exc
    out = _start_session(db, response, user)
    setup_state.clear()
    log.info("Initial admin account %r created", user.username)
    return out


@router.post("/login", response_model=SessionOut)
def login(payload: LoginIn, request: Request, response: Response, db: DB) -> SessionOut:
    settings = get_settings()
    key = "login:" + _client_key(request)
    if login_limiter.is_blocked(key, settings.login_max_attempts, settings.login_window_seconds):
        raise HTTPException(status.HTTP_429_TOO_MANY_REQUESTS, "Too many attempts, try later")
    user = db.scalar(select(User).where(User.username == payload.username))
    ok = verify_password(user.password_hash if user else None, payload.password)
    if not user or not ok or not user.is_active:
        login_limiter.record_failure(key, settings.login_window_seconds)
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid username or password")
    login_limiter.reset(key)
    if password_needs_rehash(user.password_hash):
        user.password_hash = hash_password(payload.password)
    return _start_session(db, response, user)


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
def logout(auth: Auth, db: DB) -> Response:
    db.delete(auth.session)
    db.commit()
    response = Response(status_code=status.HTTP_204_NO_CONTENT)
    response.delete_cookie(SESSION_COOKIE, path="/")
    return response


@router.get("/me", response_model=SessionOut)
def me(auth: Auth) -> SessionOut:
    return SessionOut(user=UserOut.model_validate(auth.user), csrf_token=auth.session.csrf_token)


@router.post("/change-password", status_code=status.HTTP_204_NO_CONTENT)
def change_password(payload: ChangePasswordIn, auth: Auth, db: DB) -> Response:
    user = auth.user
    if not verify_password(user.password_hash, payload.current_password):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Current password is incorrect")
    user.password_hash = hash_password(payload.new_password)
    # Sign out every other session of this user.
    db.execute(
        delete(UserSession).where(
            UserSession.user_id == user.id, UserSession.id != auth.session.id
        )
    )
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)
