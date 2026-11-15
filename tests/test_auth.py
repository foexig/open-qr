import os
import stat

from fastapi.testclient import TestClient

from app import setup_state
from app.config import get_settings

from .conftest import PASSWORD, login, make_user


def test_fresh_instance_requires_setup(anon):
    res = anon.get("/api/auth/status")
    assert res.json() == {
        "setup_required": True,
        "authenticated": False,
        "user": None,
        "csrf_token": None,
    }


def test_setup_token_file_is_private(anon):
    path = get_settings().setup_token_file
    assert setup_state.get_token()
    assert open(path).read() == setup_state.get_token()
    assert stat.S_IMODE(os.stat(path).st_mode) == 0o600


def test_setup_requires_correct_token(anon):
    body = {"setup_token": "wrong", "username": "admin", "password": PASSWORD}
    assert anon.post("/api/auth/setup", json=body).status_code == 403
    assert anon.get("/api/auth/status").json()["setup_required"] is True


def test_setup_creates_admin_once(anon):
    token = setup_state.get_token()
    body = {"setup_token": token, "username": "admin", "password": PASSWORD}
    res = anon.post("/api/auth/setup", json=body)
    assert res.status_code == 201, res.text
    assert res.json()["user"]["is_admin"] is True
    assert not os.path.exists(get_settings().setup_token_file)

    status = anon.get("/api/auth/status").json()
    assert status["authenticated"] is True and status["setup_required"] is False

    # Setup cannot be repeated, even with the old token.
    again = anon.post("/api/auth/setup", json=body | {"username": "evil"})
    assert again.status_code == 409


def test_setup_rejects_short_password(anon):
    body = {"setup_token": setup_state.get_token(), "username": "admin", "password": "short"}
    assert anon.post("/api/auth/setup", json=body).status_code == 422


def test_no_token_when_users_exist(app, db):
    make_user(db, "alice")
    with TestClient(app):
        assert setup_state.get_token() is None


def test_login_and_session_cookie(anon, db):
    make_user(db, "alice")
    res = anon.post("/api/auth/login", json={"username": "alice", "password": PASSWORD})
    assert res.status_code == 200
    cookie = res.headers["set-cookie"].lower()
    assert "openqr_session=" in cookie
    assert "httponly" in cookie and "samesite=strict" in cookie
    assert anon.get("/api/auth/me").json()["user"]["username"] == "alice"


def test_login_wrong_password_is_generic(anon, db):
    make_user(db, "alice")
    wrong_pw = anon.post("/api/auth/login", json={"username": "alice", "password": "nope"})
    no_user = anon.post("/api/auth/login", json={"username": "ghost", "password": "nope"})
    assert wrong_pw.status_code == no_user.status_code == 401
    assert wrong_pw.json() == no_user.json()


def test_inactive_user_cannot_login(anon, db):
    user = make_user(db, "alice")
    user.is_active = False
    db.commit()
    res = anon.post("/api/auth/login", json={"username": "alice", "password": PASSWORD})
    assert res.status_code == 401


def test_login_rate_limit(anon, db):
    make_user(db, "alice")
    for _ in range(get_settings().login_max_attempts):
        anon.post("/api/auth/login", json={"username": "alice", "password": "bad"})
    res = anon.post("/api/auth/login", json={"username": "alice", "password": PASSWORD})
    assert res.status_code == 429


def test_password_hash_is_argon2(db):
    user = make_user(db, "alice")
    assert user.password_hash.startswith("$argon2")
    assert PASSWORD not in user.password_hash


def test_protected_endpoints_require_login(anon, db):
    make_user(db, "alice")
    for method, path in [
        ("GET", "/api/qr-codes"),
        ("POST", "/api/qr-codes"),
        ("GET", "/api/qr-codes/1"),
        ("PATCH", "/api/qr-codes/1"),
        ("DELETE", "/api/qr-codes/1"),
        ("GET", "/api/qr-codes/1/image.png"),
        ("GET", "/api/qr-codes/1/stats"),
        ("GET", "/api/stats/overview"),
        ("GET", "/api/auth/me"),
        ("POST", "/api/auth/logout"),
        ("POST", "/api/auth/change-password"),
    ]:
        res = anon.request(method, path, json={})
        assert res.status_code == 401, (method, path, res.status_code)


def test_unauthenticated_cannot_create_redirect(anon, db):
    make_user(db, "alice")
    res = anon.post("/api/qr-codes", json={"name": "x", "target_url": "https://evil.example"})
    assert res.status_code == 401


def test_csrf_header_required_for_writes(client):
    token = client.headers.pop("X-CSRF-Token")
    res = client.post("/api/qr-codes", json={"name": "x", "target_url": "https://a.example"})
    assert res.status_code == 403
    res = client.post(
        "/api/qr-codes",
        json={"name": "x", "target_url": "https://a.example"},
        headers={"X-CSRF-Token": "forged"},
    )
    assert res.status_code == 403
    client.headers["X-CSRF-Token"] = token
    res = client.post("/api/qr-codes", json={"name": "x", "target_url": "https://a.example"})
    assert res.status_code == 201


def test_logout_invalidates_session(client):
    cookie = client.cookies.get("openqr_session")
    assert client.post("/api/auth/logout").status_code == 204
    # Replaying the old cookie must not work.
    client.cookies.set("openqr_session", cookie)
    assert client.get("/api/auth/me").status_code == 401


def test_change_password_signs_out_other_sessions(app, client):
    with TestClient(app) as second:
        login(second, "alice")
        res = client.post(
            "/api/auth/change-password",
            json={"current_password": PASSWORD, "new_password": "a brand new passphrase"},
        )
        assert res.status_code == 204
        assert second.get("/api/auth/me").status_code == 401
    assert client.get("/api/auth/me").status_code == 200
    with TestClient(app) as third:
        bad = third.post("/api/auth/login", json={"username": "alice", "password": PASSWORD})
        assert bad.status_code == 401
        login(third, "alice", "a brand new passphrase")


def test_change_password_requires_current(client):
    res = client.post(
        "/api/auth/change-password",
        json={"current_password": "wrong", "new_password": "a brand new passphrase"},
    )
    assert res.status_code == 400


def test_api_docs_disabled_by_default(anon):
    assert anon.get("/api/docs").status_code == 404
    assert anon.get("/api/openapi.json").status_code == 404


def test_security_headers(anon):
    res = anon.get("/")
    assert res.status_code == 200
    assert "default-src" in res.headers["content-security-policy"]
    assert res.headers["x-content-type-options"] == "nosniff"
    assert res.headers["x-frame-options"] == "DENY"


def test_static_assets_revalidate(anon):
    res = anon.get("/static/app.js")
    assert res.status_code == 200
    assert res.headers["cache-control"] == "no-cache"
    assert res.headers["etag"]
