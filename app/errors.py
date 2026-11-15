"""Minimal HTML error pages for public endpoints."""

from html import escape

from fastapi.responses import HTMLResponse

_TEMPLATE = """<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>{title} · open-qr</title>
<link rel="icon" href="/static/favicon.svg" type="image/svg+xml">
<link rel="stylesheet" href="/static/styles.css">
</head>
<body class="error-body">
<main class="error-card">
  <div class="error-code">{status}</div>
  <h1>{title}</h1>
  <p>{message}</p>
</main>
</body>
</html>
"""


def error_page(status: int, title: str, message: str) -> HTMLResponse:
    html = _TEMPLATE.format(status=status, title=escape(title), message=escape(message))
    return HTMLResponse(html, status_code=status, headers={"Cache-Control": "no-store"})
