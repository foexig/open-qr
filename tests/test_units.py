import pytest
from alembic import command
from sqlalchemy import inspect

from app.db import get_engine
from app.util import (
    CODE_ALPHABET,
    classify_user_agent,
    generate_code,
    referrer_host,
    validate_target_url,
)

from .conftest import alembic_config


def test_generate_code_alphabet():
    code = generate_code(12)
    assert len(code) == 12 and set(code) <= set(CODE_ALPHABET)
    for ambiguous in "0O1lI":
        assert ambiguous not in CODE_ALPHABET


@pytest.mark.parametrize(
    "url", ["https://example.com", "http://example.com/a?b=c#d", "https://xn--mnchen-3ya.de/"]
)
def test_valid_urls(url):
    assert validate_target_url(url) == url


@pytest.mark.parametrize(
    "url", ["javascript:alert(1)", "https://a b.com", "https://u:p@x.com", "mailto:a@b.c", ""]
)
def test_invalid_urls(url):
    with pytest.raises(ValueError):
        validate_target_url(url)


@pytest.mark.parametrize(
    ("ua", "device", "browser", "bot"),
    [
        ("", "unknown", "Unknown", False),
        ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/129.0 Safari/537.36",
         "desktop", "Chrome", False),
        ("Mozilla/5.0 (Windows NT 10.0) AppleWebKit/537.36 Chrome/129.0 Safari/537.36 Edg/129.0",
         "desktop", "Edge", False),
        ("Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Version/17.0 Safari/604.1",
         "tablet", "Safari", False),
        ("Mozilla/5.0 (Linux; Android 14; SM-S918B) AppleWebKit/537.36 SamsungBrowser/25.0 Chrome/121.0 Mobile Safari/537.36",
         "mobile", "Samsung Internet", False),
        ("facebookexternalhit/1.1", "bot", "Other", True),
        ("curl/8.5.0", "bot", "Other", True),
    ],
)
def test_classify_user_agent(ua, device, browser, bot):
    info = classify_user_agent(ua)
    assert (info.device_type, info.browser, info.is_bot) == (device, browser, bot)


def test_referrer_host():
    assert referrer_host("https://Example.com:8443/path?q=1") == "example.com"
    assert referrer_host("not a url") is None
    assert referrer_host(None) is None


def test_migrations_roundtrip():
    cfg = alembic_config()
    command.downgrade(cfg, "base")
    assert "qr_codes" not in inspect(get_engine()).get_table_names()
    command.upgrade(cfg, "head")
    insp = inspect(get_engine())
    assert {"users", "sessions", "qr_codes", "scans"} <= set(insp.get_table_names())
    fks = insp.get_foreign_keys("scans")
    assert fks[0]["referred_table"] == "qr_codes" and fks[0]["options"]["ondelete"] == "CASCADE"
    index_names = {i["name"] for i in insp.get_indexes("scans")}
    assert "ix_scans_qr_code_id_scanned_at" in index_names
