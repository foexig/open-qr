import io

import pytest
import qrcode
from PIL import Image

from app.models import QRCode

from .conftest import create_code

STYLED = {
    "dots": "rounded",
    "eye_frame": "leaf",
    "eye_ball": "circle",
    "fg": "#0078BF",
    "fg2": "#ff48b0",
    "gradient": "linear",
    "eye_color": "#1b2230",
    "bg": "#fffdf5",
}


def _matrix(data: str, border: int = 4):
    qr = qrcode.QRCode(error_correction=qrcode.constants.ERROR_CORRECT_M, border=border)
    qr.add_data(data)
    qr.make(fit=True)
    return qr.get_matrix()


def test_default_style_is_classic(client, db):
    qr = create_code(client)
    assert qr["style"]["dots"] == "square"
    assert qr["style"]["bg"] == "#ffffff"
    assert db.get(QRCode, qr["id"]).style is None


def test_patch_style_persists_and_resets(client, db):
    qr = create_code(client)
    res = client.patch(f"/api/qr-codes/{qr['id']}", json={"style": STYLED})
    assert res.status_code == 200, res.text
    style = res.json()["style"]
    assert style["dots"] == "rounded" and style["fg"] == "#0078bf"  # normalised to lowercase
    assert db.get(QRCode, qr["id"]).style["eye_frame"] == "leaf"

    # Other fields can change without touching the style.
    res = client.patch(f"/api/qr-codes/{qr['id']}", json={"name": "Renamed"})
    assert res.json()["style"]["dots"] == "rounded"

    res = client.patch(f"/api/qr-codes/{qr['id']}", json={"style": None})
    assert res.json()["style"]["dots"] == "square"
    db.expire_all()
    assert db.get(QRCode, qr["id"]).style is None


def test_create_with_style(client):
    qr = create_code(client, style={"dots": "dots", "fg": "#112233"})
    assert qr["style"]["dots"] == "dots" and qr["style"]["fg"] == "#112233"


@pytest.mark.parametrize(
    "style",
    [
        {"fg": "red"},
        {"fg": "#12345"},
        {"bg": "url(javascript:x)"},
        {"fg": '#000000" onload="x'},
        {"dots": "stars"},
        {"eye_frame": "hexagon"},
        {"gradient": "conic"},
        {"unknown": 1},
    ],
)
def test_style_validation(client, style):
    qr = create_code(client)
    assert client.patch(f"/api/qr-codes/{qr['id']}", json={"style": style}).status_code == 422


@pytest.mark.parametrize("dots", ["square", "dots", "rounded", "diamond", "bars-v", "bars-h", "tiny"])
def test_styled_png_keeps_module_grid(client, dots):
    """Every dot shape must cover dark module centres and leave light ones empty."""
    qr = create_code(client)
    style = {"dots": dots, "fg": "#1b2230", "bg": "#ffffff", "eye_frame": "rounded"}
    client.patch(f"/api/qr-codes/{qr['id']}", json={"style": style})
    res = client.get(f"/api/qr-codes/{qr['id']}/image.png?size=600&border=4")
    assert res.status_code == 200
    img = Image.open(io.BytesIO(res.content)).convert("L")
    assert img.size == (600, 600)
    matrix = _matrix(qr["short_url"])
    n = len(matrix)
    cell = 600 / n
    inner = n - 8  # skip finder patterns, their shapes are drawn differently on purpose
    for y in range(4, n - 4):
        for x in range(4, n - 4):
            in_eye = (x < 11 and y < 11) or (x >= inner - 3 and y < 11) or (x < 11 and y >= inner - 3)
            if in_eye:
                continue
            px = img.getpixel((int((x + 0.5) * cell), int((y + 0.5) * cell)))
            assert (px < 128) == matrix[y][x], (dots, x, y)


def test_styled_png_colours_and_transparency(client):
    qr = create_code(client)
    style = {"dots": "dots", "fg": "#ff0000", "bg": "transparent"}
    client.patch(f"/api/qr-codes/{qr['id']}", json={"style": style})
    img = Image.open(io.BytesIO(client.get(f"/api/qr-codes/{qr['id']}/image.png?size=256").content))
    assert img.mode == "RGBA"
    assert img.getpixel((0, 0))[3] == 0  # quiet zone is transparent
    colours = {px[:3] for px in img.getdata() if px[3] == 255}
    assert (255, 0, 0) in colours


