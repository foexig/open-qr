# open-qr

Self-hosted dynamic QR code management with editable redirects, analytics and Docker deployment.

Print a QR code once and change where it points whenever you like. open-qr encodes
a short, random URL like `https://qr.example.com/r/a8X92kP` into each code. Scanning it
goes through your server, which records an anonymous scan and redirects to the
current target. Fix a typo, swap a campaign landing page or turn a code off
without reprinting anything.

No SaaS, no tracking pixels, no proprietary dependencies. One `docker compose up`.

## Features

- **Dynamic QR codes**: create, edit, rename, change the target URL, activate/deactivate, delete
- **Instant updates**: a changed target applies to the very next scan (no caching of redirects)
- **Random, non-sequential codes** (`/r/a8X92kP`) without look-alike characters (`0/O`, `1/l/I`)
- **Downloads** as PNG or SVG with configurable size, quiet zone and error correction (L/M/Q/H)
- **Analytics**: total scans, scans per day/week/month, last scan, charts, device class,
  browser family and referrer host, with likely bots/link previews flagged separately
- **Privacy by default**: no IP addresses, no cookies on scans, no raw user agents ([details](docs/PRIVACY.md))
- **Modern dashboard**: responsive, dark/light mode, no build step, no external CDNs
- **Secure by default**: Argon2 password hashing, server-side sessions, CSRF protection,
  strict CSP, rate-limited login, no default passwords, database never exposed
- **Multi-user ready**: every code belongs to a user; users only see their own codes
- **Easy operations**: one-click start scripts, automatic migrations, healthchecks, backup/restore scripts

## Screenshots

| Overview | QR code detail |
|---|---|
| ![Overview](docs/screenshots/overview.jpg) | ![Detail](docs/screenshots/detail.jpg) |

| QR code list | Dark mode |
|---|---|
| ![List](docs/screenshots/codes.jpg) | ![Dark mode](docs/screenshots/dark.jpg) |

## Requirements

