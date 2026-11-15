# Changelog

All notable changes to this project are documented here.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the
project uses [Semantic Versioning](https://semver.org/).

## [Unreleased]

## [0.1.0] - 2026-11-15

### Added
- Dynamic QR codes with editable target URLs, activation toggle and deletion
- Random non-sequential short codes (`/r/{code}`) with 302 redirects
- PNG and SVG downloads with configurable size, quiet zone and error correction
- Privacy-friendly scan statistics: per day/week/month, devices, browsers, referrer hosts, bot flag
- Responsive dashboard with dark/light mode
- Argon2 authentication, server-side sessions, CSRF protection, one-time setup token
- Multi-user data separation and admin CLI
- Docker Compose deployment with healthchecks, automatic migrations and hardened containers
- Start/stop/backup/restore scripts for Linux, macOS and Windows
- Test suite (pytest against PostgreSQL) and Docker smoke test, GitHub Actions CI
