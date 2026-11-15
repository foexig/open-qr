"""QR code image rendering (PNG and SVG).

The classic black-on-white style uses the `qrcode` library's own image factories. Styled
codes (dot shapes, eye shapes, colours, gradients) are drawn from the module matrix: one
list of shape primitives is turned into SVG paths or drawn with Pillow (supersampled and
downscaled for smooth edges), so both formats look the same.
"""

import base64
import io
import math
import re
from typing import Literal

import qrcode
import qrcode.image.svg
from pydantic import BaseModel, ConfigDict, Field, field_validator
from qrcode.constants import ERROR_CORRECT_H, ERROR_CORRECT_L, ERROR_CORRECT_M, ERROR_CORRECT_Q

ErrorLevel = Literal["L", "M", "Q", "H"]
ImageFormat = Literal["png", "svg"]

_LEVELS = {"L": ERROR_CORRECT_L, "M": ERROR_CORRECT_M, "Q": ERROR_CORRECT_Q, "H": ERROR_CORRECT_H}

HEX = r"^#[0-9a-fA-F]{6}$"


class QRStyle(BaseModel):
    model_config = ConfigDict(extra="forbid")

    dots: Literal["square", "dots", "rounded", "diamond", "bars-v", "bars-h", "tiny"] = "square"
    eye_frame: Literal["square", "rounded", "circle", "leaf"] = "square"
    eye_ball: Literal["square", "rounded", "circle", "diamond"] = "square"
    fg: str = Field("#000000", pattern=HEX)
    fg2: str | None = Field(None, pattern=HEX)
    gradient: Literal["none", "linear", "radial"] = "none"
    eye_color: str | None = Field(None, pattern=HEX)
    bg: str = Field("#ffffff", pattern=r"^(#[0-9a-fA-F]{6}|transparent)$")

    @field_validator("fg", "fg2", "eye_color", "bg")
    @classmethod
    def _lower(cls, v: str | None) -> str | None:
        return None if v is None else v.lower()

    def is_default(self) -> bool:
        return self.model_dump() == DEFAULT_STYLE.model_dump()

    @property
    def gradient_on(self) -> bool:
        return self.gradient != "none" and self.fg2 is not None


DEFAULT_STYLE = QRStyle()

LOGO_MAX_BYTES = 512 * 1024
LOGO_MAX_SIDE = 512
LOGO_MAX_INPUT_SIDE = 4096


class LogoError(ValueError):
    pass


def clean_logo(raw: bytes) -> bytes:
    """Validate an uploaded logo and re-encode it as a small PNG.

    Only PNG and JPEG are accepted (no SVG: it could carry scripts). Re-encoding strips
    metadata and anything appended to the file.
    """
    from PIL import Image, UnidentifiedImageError

    if len(raw) > LOGO_MAX_BYTES:
        raise LogoError("Logo must be at most 512 KB")
    try:
        img = Image.open(io.BytesIO(raw))
        if img.format not in ("PNG", "JPEG"):
            raise LogoError("Logo must be a PNG or JPEG image")
        if max(img.size) > LOGO_MAX_INPUT_SIDE:
            raise LogoError("Logo must be at most 4096 × 4096 pixels")
        img.load()
    except (UnidentifiedImageError, OSError, Image.DecompressionBombError) as exc:
        raise LogoError("Logo is not a readable PNG or JPEG image") from exc
    img = img.convert("RGBA")
    img.thumbnail((LOGO_MAX_SIDE, LOGO_MAX_SIDE), Image.Resampling.LANCZOS)
    buf = io.BytesIO()
    img.save(buf, format="PNG", optimize=True)
    return buf.getvalue()


def _build(data: str, error: ErrorLevel, border: int, box_size: int) -> qrcode.QRCode:
    qr = qrcode.QRCode(error_correction=_LEVELS[error], border=border, box_size=box_size)
    qr.add_data(data)
    qr.make(fit=True)
    return qr


# --- classic renderer (pixel-exact, used for the default style) -----------------------


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


# --- styled renderer -------------------------------------------------------------------
# Primitives, in module units without the quiet zone:
#   ("rect", x, y, w, h, r, (tl, tr, br, bl))   rounded rectangle, r applies to flagged corners
#   ("circle", cx, cy, r)
#   ("poly", [(x, y), ...])
#   ("ring", outer, inner)                       outer shape with inner shape cut out

ALL = (True, True, True, True)


def _rect(x, y, w, h, r=0.0, corners=ALL):
    return ("rect", x, y, w, h, r, corners)


def _eye_origins(n: int) -> list[tuple[int, int]]:
    return [(0, 0), (n - 7, 0), (0, n - 7)]


