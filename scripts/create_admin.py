from __future__ import annotations

import argparse
import getpass
import secrets
import sys
from pathlib import Path
from typing import Iterable, Sequence

_REPO_ROOT = Path(__file__).resolve().parents[1]
if str(_REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(_REPO_ROOT))

from sqlalchemy import select

from app.auth.models import Role, User
from app.auth.security import ROLES, hash_password, verify_password
from app.db.session import SessionLocal


def _parse_roles(raw: str) -> list[str]:
    roles = [r.strip() for r in raw.split(",") if r.strip()]
    if not roles:
        raise argparse.ArgumentTypeError("roles cannot be empty")
    unknown = [r for r in roles if r not in ROLES]
    if unknown:
        raise argparse.ArgumentTypeError(f"unknown role(s): {', '.join(unknown)}")
    # preserve order, remove duplicates
    seen: set[str] = set()
    out: list[str] = []
    for r in roles:
        if r not in seen:
            seen.add(r)
            out.append(r)
    return out


def _debug_info() -> str:
    # Import lazily to avoid eager DB work if argparse fails early.
    from app.db.session import engine  # noqa: WPS433

    try:
        url = engine.url.render_as_string(hide_password=True)  # SQLAlchemy 2.x
    except Exception:
        url = str(engine.url)
    return (
        "Debug:\n"
        f"- DATABASE_URL_set={bool(__import__('os').getenv('DATABASE_URL'))}\n"
        f"- db_url={url}\n"
        f"- dialect={engine.dialect.name}\n"
        "- argon2_available=True\n"
    )


def _ensure_roles(db, roles: Sequence[str]) -> list[Role]:
    role_objs: list[Role] = []
    for code in roles:
        role = db.scalar(select(Role).where(Role.code == code))
        if role is None:
            role = Role(code=code)
            db.add(role)
            db.flush()  # assign PK
        role_objs.append(role)
    return role_objs


def _choose_password(args) -> tuple[str, bool]:
    """
    Returns (password, did_generate_or_prompt).
    """
    if args.password and args.generate_password:
        raise SystemExit("ERROR: use either --password or --generate-password (not both)")

    if args.password:
        return args.password, False

    if args.generate_password:
        # URL-safe and easy to paste; long enough for test/admin bootstrap
        return secrets.token_urlsafe(24), True

    # Prompt (no echo)
    pw1 = getpass.getpass("Password: ")
    if not pw1:
        raise SystemExit("ERROR: empty password not allowed")
    pw2 = getpass.getpass("Confirm password: ")
    if pw1 != pw2:
        raise SystemExit("ERROR: passwords did not match")
    return pw1, True


def _upsert_user(
    username: str,
    password: str,
    roles: Iterable[str],
    *,
    reset_password: bool,
    verify_after: bool,
) -> None:
    with SessionLocal() as db:
        with db.begin():
            role_objs = _ensure_roles(db, list(roles))

            user = db.scalar(select(User).where(User.username == username))
            created = False
            if user is None:
                user = User(username=username, password_hash=hash_password(password), is_active=True)
                db.add(user)
                db.flush()
                created = True
            else:
                user.is_active = True
                if reset_password:
                    user.password_hash = hash_password(password)

            # Sync roles (set exactly)
            user.roles = role_objs

    action = "created" if created else "updated"
    reset_note = " (password reset)" if (reset_password and not created) else ""
    print(f"OK: {action} user '{username}' with roles: {', '.join(roles)}{reset_note}")
    if (not created) and (not reset_password):
        print("NOTE: user already existed; password was NOT changed (use --reset-password to change it).")

    if verify_after:
        with SessionLocal() as db:
            user = db.scalar(select(User).where(User.username == username))
            if not user:
                raise SystemExit("ERROR: user not found after write (unexpected)")
            ok = verify_password(password, user.password_hash)
            print(f"Verify: password_check={'OK' if ok else 'FAIL'} for '{username}'")


def main(argv: Sequence[str] | None = None) -> int:
    p = argparse.ArgumentParser(
        description="Create or promote a SYS_ADMIN user (works locally or on Heroku via DATABASE_URL)."
    )
    p.add_argument("--username", required=True, help="Username to create/promote (e.g. admin)")
    p.add_argument(
        "--roles",
        default="SYS_ADMIN",
        type=_parse_roles,
        help="Comma-separated roles to assign (default: SYS_ADMIN). Allowed: "
        + ", ".join(sorted(ROLES)),
    )
    p.add_argument("--password", help="Password (if omitted, you'll be prompted)")
    p.add_argument(
        "--generate-password",
        action="store_true",
        help="Generate a random password and print it once",
    )
    p.add_argument(
        "--reset-password",
        action="store_true",
        help="If user exists, reset their password to the provided/generated one",
    )
    p.add_argument("--debug", action="store_true", help="Print DB/crypto debug info and exit")
    p.add_argument(
        "--verify",
        action="store_true",
        help="After creating/updating, verify the password against the stored hash",
    )

    args = p.parse_args(argv)
    if args.debug:
        print(_debug_info())
        return 0
    password, did_choose_interactively = _choose_password(args)

    if args.generate_password:
        # Print to stdout intentionally (this is a bootstrap script).
        print(f"Generated password for '{args.username}': {password}")
    elif did_choose_interactively and not args.password:
        # Don't echo prompted passwords.
        pass

    _upsert_user(
        username=args.username,
        password=password,
        roles=args.roles,
        reset_password=bool(args.reset_password),
        verify_after=bool(args.verify),
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))

