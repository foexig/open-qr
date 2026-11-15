# Contributing to open-qr

Thanks for your interest! Bug reports, fixes and focused improvements are welcome.

## Principles

open-qr prioritises **functionality, security, easy installation and long-term
maintainability** over features. Before adding a dependency or a large feature,
please open an issue to discuss it.

## Workflow

1. Fork the repository and create a branch: `git checkout -b fix/short-description`
2. Make your change, with tests.
3. Run the test suite: `./scripts/test.sh` (needs only Docker)
4. For changes to Docker, scripts or startup: also run `./scripts/smoke-test.sh`
5. Update `CHANGELOG.md` under "Unreleased".
6. Open a pull request describing what and why.

## Guidelines

- Python 3.12+, type hints, small functions, follow the existing style.
- Database changes need an Alembic migration (`alembic revision --autogenerate -m "..."`);
  check the generated file by hand and keep migrations reversible.
- The dashboard is plain HTML/CSS/JS without a build step and must work under the
  strict CSP: no inline scripts, no inline `style` attributes, no external CDNs.
- Never commit secrets, `.env` files, database dumps or real user data.
- Security issues: report privately via GitHub Security Advisories, not as public issues.

## License

By contributing you agree that your contributions are licensed under the MIT License.
