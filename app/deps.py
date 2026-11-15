"""FastAPI dependencies for authentication and CSRF protection."""

import hmac
from dataclasses import dataclass
from typing import Annotated

from fastapi import Depends, HTTPException, Request, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from .db import get_db
from .models import User, UserSession, utcnow
from .security import hash_token

SESSION_COOKIE = "openqr_session"
CSRF_HEADER = "x-csrf-token"
SAFE_METHODS = {"GET", "HEAD", "OPTIONS"}

DB = Annotated[Session, Depends(get_db)]


@dataclass
class AuthContext:
    user: User
    session: UserSession


def get_auth(request: Request, db: DB) -> AuthContext:
    token = request.cookies.get(SESSION_COOKIE)
    if not token:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Not authenticated")
    sess = db.scalar(
        select(UserSession).where(
            UserSession.token_hash == hash_token(token),
            UserSession.expires_at > utcnow(),
        )
    )
    if sess is None or not sess.user.is_active:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Session expired or invalid")
    if request.method not in SAFE_METHODS:
        sent = request.headers.get(CSRF_HEADER, "")
        if not hmac.compare_digest(sent.encode(), sess.csrf_token.encode()):
            raise HTTPException(status.HTTP_403_FORBIDDEN, "CSRF token missing or invalid")
    return AuthContext(user=sess.user, session=sess)


def get_current_user(ctx: Annotated[AuthContext, Depends(get_auth)]) -> User:
    return ctx.user


CurrentUser = Annotated[User, Depends(get_current_user)]
Auth = Annotated[AuthContext, Depends(get_auth)]
