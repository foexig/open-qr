"""First-run setup token.

When no user exists, a one-time setup token is generated at startup. It is printed to
the container log and written to a file inside the container (readable via
``python -m app.cli setup-info``). Creating the first admin requires this token, so a
fresh instance that is reachable from the network cannot be claimed by a stranger.
"""

import logging
import os
import secrets

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from .config import get_settings
from .db import get_sessionmaker
from .models import User

log = logging.getLogger("open_qr.setup")

_token: str | None = None


def users_exist(db: Session) -> bool:
    return (db.scalar(select(func.count(User.id))) or 0) > 0


def init_if_needed() -> None:
    global _token
    with get_sessionmaker()() as db:
        if users_exist(db):
            clear()
            return
    _token = secrets.token_urlsafe(18)
    path = get_settings().setup_token_file
    try:
        fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
        with os.fdopen(fd, "w") as fh:
            fh.write(_token)
    except OSError as exc:
        log.warning("Could not write setup token file %s: %s", path, exc)
    log.warning("No user exists yet. Open the dashboard to create the first admin account.")
    log.warning("SETUP TOKEN: %s", _token)


def get_token() -> str | None:
    return _token


def clear() -> None:
    global _token
    _token = None
    try:
        os.remove(get_settings().setup_token_file)
    except FileNotFoundError:
        pass
    except OSError as exc:
        log.warning("Could not remove setup token file: %s", exc)
