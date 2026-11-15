"""QR code image rendering (PNG and SVG) with the `qrcode` library."""

import io
import re
from typing import Literal

import qrcode
import qrcode.image.svg
from qrcode.constants import ERROR_CORRECT_H, ERROR_CORRECT_L, ERROR_CORRECT_M, ERROR_CORRECT_Q

ErrorLevel = Literal["L", "M", "Q", "H"]
ImageFormat = Literal["png", "svg"]

_LEVELS = {"L": ERROR_CORRECT_L, "M": ERROR_CORRECT_M, "Q": ERROR_CORRECT_Q, "H": ERROR_CORRECT_H}


def _build(data: str, error: ErrorLevel, border: int, box_size: int) -> qrcode.QRCode:
    qr = qrcode.QRCode(error_correction=_LEVELS[error], border=border, box_size=box_size)
    qr.add_data(data)
    qr.make(fit=True)
    return qr


def render_png(data: str, size: int = 512, error: ErrorLevel = "M", border: int = 4) -> bytes:
    from PIL import Image

    probe = _build(data, error, border, 1)
    modules = probe.modules_count + 2 * border
    box = max(1, -(-size // modules))  # ceil, then scale down with nearest-neighbour
    img = _build(data, error, border, box).make_image(fill_color="black", back_color="white")
    pil = img.get_image().convert("L")
    if pil.size != (size, size):
        pil = pil.resize((size, size), Image.Resampling.NEAREST)
    buf = io.BytesIO()
    pil.save(buf, format="PNG", optimize=True)
    return buf.getvalue()


def render_svg(data: str, size: int = 512, error: ErrorLevel = "M", border: int = 4) -> bytes:
    qr = _build(data, error, border, 10)
    img = qr.make_image(image_factory=qrcode.image.svg.SvgPathFillImage)
    svg = img.to_string(encoding="unicode")
    # Replace physical mm dimensions with the requested pixel size; viewBox keeps it crisp.
    svg = re.sub(r'\swidth="[^"]*"', f' width="{size}"', svg, count=1)
    svg = re.sub(r'\sheight="[^"]*"', f' height="{size}"', svg, count=1)
    if not svg.startswith("<?xml"):
        svg = '<?xml version="1.0" encoding="UTF-8"?>\n' + svg
    return svg.encode()


def render(data: str, fmt: ImageFormat, size: int, error: ErrorLevel, border: int) -> bytes:
    if fmt == "png":
        return render_png(data, size, error, border)
    return render_svg(data, size, error, border)