def _in_eye(x: int, y: int, n: int) -> bool:
    return (x < 7 and y < 7) or (x >= n - 7 and y < 7) or (x < 7 and y >= n - 7)


def _logo_box(n: int) -> tuple[int, int]:
    """Start and side (in modules) of the cleared centre square for a logo.

    About 6 % of the area, well inside what error level H can recover (~30 %).
    """
    side = int(n * 0.25)
    if (n - side) % 2:
        side += 1
    return (n - side) // 2, side


def _dot_shapes(m: list[list[bool]], kind: str, hole: tuple[int, int] | None = None) -> list[tuple]:
    n = len(m)

    def on(x: int, y: int) -> bool:
        if hole and hole[0] <= x < hole[0] + hole[1] and hole[0] <= y < hole[0] + hole[1]:
            return False
        return 0 <= x < n and 0 <= y < n and m[y][x] and not _in_eye(x, y, n)

    shapes: list[tuple] = []
    if kind in ("bars-v", "bars-h"):
        vertical = kind == "bars-v"
        for a in range(n):
            b = 0
            while b < n:
                cell = (a, b) if vertical else (b, a)
                if not on(*cell):
                    b += 1
                    continue
                start = b
                while b < n and on(*((a, b) if vertical else (b, a))):
                    b += 1
                length = b - start
                if vertical:
                    shapes.append(_rect(a + 0.1, start + 0.05, 0.8, length - 0.1, 0.4))
                else:
                    shapes.append(_rect(start + 0.05, a + 0.1, length - 0.1, 0.8, 0.4))
        return shapes

    for y in range(n):
        for x in range(n):
            if not on(x, y):
                continue
            if kind == "dots":
                shapes.append(("circle", x + 0.5, y + 0.5, 0.45))
            elif kind == "diamond":
                shapes.append(("poly", [(x + 0.5, y), (x + 1, y + 0.5), (x + 0.5, y + 1), (x, y + 0.5)]))
            elif kind == "tiny":
                shapes.append(_rect(x + 0.2, y + 0.2, 0.6, 0.6, 0.12))
            elif kind == "rounded":
                left, right, up, down = on(x - 1, y), on(x + 1, y), on(x, y - 1), on(x, y + 1)
                corners = (
                    not (left or up),
                    not (right or up),
                    not (right or down),
                    not (left or down),
                )
                shapes.append(_rect(x, y, 1, 1, 0.5, corners))
            else:
                shapes.append(_rect(x, y, 1, 1))
    return shapes


def _eye_shapes(n: int, frame: str, ball: str) -> tuple[list[tuple], list[tuple]]:
    frames, balls = [], []
    for i, (ox, oy) in enumerate(_eye_origins(n)):
        # Leaf eyes are mirrored so their sharp corners point towards the code's centre.
        leaf = (True, False, True, False) if i == 0 else (False, True, False, True)
        if frame == "rounded":
            frames.append(("ring", _rect(ox, oy, 7, 7, 2.0), _rect(ox + 1, oy + 1, 5, 5, 1.2)))
        elif frame == "circle":
            frames.append(("ring", ("circle", ox + 3.5, oy + 3.5, 3.5), ("circle", ox + 3.5, oy + 3.5, 2.5)))
        elif frame == "leaf":
            frames.append(("ring", _rect(ox, oy, 7, 7, 3.0, leaf), _rect(ox + 1, oy + 1, 5, 5, 2.0, leaf)))
        else:
            frames.append(("ring", _rect(ox, oy, 7, 7), _rect(ox + 1, oy + 1, 5, 5)))

        cx, cy = ox + 3.5, oy + 3.5
        if ball == "rounded":
            balls.append(_rect(ox + 2, oy + 2, 3, 3, 0.9))
        elif ball == "circle":
            balls.append(("circle", cx, cy, 1.5))
        elif ball == "diamond":
            d = 1.75
            balls.append(("poly", [(cx, cy - d), (cx + d, cy), (cx, cy + d), (cx - d, cy)]))
        else:
            balls.append(_rect(ox + 2, oy + 2, 3, 3))
    return frames, balls


def _shapes(data: str, error: ErrorLevel, style: QRStyle, logo: bool = False):
    m = _build(data, error, 0, 1).get_matrix()
    n = len(m)
    frames, balls = _eye_shapes(n, style.eye_frame, style.eye_ball)
    hole = _logo_box(n) if logo else None
    return n, _dot_shapes(m, style.dots, hole), frames, balls, hole


# SVG output


def _num(v: float) -> str:
    s = f"{v:.3f}".rstrip("0").rstrip(".")
    return "0" if s in ("", "-0") else s


