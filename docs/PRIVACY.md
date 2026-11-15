# Privacy and GDPR notes

open-qr is designed to collect as little personal data as possible while still
giving useful scan statistics. This page describes exactly what is stored so you can
write an accurate privacy policy. It is not legal advice.

## What happens on a scan

`GET /r/{code}`:

1. The code is looked up. Unknown codes return 404 and inactive codes return 410.
   Neither creates a database row.
2. One row is inserted into `scans`:

| Field | Content | Personal data? |
|---|---|---|
| `scanned_at` | Timestamp (UTC) | No |
| `device_type` | `mobile`, `tablet`, `desktop`, `bot` or `unknown` | No (coarse class) |
| `browser` | Browser family such as `Chrome` or `Safari`, without version | No (coarse class) |
| `is_bot` | Heuristic flag for crawlers and link previews | No |
| `referrer` | **Host only** of the `Referer` header (e.g. `instagram.com`), if `STORE_REFERRER=true` | Unlikely |
| `user_agent` | Raw user agent string, **only if** `STORE_USER_AGENT=true` (default `false`) | Possibly, as part of a fingerprint |

3. The browser is redirected with `302 Found` and `Cache-Control: no-store`.

**Not stored:** IP addresses (neither full nor truncated), cookies, device IDs,
precise location, full referrer URLs or query strings. No cookie is set on scans, so
no consent banner is needed for the redirect itself. `HEAD` requests are not counted.

The reverse proxy (Nginx, Caddy) may write IP addresses into its own access logs.
Configure log rotation or anonymisation there if that matters to you.

## Interpreting the numbers

Scan counts are **requests**, not unique people:

- Messenger and social networks fetch links to build previews (WhatsApp, Slack,
  Facebook and others).
- Email security gateways and antivirus software follow links.
- One person may scan a code several times.

User agents matching known bots and preview fetchers get `is_bot = true` and appear as
"likely bots" in the dashboard. The heuristic is incomplete, so treat all numbers as
an approximation.

## Retention and deletion

- Deleting a QR code deletes all of its scans (database `ON DELETE CASCADE`).
- There is no automatic expiry. To delete old scans manually:
  ```bash
  docker compose exec db psql -U openqr -d openqr \
    -c "DELETE FROM scans WHERE scanned_at < now() - interval '13 months';"
  ```

## Account data

For dashboard users open-qr stores the username, an optional email address, an
Argon2 password hash and active sessions (only a SHA-256 hash of the token, creation
and expiry time). The dashboard uses one strictly
necessary session cookie (`openqr_session`) and stores the theme preference in
`localStorage`.

## Suggested privacy policy wording

> When you scan one of our QR codes, you are redirected via our own server
> (`qr.example.com`). We record the time of the scan, the device type (e.g. mobile),
> the browser family and, if provided by your browser, the domain of the referring
> page, to count how often our codes are used. We do not store your IP address,
> do not set cookies and cannot identify you. Legal basis: Art. 6(1)(f) GDPR
> (legitimate interest in measuring the reach of our printed materials).
