from sqlalchemy import select

from app.models import Scan

from .conftest import create_code

IPHONE = (
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 "
    "(KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1"
)


def test_redirect_and_scan_recorded(client, db):
    qr = create_code(client)
    res = client.get(
        f"/r/{qr['code']}",
        headers={"User-Agent": IPHONE, "Referer": "https://social.example/post/1?x=y"},
        follow_redirects=False,
    )
    assert res.status_code == 302
    assert res.headers["location"] == "https://example.com/a"
    assert "no-store" in res.headers["cache-control"]

    scans = db.scalars(select(Scan)).all()
    assert len(scans) == 1
    scan = scans[0]
    assert scan.qr_code_id == qr["id"]
    assert scan.device_type == "mobile"
    assert scan.browser == "Safari"
    assert scan.is_bot is False
    assert scan.referrer == "social.example"  # host only, no path or query
    assert scan.user_agent is None  # raw user agent is not stored by default


def test_redirect_works_without_session(client, anon):
    qr = create_code(client)
    res = anon.get(f"/r/{qr['code']}", follow_redirects=False)
    assert res.status_code == 302


def test_changed_target_applies_to_next_scan(client, anon):
    qr = create_code(client)
    assert anon.get(f"/r/{qr['code']}", follow_redirects=False).headers["location"] == (
        "https://example.com/a"
    )
    client.patch(f"/api/qr-codes/{qr['id']}", json={"target_url": "https://example.org/new"})
    res = anon.get(f"/r/{qr['code']}", follow_redirects=False)
    assert res.headers["location"] == "https://example.org/new"


def test_deactivated_code(client, anon, db):
    qr = create_code(client)
    client.patch(f"/api/qr-codes/{qr['id']}", json={"is_active": False})
    res = anon.get(f"/r/{qr['code']}", follow_redirects=False)
    assert res.status_code == 410
    assert "text/html" in res.headers["content-type"]
    assert "deactivated" in res.text
    assert "example.com" not in res.text  # target is not leaked
    assert db.scalars(select(Scan)).all() == []

    client.patch(f"/api/qr-codes/{qr['id']}", json={"is_active": True})
    assert anon.get(f"/r/{qr['code']}", follow_redirects=False).status_code == 302


def test_unknown_and_invalid_codes(anon):
    for code in ["zzzzzzz", "abc", "a" * 40, "abc-def", "abc%20def", "%3Cscript%3E"]:
        res = anon.get(f"/r/{code}", follow_redirects=False)
        assert res.status_code == 404, code
        assert "<script>" not in res.text


def test_deleted_code_is_404(client, anon):
    qr = create_code(client)
    client.delete(f"/api/qr-codes/{qr['id']}")
    assert anon.get(f"/r/{qr['code']}", follow_redirects=False).status_code == 404


def test_head_is_not_counted(client, anon, db):
    qr = create_code(client)
    res = anon.head(f"/r/{qr['code']}", follow_redirects=False)
    assert res.status_code == 302
    assert db.scalars(select(Scan)).all() == []


def test_bots_are_flagged(client, anon, db):
    qr = create_code(client)
    anon.get(
        f"/r/{qr['code']}",
        headers={"User-Agent": "WhatsApp/2.23.20.0 A"},
        follow_redirects=False,
    )
    anon.get(
        f"/r/{qr['code']}",
        headers={"User-Agent": "Mozilla/5.0 (compatible; Googlebot/2.1)"},
        follow_redirects=False,
    )
    scans = db.scalars(select(Scan)).all()
    assert len(scans) == 2 and all(s.is_bot for s in scans)
