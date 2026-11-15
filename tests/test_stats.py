from datetime import UTC, datetime, timedelta

from app.models import Scan

from .conftest import create_code


def scan(client, code, ua="Mozilla/5.0 (Windows NT 10.0; Win64; x64) Firefox/130.0"):
    res = client.get(f"/r/{code}", headers={"User-Agent": ua}, follow_redirects=False)
    assert res.status_code == 302


def test_scan_counts_in_list_and_detail(client):
    a = create_code(client, name="A")
    b = create_code(client, name="B")
    for _ in range(3):
        scan(client, a["code"])
    scan(client, b["code"])

    listed = {q["name"]: q for q in client.get("/api/qr-codes").json()}
    assert listed["A"]["scan_count"] == 3
    assert listed["B"]["scan_count"] == 1
    assert listed["A"]["last_scan_at"] is not None
    by_scans = [q["name"] for q in client.get("/api/qr-codes?sort=scans").json()]
    assert by_scans == ["A", "B"]


def test_qr_stats(client, db):
    qr = create_code(client)
    scan(client, qr["code"])
    scan(client, qr["code"], ua="Mozilla/5.0 (Linux; Android 14; Pixel 8) Chrome/129.0 Mobile")
    scan(client, qr["code"], ua="Mozilla/5.0 (compatible; bingbot/2.0)")
    # An old scan, 40 days ago: counts in total but not in this month.
    db.add(Scan(qr_code_id=qr["id"], scanned_at=datetime.now(UTC) - timedelta(days=40)))
    db.commit()

    st = client.get(f"/api/qr-codes/{qr['id']}/stats?days=30").json()
    assert st["total"] == 4
    assert st["likely_bots"] == 1
    assert st["today"] == 3
    assert st["this_week"] == 3
    assert st["this_month"] == 3
    assert st["last_scan_at"] is not None

    assert len(st["daily"]) == 30
    assert st["daily"][-1]["count"] == 3 and st["daily"][-1]["bots"] == 1
    assert sum(p["count"] for p in st["daily"]) == 3
    assert len(st["weekly"]) == 12 and len(st["monthly"]) == 12
    assert sum(p["count"] for p in st["monthly"]) == 4
    assert st["monthly"][-1]["period"].endswith("-01")

    devices = {d["label"]: d["count"] for d in st["devices"]}
    assert devices["desktop"] == 1 and devices["mobile"] == 1 and devices["bot"] == 1
    browsers = {d["label"]: d["count"] for d in st["browsers"]}
    assert browsers["Firefox"] == 1 and browsers["Chrome"] == 1


def test_overview(client):
    a = create_code(client, name="A")
    b = create_code(client, name="B")
    create_code(client, name="C", is_active=False)
    scan(client, b["code"])
    scan(client, b["code"])
    scan(client, a["code"])

    ov = client.get("/api/stats/overview").json()
    assert ov["total_codes"] == 3
    assert ov["active_codes"] == 2
    assert ov["scans"]["total"] == 3
    assert [q["name"] for q in ov["top"]] == ["B", "A"]
    assert [q["name"] for q in ov["recent"]] == ["C", "B", "A"]
    assert len(ov["daily"]) == 30
    assert ov["daily"][-1]["count"] == 3


def test_empty_stats(client):
    qr = create_code(client)
    st = client.get(f"/api/qr-codes/{qr['id']}/stats").json()
    assert st["total"] == 0 and st["last_scan_at"] is None
    assert all(p["count"] == 0 for p in st["daily"])
    assert st["devices"] == []