def test_styled_svg(client):
    qr = create_code(client)
    client.patch(f"/api/qr-codes/{qr['id']}", json={"style": STYLED})
    res = client.get(f"/api/qr-codes/{qr['id']}/image.svg?size=300")
    text = res.text
    assert 'width="300"' in text and "linearGradient" in text
    assert "#fffdf5" in text and "#1b2230" in text
    assert "<script" not in text.lower()


def test_preview_renders_unsaved_style(client, db):
    qr = create_code(client)
    res = client.post(f"/api/qr-codes/{qr['id']}/preview.svg", json={"style": STYLED, "ec": "H"})
    assert res.status_code == 200
    assert res.headers["content-type"].startswith("image/svg+xml")
    assert "radialGradient" not in res.text and "linearGradient" in res.text
    assert db.get(QRCode, qr["id"]).style is None  # nothing stored


def test_preview_requires_owner_and_csrf(client, other_client):
    qr = create_code(client)
    body = {"style": STYLED}
    assert other_client.post(f"/api/qr-codes/{qr['id']}/preview.svg", json=body).status_code == 404
    token = client.headers.pop("X-CSRF-Token")
    assert client.post(f"/api/qr-codes/{qr['id']}/preview.svg", json=body).status_code == 403
    client.headers["X-CSRF-Token"] = token


def _image_bytes(fmt: str = "PNG", size=(64, 64), colour=(255, 72, 176, 255)) -> bytes:
    buf = io.BytesIO()
    mode = "RGBA" if fmt == "PNG" else "RGB" if fmt == "JPEG" else "P"
    Image.new(mode, size, colour[: len(mode)] if mode != "P" else 1).save(buf, format=fmt)
    return buf.getvalue()


def _put_logo(client, qid, body: bytes, ctype="image/png"):
    return client.put(f"/api/qr-codes/{qid}/logo", content=body, headers={"Content-Type": ctype})


def test_logo_upload_render_and_delete(client, db):
    qr = create_code(client)
    res = _put_logo(client, qr["id"], _image_bytes())
    assert res.status_code == 200, res.text
    assert res.json()["has_logo"] is True
    stored = db.get(QRCode, qr["id"]).logo
    assert stored.startswith(b"\x89PNG")

    listed = client.get("/api/qr-codes").json()[0]
    assert listed["has_logo"] is True

    png = Image.open(io.BytesIO(client.get(f"/api/qr-codes/{qr['id']}/image.png?size=400").content))
    centre = png.convert("RGB").getpixel((200, 200))
    assert centre == (255, 72, 176)
    svg = client.get(f"/api/qr-codes/{qr['id']}/image.svg").text
    assert "data:image/png;base64," in svg

    res = client.delete(f"/api/qr-codes/{qr['id']}/logo")
    assert res.json()["has_logo"] is False
    db.expire_all()
    assert db.get(QRCode, qr["id"]).logo is None


def test_logo_accepts_jpeg_and_reencodes(client, db):
    qr = create_code(client)
    res = _put_logo(client, qr["id"], _image_bytes("JPEG", (2000, 1000)), "image/jpeg")
    assert res.status_code == 200, res.text
    img = Image.open(io.BytesIO(db.get(QRCode, qr["id"]).logo))
    assert img.format == "PNG" and max(img.size) <= 512


@pytest.mark.parametrize(
    ("body", "ctype", "status"),
    [
        (b'<svg xmlns="http://www.w3.org/2000/svg"><script>x</script></svg>', "image/svg+xml", 415),
        (b"<svg><script>x</script></svg>", "image/png", 422),
        (b"not an image", "image/png", 422),
        (b"\x89PNG" + b"0" * (600 * 1024), "image/png", 413),
    ],
)
def test_logo_rejects_bad_uploads(client, body, ctype, status):
    qr = create_code(client)
    assert _put_logo(client, qr["id"], body, ctype).status_code == status


def test_logo_rejects_gif_disguised_as_png(client):
    qr = create_code(client)
    assert _put_logo(client, qr["id"], _image_bytes("GIF")).status_code == 422


def test_logo_requires_owner_and_csrf(client, other_client):
    qr = create_code(client)
    assert _put_logo(other_client, qr["id"], _image_bytes()).status_code == 404
    token = client.headers.pop("X-CSRF-Token")
    assert _put_logo(client, qr["id"], _image_bytes()).status_code == 403
    client.headers["X-CSRF-Token"] = token
