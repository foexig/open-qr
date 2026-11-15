"""Test fixtures. Tests run against a real PostgreSQL given by TEST_DATABASE_URL.

The easiest way to run them is ``scripts/test.sh``, which starts a throwaway database
in Docker. The database is migrated with Alembic once per session and truncated
between tests.
"""

import os
import tempfile
from pathlib import Path

import pytest

TEST_DATABASE_URL = os.environ.get("TEST_DATABASE_URL")
if not TEST_DATABASE_URL:
    pytest.exit(
        "TEST_DATABASE_URL is not set. Run scripts/test.sh, or point it at an empty "
        "PostgreSQL database, e.g. postgresql+psycopg://user:pass@localhost:5432/openqr_test",
        returncode=2,
    )

# Settings are read at import time, so the environment must be prepared first.
_tmp = Path(tempfile.mkdtemp(prefix="openqr-test-"))
os.environ["DATABASE_URL"] = TEST_DATABASE_URL
os.environ["PUBLIC_BASE_URL"] = "http://testserver"
os.environ["SETUP_TOKEN_FILE"] = str(_tmp / "setup-token")
os.environ["STATS_TIMEZONE"] = "UTC"
os.environ.pop("STORE_USER_AGENT", None)

from alembic import command  # noqa: E402
from alembic.config import Config  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402
from sqlalchemy import text  # noqa: E402

from app import setup_state  # noqa: E402
from app.db import get_engine, get_sessionmaker  # noqa: E402
from app.main import create_app  # noqa: E402
from app.models import User  # noqa: E402
from app.security import hash_password, login_limiter  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
PASSWORD = "correct horse battery"


def alembic_config() -> Config:
    cfg = Config(str(ROOT / "alembic.ini"))
    cfg.set_main_option("script_location", str(ROOT / "alembic"))
    cfg.set_main_option("sqlalchemy.url", TEST_DATABASE_URL.replace("%", "%%"))
    return cfg


@pytest.fixture(scope="session", autouse=True)
def migrated_db():
    cfg = alembic_config()
    command.downgrade(cfg, "base")
    command.upgrade(cfg, "head")
    yield
    get_engine().dispose()


@pytest.fixture(autouse=True)
def clean_db(migrated_db):
    with get_engine().begin() as conn:
        conn.execute(text("TRUNCATE scans, qr_codes, sessions, users RESTART IDENTITY CASCADE"))
    login_limiter.reset()
    setup_state.clear()
    yield


@pytest.fixture
def db():
    with get_sessionmaker()() as session:
        yield session


@pytest.fixture
def app():
    return create_app()


@pytest.fixture
def anon(app):
    """Unauthenticated client. Entering the context runs the app lifespan."""
    with TestClient(app) as client:
        yield client


def make_user(db, username: str, password: str = PASSWORD, admin: bool = False) -> User:
    user = User(username=username, password_hash=hash_password(password), is_admin=admin)
    db.add(user)
    db.commit()
    return user


def login(client: TestClient, username: str, password: str = PASSWORD) -> TestClient:
    res = client.post("/api/auth/login", json={"username": username, "password": password})
    assert res.status_code == 200, res.text
    client.headers["X-CSRF-Token"] = res.json()["csrf_token"]
    return client


@pytest.fixture
def client(app, db):
    """Client signed in as user 'alice'."""
    make_user(db, "alice", admin=True)
    with TestClient(app) as c:
        yield login(c, "alice")


@pytest.fixture
def other_client(app, db):
    """A second, independent user 'bob'."""
    make_user(db, "bob")
    with TestClient(app) as c:
        yield login(c, "bob")


def create_code(client: TestClient, **overrides) -> dict:
    payload = {"name": "Flyer", "target_url": "https://example.com/a"} | overrides
    res = client.post("/api/qr-codes", json=payload)
    assert res.status_code == 201, res.text
    return res.json()
