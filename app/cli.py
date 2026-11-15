"""Admin command line tools.

Usage (inside the container):
    python -m app.cli setup-info
    python -m app.cli create-user --username alice [--email a@b.c] [--admin]
    python -m app.cli reset-password --username alice
    python -m app.cli list-users
"""

import argparse
import getpass
import sys
from pathlib import Path

from sqlalchemy import delete, select

from .config import get_settings
from .db import get_sessionmaker
from .models import User, UserSession
from .security import MIN_PASSWORD_LENGTH, hash_password
from .setup_state import users_exist


def _read_password(from_stdin: bool) -> str:
    if from_stdin:
        password = sys.stdin.readline().rstrip("\n")
    else:
        password = getpass.getpass("New password: ")
        if password != getpass.getpass("Repeat password: "):
            sys.exit("Passwords do not match.")
    if len(password) < MIN_PASSWORD_LENGTH:
        sys.exit(f"Password must be at least {MIN_PASSWORD_LENGTH} characters.")
    return password


def cmd_setup_info(_args) -> int:
    with get_sessionmaker()() as db:
        if users_exist(db):
            print("Setup already completed. Sign in with your admin account.")
            return 0
    path = Path(get_settings().setup_token_file)
    if not path.exists():
        print("Setup required, but no token file found. Is the server running?", file=sys.stderr)
        return 1
    print(f"SETUP TOKEN: {path.read_text().strip()}")
    return 0


def cmd_create_user(args) -> int:
    password = _read_password(args.password_stdin)
    with get_sessionmaker()() as db:
        if db.scalar(select(User).where(User.username == args.username)):
            print(f"User {args.username!r} already exists.", file=sys.stderr)
            return 1
        db.add(
            User(
                username=args.username,
                email=args.email.lower() if args.email else None,
                password_hash=hash_password(password),
                is_admin=args.admin,
            )
        )
        db.commit()
    print(f"User {args.username!r} created.")
    return 0


def cmd_reset_password(args) -> int:
    password = _read_password(args.password_stdin)
    with get_sessionmaker()() as db:
        user = db.scalar(select(User).where(User.username == args.username))
        if user is None:
            print(f"User {args.username!r} not found.", file=sys.stderr)
            return 1
        user.password_hash = hash_password(password)
        db.execute(delete(UserSession).where(UserSession.user_id == user.id))
        db.commit()
    print(f"Password for {args.username!r} reset; all sessions were signed out.")
    return 0


def cmd_list_users(_args) -> int:
    with get_sessionmaker()() as db:
        for u in db.scalars(select(User).order_by(User.id)):
            flags = ("admin " if u.is_admin else "") + ("" if u.is_active else "disabled")
            print(f"{u.id:>4}  {u.username:<24} {u.email or '-':<32} {flags}")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(prog="python -m app.cli", description="open-qr admin tools")
    sub = parser.add_subparsers(dest="cmd", required=True)
    sub.add_parser("setup-info", help="print the first-run setup token").set_defaults(
        fn=cmd_setup_info
    )
    p = sub.add_parser("create-user", help="create a user")
    p.add_argument("--username", required=True)
    p.add_argument("--email")
    p.add_argument("--admin", action="store_true")
    p.add_argument("--password-stdin", action="store_true")
    p.set_defaults(fn=cmd_create_user)
    p = sub.add_parser("reset-password", help="set a new password for a user")
    p.add_argument("--username", required=True)
    p.add_argument("--password-stdin", action="store_true")
    p.set_defaults(fn=cmd_reset_password)
    sub.add_parser("list-users", help="list all users").set_defaults(fn=cmd_list_users)
    args = parser.parse_args()
    return args.fn(args)


if __name__ == "__main__":
    sys.exit(main())
