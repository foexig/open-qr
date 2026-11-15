# Architecture and design decisions

## Overview

```
 Phone camera ──▶ GET /r/{code} ─┐
                                 │        ┌──────────────┐     ┌──────────────┐
 Browser ──▶ / (dashboard SPA) ──┼──────▶ │ FastAPI app  │ ──▶ │ PostgreSQL   │
          ──▶ /api/*  (JSON)   ──┘        │ (uvicorn)    │     │ (internal    │
                                          └──────────────┘     │  network)    │
                                                               └──────────────┘
```

```
app/
  main.py         app factory, security headers middleware, static files, health
  config.py       settings from environment variables (pydantic-settings)
  db.py           engine / session factory
  models.py       SQLAlchemy 2 models: User, UserSession, QRCode, Scan
  schemas.py      Pydantic request/response models and validation
  security.py     Argon2 hashing, token helpers, login rate limiter
  deps.py         auth dependencies: current user, CSRF check
  setup_state.py  one-time setup token for the first admin
  util.py         code generation, URL validation, user-agent classification
  qr_image.py     PNG/SVG rendering (qrcode library)
  stats.py        aggregation queries (date_trunc per timezone)
  routes/         auth, qrcodes (+ stats), redirect
  cli.py          admin commands (setup-info, create-user, reset-password, ...)
  static/         dashboard: index.html, app.js, styles.css (no build step)
alembic/          migrations, run automatically on container start
tests/            pytest suite against real PostgreSQL
```

## Data model

- `users`: username (unique), optional email (unique), Argon2 hash, `is_admin`, `is_active`
- `sessions`: SHA-256 of the session token, CSRF token, expiry, FK → users (cascade)
- `qr_codes`: `code` (unique, indexed), name, description, `target_url`, `is_active`,
  FK → users (cascade), index on (`user_id`, `created_at`)
- `scans`: FK → qr_codes (cascade), `scanned_at`, device/browser/bot/referrer,
  indexes on (`qr_code_id`, `scanned_at`) and `scanned_at`

## Decisions

| Decision | Reason |
|---|---|
| **FastAPI + server-rendered static SPA, no frontend build** | Fewer moving parts and dependencies, nothing to compile, easy to audit. |
| **PostgreSQL only** (no SQLite fallback) | One code path. `date_trunc` with timezones and `FILTER` keep statistics in SQL. Tests run against real Postgres. |
| **302, not 301** | Browsers cache 301 permanently, so an edited target would never be seen. `Cache-Control: no-store` for the same reason. |
| **Redirect never fails because of statistics** | Scan inserts are wrapped. If recording fails, the redirect still happens and the error is logged. |
| **Random codes from a 57-character alphabet without look-alikes** | Not enumerable (57^7 ≈ 1.9·10^12), readable when typed by hand. Collisions are retried. |
| **The code is immutable** | It is printed. Only the target changes. |
| **Server-side sessions instead of JWT** | Instant revocation (logout, password change), nothing sensitive client-side. |
| **Cookie `SameSite=Strict` + CSRF header** | Defence in depth against cross-site requests. |
| **Setup token instead of default admin** | No default password can ever leak. The token is only visible to someone with server access. |
| **In-memory rate limiter, single worker** | Simple and sufficient for a self-hosted tool. A single uvicorn worker easily handles hundreds of redirects per second. Scale vertically or put the limiter in Postgres/Redis if needed. |
| **Self-redirect check** | Targets pointing to `PUBLIC_BASE_URL/r/...` are rejected to prevent redirect loops. |
| **No IP storage** | Privacy by design. Unique-visitor counts would require personal data. |
| **Read-only container, non-root** | Limits the impact of a compromise. Only `/tmp` (tmpfs) is writable. |
| **Migrations on start** | `alembic upgrade head` is idempotent. Updates are just `git pull && ./start.sh`. |
