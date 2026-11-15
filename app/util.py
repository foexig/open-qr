"""Small helpers: public code generation, URL validation, user agent classification."""

import re
import secrets
from dataclasses import dataclass
from urllib.parse import urlsplit

# No look-alike characters (0/O, 1/l/I) so codes can be typed from print if needed.
CODE_ALPHABET = "23456789abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ"
CODE_PATTERN = re.compile(r"^[A-Za-z0-9]{4,32}$")

MAX_URL_LENGTH = 2048


def generate_code(length: int) -> str:
    return "".join(secrets.choice(CODE_ALPHABET) for _ in range(length))


def validate_target_url(value: str) -> str:
    value = value.strip()
    if not value:
        raise ValueError("URL must not be empty")
    if len(value) > MAX_URL_LENGTH:
        raise ValueError(f"URL must be at most {MAX_URL_LENGTH} characters")
    if any(ord(c) < 33 or ord(c) == 127 for c in value):
        raise ValueError("URL must not contain spaces or control characters")
    parts = urlsplit(value)
    if parts.scheme.lower() not in ("http", "https"):
        raise ValueError("Only http:// and https:// URLs are allowed")
    if not parts.hostname:
        raise ValueError("URL must contain a host name")
    if parts.username or parts.password:
        raise ValueError("URLs with embedded credentials are not allowed")
    return value


def referrer_host(referrer: str | None) -> str | None:
    if not referrer:
        return None
    try:
        host = urlsplit(referrer).hostname
    except ValueError:
        return None
    return host[:255] if host else None


@dataclass(frozen=True)
class ClientInfo:
    device_type: str
    browser: str
    is_bot: bool


_BOT_RE = re.compile(
    r"bot\b|bot/|crawl|spider|slurp|preview|facebookexternalhit|whatsapp|telegram|slack|"
    r"discord|skypeuri|embedly|quora link|pinterest|vkshare|w3c_validator|curl/|wget/|"
    r"python-requests|python-urllib|httpx|aiohttp|go-http-client|okhttp|java/|libwww|"
    r"headlesschrome|phantomjs|scrapy|axios|node-fetch|monitor|uptime",
    re.IGNORECASE,
)
_TABLET_RE = re.compile(r"ipad|tablet|kindle|silk|playbook|(android(?!.*mobile))", re.IGNORECASE)
_MOBILE_RE = re.compile(r"mobi|iphone|ipod|android|blackberry|opera mini|iemobile", re.IGNORECASE)
_BROWSERS = (
    ("Edge", re.compile(r"Edg(e|A|iOS)?/")),
    ("Opera", re.compile(r"OPR/|Opera")),
    ("Samsung Internet", re.compile(r"SamsungBrowser")),
    ("Firefox", re.compile(r"Firefox|FxiOS")),
    ("Chrome", re.compile(r"Chrome|CriOS|Chromium")),
    ("Safari", re.compile(r"Safari|AppleWebKit")),
)


def classify_user_agent(ua: str | None) -> ClientInfo:
    ua = (ua or "").strip()
    if not ua:
        return ClientInfo("unknown", "Unknown", False)
    is_bot = bool(_BOT_RE.search(ua))
    if is_bot:
        device = "bot"
    elif _TABLET_RE.search(ua):
        device = "tablet"
    elif _MOBILE_RE.search(ua):
        device = "mobile"
    else:
        device = "desktop"
    browser = next((name for name, rx in _BROWSERS if rx.search(ua)), "Other")
    return ClientInfo(device, browser, is_bot)