def _svg_d(p: tuple) -> str:
    kind = p[0]
    if kind == "rect":
        _, x, y, w, h, r, c = p
        tl, tr, br, bl = (r if flag else 0 for flag in c)
        f = _num
        d = f"M{f(x + tl)} {f(y)}H{f(x + w - tr)}"
        if tr:
            d += f"A{f(tr)} {f(tr)} 0 0 1 {f(x + w)} {f(y + tr)}"
        d += f"V{f(y + h - br)}"
        if br:
            d += f"A{f(br)} {f(br)} 0 0 1 {f(x + w - br)} {f(y + h)}"
        d += f"H{f(x + bl)}"
        if bl:
            d += f"A{f(bl)} {f(bl)} 0 0 1 {f(x)} {f(y + h - bl)}"
        d += f"V{f(y + tl)}"
        if tl:
            d += f"A{f(tl)} {f(tl)} 0 0 1 {f(x + tl)} {f(y)}"
        return d + "Z"
    if kind == "circle":
        _, cx, cy, r = p
        return (
            f"M{_num(cx - r)} {_num(cy)}a{_num(r)} {_num(r)} 0 1 0 {_num(2 * r)} 0"
            f"a{_num(r)} {_num(r)} 0 1 0 {_num(-2 * r)} 0Z"
        )
    if kind == "poly":
        pts = p[1]
        return "M" + "L".join(f"{_num(x)} {_num(y)}" for x, y in pts) + "Z"
    if kind == "ring":
        return _svg_d(p[1]) + _svg_d(p[2])
    raise ValueError(kind)


def _styled_svg(
    data: str, size: int, error: ErrorLevel, border: int, style: QRStyle, logo: bytes | None
) -> bytes:
    n, dots, frames, balls, hole = _shapes(data, error, style, logo is not None)
    total = n + 2 * border
    out = [
        '<?xml version="1.0" encoding="UTF-8"?>\n'
        f'<svg xmlns="http://www.w3.org/2000/svg" width="{size}" height="{size}" '
        f'viewBox="0 0 {total} {total}">'
    ]
    fill = style.fg
    if style.gradient_on:
        # User space coordinates so dots and eyes share one continuous gradient.
        if style.gradient == "linear":
            out.append(
                f'<defs><linearGradient id="g" gradientUnits="userSpaceOnUse" x1="0" y1="0" '
                f'x2="{total}" y2="{total}">'
            )
            close = "</linearGradient></defs>"
        else:
            c = _num(total / 2)
            out.append(
                f'<defs><radialGradient id="g" gradientUnits="userSpaceOnUse" cx="{c}" cy="{c}" '
                f'r="{_num(total * 0.65)}">'
            )
            close = "</radialGradient></defs>"
        out.append(f'<stop offset="0" stop-color="{style.fg}"/>')
        out.append(f'<stop offset="1" stop-color="{style.fg2}"/>{close}')
        fill = "url(#g)"
    if style.bg != "transparent":
        out.append(f'<rect width="{total}" height="{total}" fill="{style.bg}"/>')
    eye_fill = style.eye_color or fill
    out.append(f'<g transform="translate({border} {border})">')
    out.append(f'<path fill="{fill}" d="{"".join(_svg_d(p) for p in dots)}"/>')
    out.append(
        f'<path fill="{eye_fill}" fill-rule="evenodd" d="{"".join(_svg_d(p) for p in frames)}"/>'
    )
    out.append(f'<path fill="{eye_fill}" d="{"".join(_svg_d(p) for p in balls)}"/>')
    if logo and hole:
        pad = 0.4
        href = "data:image/png;base64," + base64.b64encode(logo).decode()
        out.append(
            f'<image x="{_num(hole[0] + pad)}" y="{_num(hole[0] + pad)}" '
            f'width="{_num(hole[1] - 2 * pad)}" height="{_num(hole[1] - 2 * pad)}" '
            f'preserveAspectRatio="xMidYMid meet" href="{href}"/>'
        )
    out.append("</g></svg>")
    return "".join(out).encode()


# PNG output


def _rgb(hex_color: str) -> tuple[int, int, int]:
    return tuple(int(hex_color[i : i + 2], 16) for i in (1, 3, 5))  # type: ignore[return-value]


def _draw(draw, p: tuple, s: float, value: int) -> None:
    kind = p[0]
    if kind == "rect":
        _, x, y, w, h, r, c = p
        x0, y0 = round(x * s), round(y * s)
        x1, y1 = round((x + w) * s) - 1, round((y + h) * s) - 1
        # Pillow rejects radii that reach exactly half the box with partial corners.
        rad = int(min(r * s, (x1 - x0) / 2 - 1, (y1 - y0) / 2 - 1))
        if rad >= 1 and any(c):
            draw.rounded_rectangle((x0, y0, x1, y1), radius=rad, fill=value, corners=c)
        else:
            draw.rectangle((x0, y0, x1, y1), fill=value)
    elif kind == "circle":
        _, cx, cy, r = p
        draw.ellipse(((cx - r) * s, (cy - r) * s, (cx + r) * s, (cy + r) * s), fill=value)
    elif kind == "poly":
        draw.polygon([(x * s, y * s) for x, y in p[1]], fill=value)
    elif kind == "ring":
        _draw(draw, p[1], s, value)
        _draw(draw, p[2], s, 0)