- [Docker](https://docs.docker.com/get-docker/) with Docker Compose v2 (Docker Desktop on Windows/macOS, Docker Engine on Linux)
- About 300 MB of disk space for images plus your data
- For production: a domain name and a reverse proxy for HTTPS (examples included)

## Installation

```bash
git clone https://github.com/<your-account>/open-qr.git
cd open-qr
./start.sh            # Windows: double-click start.bat
```

The start script:

1. checks that Docker is installed and running,
2. creates `.env` from `.env.example` with a **random database password** on the first run,
3. builds and starts the containers (database migrations run automatically),
4. waits until the app is healthy and prints the URL, by default **http://localhost:8000**.

### First login

There are **no default credentials**. On the first start, open-qr generates a one-time
**setup token**. The start script prints it. You can also show it any time with:

```bash
docker compose exec app python -m app.cli setup-info
```

Open the dashboard, enter the token and create your admin account (password minimum
10 characters). The token becomes invalid once the first account exists.

### Stop, logs, update

```bash
./stop.sh                     # Windows: stop.bat - data is kept
docker compose logs -f app    # follow logs
git pull && ./start.sh        # update: rebuilds the image and migrates the database
```

## Docker deployment

`docker-compose.yml` runs two services:

| Service | Image | Notes |
|---|---|---|
| `db` | `postgres:17-alpine` | Data in the `db-data` volume. Only on an internal network, **never published**. |
| `app` | built from `Dockerfile` | Non-root user, read-only filesystem, all capabilities dropped. Runs `alembic upgrade head` on every start. |

The app is published on `127.0.0.1:8000` by default so that only a local reverse proxy
can reach it. Both services have healthchecks.

### Production with HTTPS

1. Point a DNS record (e.g. `qr.example.com`) at your server.
2. In `.env`, set `PUBLIC_BASE_URL=https://qr.example.com`. This URL is encoded into
   every QR code, so **set it before printing codes**. HTTPS here also turns on `Secure` cookies.
3. Put a reverse proxy in front:
   - **Caddy** (automatic certificates): see [`deploy/Caddyfile`](deploy/Caddyfile)
   - **Nginx + certbot**: see [`deploy/nginx.conf`](deploy/nginx.conf)
4. Set `FORWARDED_ALLOW_IPS` to your proxy's address as the container sees it, so
   `X-Forwarded-Proto` is trusted (see comments in `deploy/nginx.conf`).
5. `./start.sh`

Without a reverse proxy on a trusted LAN, you can set `BIND_ADDRESS=0.0.0.0` and
`PUBLIC_BASE_URL=http://<server-ip>:8000`. Do not expose plain HTTP to the internet.

## Configuration

All settings live in `.env` (see [`.env.example`](.env.example)):

| Variable | Default | Description |
|---|---|---|
| `POSTGRES_PASSWORD` | *(generated)* | Database password. Required. |
| `PUBLIC_BASE_URL` | `http://localhost:8000` | Base URL encoded into QR codes (`<base>/r/<code>`). |
| `APP_PORT` | `8000` | Host port. |
| `BIND_ADDRESS` | `127.0.0.1` | Host interface; `0.0.0.0` exposes it on all interfaces. |
| `CODE_LENGTH` | `7` | Length of new random codes (5-32). |
| `SESSION_LIFETIME_HOURS` | `168` | Login session lifetime. |
| `STATS_TIMEZONE` | `UTC` | IANA timezone for daily/weekly/monthly grouping. |
| `STORE_USER_AGENT` | `false` | Store the raw user agent string of scans. |
| `STORE_REFERRER` | `true` | Store the referrer **host** (never the full URL). |
| `FORWARDED_ALLOW_IPS` | `127.0.0.1` | Proxies trusted for `X-Forwarded-*` headers. |
| `ENABLE_API_DOCS` | `false` | Serve OpenAPI docs at `/api/docs`. |

After changing `.env`, run `./start.sh` again.

### User management

Additional users can be created from the command line:

```bash
docker compose exec app python -m app.cli create-user --username bob [--email bob@example.com] [--admin]
docker compose exec app python -m app.cli reset-password --username bob
docker compose exec app python -m app.cli list-users
```

## Backup and restore

```bash
./backup.sh                                   # Windows: backup.bat
# -> backups/open-qr-YYYYMMDD-HHMMSS.dump (PostgreSQL custom format)

./restore.sh backups/open-qr-20260101-120000.dump   # replaces all current data
```

Backups contain password hashes and scan data. Store them securely and off-site.
Removing the volume (`docker compose down -v`) **deletes all data**.

## Security

- **No default passwords.** The first admin is created with a one-time setup token
  that only someone with server or log access can read.
- **Passwords** are hashed with Argon2id. Login and setup are rate-limited.
- **Sessions** are random 256-bit tokens, stored only as SHA-256 hashes, sent as an
  `HttpOnly`, `SameSite=Strict` cookie (`Secure` with HTTPS), and revocable. Changing
  a password signs out all other sessions.
- **CSRF**: every state-changing request needs a per-session token header.
- **Authorization**: only authenticated users can create or change codes; users can
  only access their own codes (other users' codes return 404).
- **Input validation**: target URLs must be absolute `http(s)` URLs without embedded
  credentials, at most 2048 characters, and may not point back to open-qr itself (redirect loops).
- **Headers**: strict Content-Security-Policy (no inline scripts), `X-Frame-Options: DENY`,
  `nosniff`, `Referrer-Policy`, `Permissions-Policy`.
- **Containers**: non-root, read-only root filesystem, `no-new-privileges`, all Linux
  capabilities dropped. PostgreSQL sits on an internal network without a published port.
- **Secrets**: `.env` is git-ignored and created with mode 600.

Note: open-qr is an open redirect *for authenticated users' chosen targets*, which is
inherent to the product. Only give accounts to people you trust.

Found a vulnerability? Please report it privately via GitHub Security Advisories
instead of opening a public issue.

## Privacy and GDPR

Scan statistics are collected without cookies, without IP addresses and without
fingerprinting. Only timestamp, device class, browser family, a bot flag and (optionally)
the referrer host are stored. Scan counts are **not** guaranteed unique human visitors:
link previews, security scanners and repeat scans are counted too. Likely bots are
flagged and shown separately. See [docs/PRIVACY.md](docs/PRIVACY.md) for details and
notes for your privacy policy.

## Development

The architecture and the design decisions are documented in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

```bash
# Run the whole test suite in Docker against a throwaway PostgreSQL
./scripts/test.sh

# End-to-end test of the production Docker setup (build, setup, redirect, restart)
./scripts/smoke-test.sh
```

Local development without Docker for the app:

```bash
python3.12 -m venv .venv && . .venv/bin/activate
pip install -r requirements-dev.txt
docker run -d --name openqr-dev-db -e POSTGRES_USER=openqr -e POSTGRES_PASSWORD=dev \
  -e POSTGRES_DB=openqr -p 127.0.0.1:5432:5432 postgres:17-alpine
export DATABASE_URL=postgresql+psycopg://openqr:dev@localhost:5432/openqr
alembic upgrade head
uvicorn app.main:app --reload
# tests (use a separate database; it is wiped):
TEST_DATABASE_URL=postgresql+psycopg://openqr:dev@localhost:5432/openqr_test python -m pytest
```

Creating a migration after changing `app/models.py`:

```bash
alembic revision --autogenerate -m "describe change"
```

See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

## License

[MIT](LICENSE)
