import io

import pytest
from PIL import Image
from sqlalchemy import func, select

from app.models import QRCode, Scan
from app.util import CODE_PATTERN

from .conftest import create_code


def test_create_qr_code(client, db):
    qr = create_code(client, name="  Spring flyer ", description="Front desk")
    assert qr["name"] == "Spring flyer"
    assert qr["is_active"] is True
    assert qr["scan_count"] == 0
    assert CODE_PATTERN.fullmatch(qr["code"]) and len(qr["code"]) == 7
    assert qr["short_url"] == f"http://testserver/r/{qr['code']}"

    row = db.get(QRCode, qr["id"])
    assert row.target_url == "https://example.com/a"
    assert row.user.username == "alice"


def test_codes_are_random_and_unique(client):
    codes = {create_code(client, name=f"c{i}")["code"] for i in range(25)}
    assert len(codes) == 25
    # Not sequential / guessable from each other.
    assert len({c[:3] for c in codes}) > 5


@pytest.mark.parametrize(
    "url",
    [
        "javascript:alert(1)",
        "data:text/html,hi",
        "ftp://example.com/file",
        "https://user:pass@example.com/",
        "https://exa mple.com",
        "https://",
        "example.com",
        "",
        "https://example.com/" + "a" * 2100,
    ],
)
def test_rejects_invalid_target_urls(client, url):
    res = client.post("/api/qr-codes", json={"name": "x", "target_url": url})
    assert res.status_code == 422, url


def test_rejects_redirect_loop(client):
    res = client.post(
        "/api/qr-codes", json={"name": "x", "target_url": "http://testserver/r/abcdefg"}
    )
    assert res.status_code == 422


def test_rejects_empty_name(client):
    res = client.post("/api/qr-codes", json={"name": "   ", "target_url": "https://a.example"})
    assert res.status_code == 422


def test_list_search_and_sort(client):
    create_code(client, name="Bravo", target_url="https://b.example")
    create_code(client, name="Alpha", target_url="https://a.example/menu")
    create_code(client, name="Charlie", target_url="https://c.example")

    names = [q["name"] for q in client.get("/api/qr-codes").json()]
    assert names == ["Charlie", "Alpha", "Bravo"]  # newest first
    names = [q["name"] for q in client.get("/api/qr-codes?sort=name").json()]
    assert names == ["Alpha", "Bravo", "Charlie"]
    found = client.get("/api/qr-codes?q=menu").json()
    assert [q["name"] for q in found] == ["Alpha"]


def test_get_update_delete(client, db):
    qr = create_code(client)
    assert client.get(f"/api/qr-codes/{qr['id']}").json()["code"] == qr["code"]

    res = client.patch(
        f"/api/qr-codes/{qr['id']}",
        json={"name": "Renamed", "target_url": "https://example.com/b", "is_active": False},
    )
    assert res.status_code == 200
    body = res.json()
    assert body["name"] == "Renamed"
    assert body["target_url"] == "https://example.com/b"
    assert body["is_active"] is False
    assert body["code"] == qr["code"]  # the printed code never changes

    client.get(f"/r/{qr['code']}")  # inactive: no scan, but make sure nothing breaks
    client.patch(f"/api/qr-codes/{qr['id']}", json={"is_active": True})
    client.get(f"/r/{qr['code']}", follow_redirects=False)
    assert db.scalar(select(func.count(Scan.id))) == 1

    assert client.delete(f"/api/qr-codes/{qr['id']}").status_code == 204
    assert client.get(f"/api/qr-codes/{qr['id']}").status_code == 404
    db.expire_all()
    assert db.scalar(select(func.count(Scan.id))) == 0  # scans cascade


def test_patch_validates(client):
    qr = create_code(client)
    res = client.patch(f"/api/qr-codes/{qr['id']}", json={"target_url": "javascript:x"})
    assert res.status_code == 422


def test_users_cannot_see_each_others_codes(client, other_client):
    qr = create_code(client)
    qid = qr["id"]
    assert other_client.get("/api/qr-codes").json() == []
    assert other_client.get(f"/api/qr-codes/{qid}").status_code == 404
    assert other_client.patch(f"/api/qr-codes/{qid}", json={"name": "x"}).status_code == 404
    assert (
        other_client.patch(
            f"/api/qr-codes/{qid}", json={"target_url": "https://evil.example"}
        ).status_code
        == 404
    )
    assert other_client.delete(f"/api/qr-codes/{qid}").status_code == 404
    assert other_client.get(f"/api/qr-codes/{qid}/image.png").status_code == 404
    assert other_client.get(f"/api/qr-codes/{qid}/stats").status_code == 404
    assert other_client.get("/api/stats/overview").json()["total_codes"] == 0
    # Still intact for the owner.
    assert client.get(f"/api/qr-codes/{qid}").json()["target_url"] == "https://example.com/a"


def test_png_download(client):
    qr = create_code(client, name="Menü Tisch 4")
    res = client.get(f"/api/qr-codes/{qr['id']}/image.png?size=300&ec=H&border=2&download=1")
    assert res.status_code == 200
    assert res.headers["content-type"] == "image/png"
    assert "attachment" in res.headers["content-disposition"]
    assert ".png" in res.headers["content-disposition"]
    img = Image.open(io.BytesIO(res.content))
    assert img.size == (300, 300)


def test_svg_preview(client):
    qr = create_code(client)
    res = client.get(f"/api/qr-codes/{qr['id']}/image.svg?size=256")
    assert res.status_code == 200
    assert res.headers["content-type"].startswith("image/svg+xml")
    assert "content-disposition" not in res.headers
    text = res.text
    assert "<svg" in text and 'width="256' in text
    assert "<script" not in text.lower()


@pytest.mark.parametrize(
    "query", ["size=10", "size=99999", "ec=Z", "border=-1", "border=99"]
)
def test_image_parameter_validation(client, query):
    qr = create_code(client)
    assert client.get(f"/api/qr-codes/{qr['id']}/image.png?{query}").status_code == 422


def test_image_encodes_short_url(client):
    """The QR matrix must encode the short URL, not the target URL."""
    import qrcode

    qr = create_code(client)
    res = client.get(f"/api/qr-codes/{qr['id']}/image.png?size=500&border=4&ec=M")
    expected = qrcode.QRCode(error_correction=qrcode.constants.ERROR_CORRECT_M, border=4)
    expected.add_data(qr["short_url"])
    expected.make(fit=True)
    matrix = expected.get_matrix()
    n = len(matrix)
    img = Image.open(io.BytesIO(res.content)).convert("L")
    cell = img.size[0] / n
    for y in range(n):
        for x in range(n):
            px = img.getpixel((int((x + 0.5) * cell), int((y + 0.5) * cell)))
            assert (px < 128) == matrix[y][x], (x, y)