def _gradient_layer(style: QRStyle, width: int):
    from PIL import Image

    g = 64  # small ramp, upscaled smoothly; matches the SVG gradient geometry
    if style.gradient == "linear":
        ramp = [round((x + y) / (2 * (g - 1)) * 255) for y in range(g) for x in range(g)]
    else:
        c, r = (g - 1) / 2, g * 0.65
        ramp = [
            min(255, round(math.hypot(x - c, y - c) / r * 255)) for y in range(g) for x in range(g)
        ]
    mask = Image.new("L", (g, g))
    mask.putdata(ramp)
    mask = mask.resize((width, width), Image.Resampling.BILINEAR)
    start = Image.new("RGB", (width, width), _rgb(style.fg))
    end = Image.new("RGB", (width, width), _rgb(style.fg2 or style.fg))
    return Image.composite(end, start, mask)


def _styled_png(
    data: str, size: int, error: ErrorLevel, border: int, style: QRStyle, logo: bytes | None
) -> bytes:
    from PIL import Image, ImageDraw

    n, dots, frames, balls, hole = _shapes(data, error, style, logo is not None)
    total = n + 2 * border
    ss = max(1, min(4, 4096 // size))  # supersampling, canvas never exceeds 4096 px
    width = size * ss
    s = width / total
    off = border  # quiet zone in module units

    def shifted(p: tuple) -> tuple:
        if p[0] == "rect":
            return (p[0], p[1] + off, p[2] + off, *p[3:])
        if p[0] == "circle":
            return (p[0], p[1] + off, p[2] + off, p[3])
        if p[0] == "poly":
            return (p[0], [(x + off, y + off) for x, y in p[1]])
        return (p[0], shifted(p[1]), shifted(p[2]))

    dot_mask = Image.new("L", (width, width), 0)
    eye_mask = Image.new("L", (width, width), 0)
    dd, de = ImageDraw.Draw(dot_mask), ImageDraw.Draw(eye_mask)
    for p in dots:
        _draw(dd, shifted(p), s, 255)
    for p in frames + balls:
        _draw(de, shifted(p), s, 255)

    if style.gradient_on:
        fg_layer = _gradient_layer(style, width).convert("RGBA")
    else:
        fg_layer = Image.new("RGBA", (width, width), _rgb(style.fg))
    eye_layer = (
        Image.new("RGBA", (width, width), _rgb(style.eye_color)) if style.eye_color else fg_layer.copy()
    )
    bg = (0, 0, 0, 0) if style.bg == "transparent" else (*_rgb(style.bg), 255)
    canvas = Image.new("RGBA", (width, width), bg)
    fg_layer.putalpha(dot_mask)
    eye_layer.putalpha(eye_mask)
    canvas = Image.alpha_composite(Image.alpha_composite(canvas, fg_layer), eye_layer)
    if logo and hole:
        pad = 0.4
        box = round((hole[1] - 2 * pad) * s)
        mark = Image.open(io.BytesIO(logo)).convert("RGBA")
        mark.thumbnail((box, box), Image.Resampling.LANCZOS)
        x = round((hole[0] + off + pad) * s + (box - mark.width) / 2)
        y = round((hole[0] + off + pad) * s + (box - mark.height) / 2)
        layer = Image.new("RGBA", canvas.size, (0, 0, 0, 0))
        layer.paste(mark, (x, y))
        canvas = Image.alpha_composite(canvas, layer)
    if ss > 1:
        canvas = canvas.resize((size, size), Image.Resampling.LANCZOS)
    if style.bg != "transparent":
        canvas = canvas.convert("RGB")
    buf = io.BytesIO()
    canvas.save(buf, format="PNG", optimize=True)
    return buf.getvalue()


def render(
    data: str,
    fmt: ImageFormat,
    size: int,
    error: ErrorLevel,
    border: int,
    style: QRStyle | None = None,
    logo: bytes | None = None,
) -> bytes:
    style = style or DEFAULT_STYLE
    if logo is None and style.is_default():
        if fmt == "png":
            return render_png(data, size, error, border)
        return render_svg(data, size, error, border)
    if logo is not None:
        error = "H"  # the logo hides modules; the highest level keeps the code readable
    if fmt == "png":
        return _styled_png(data, size, error, border, style, logo)
    return _styled_svg(data, size, error, border, style, logo)
