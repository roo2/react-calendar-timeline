from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[1]


def _run(cmd: list[str], *, cwd: Path | None = None, env: dict[str, str] | None = None) -> None:
    print(f"$ {' '.join(cmd)}", flush=True)
    subprocess.check_call(cmd, cwd=str(cwd or REPO_ROOT), env=env)


def _require_heroku_cli() -> None:
    try:
        subprocess.check_output(["heroku", "--version"], stderr=subprocess.STDOUT, text=True)
    except Exception as e:
        raise SystemExit(
            "ERROR: Heroku CLI not found or not working. "
            "Install/login first, then re-run. "
            f"Underlying error: {e}"
        )


def _looks_like_url(s: str) -> bool:
    return s.startswith("http://") or s.startswith("https://")


def _heroku_web_url(app: str) -> str | None:
    """
    Ask Heroku for the canonical web URL of the app.
    This is more reliable than guessing https://<app>.herokuapp.com because some
    environments/apps use different hostnames or custom domains.
    """
    try:
        out = subprocess.check_output(
            ["heroku", "apps:info", "-a", app, "--json"],
            stderr=subprocess.STDOUT,
            text=True,
        )
        info = json.loads(out)
        web = info.get("web_url") if isinstance(info, dict) else None
        if isinstance(web, str) and web.strip():
            return web.strip().rstrip("/")
    except Exception:
        return None
    return None


def _default_base_url(app_or_url: str) -> str:
    # Accept either an app name or a full URL; if it looks like a URL, keep it.
    if _looks_like_url(app_or_url):
        return app_or_url.rstrip("/")

    web = _heroku_web_url(app_or_url)
    if web:
        return web

    # Fallback (common default)
    return f"https://{app_or_url}.herokuapp.com"


def main(argv: list[str]) -> int:
    p = argparse.ArgumentParser(
        description=(
            "Run seed steps against a Heroku deployment.\n\n"
            "Assumes you have already cleared the DB and run migrations.\n"
            "This script will:\n"
            "- heroku run scripts/create_admin.py to create/promote a SYS_ADMIN user\n"
            "- run API import scripts locally against the Heroku URL to import customers and plates from plate-db.tsv"
        )
    )
    p.add_argument(
        "--heroku-app",
        default="crownpack-production",
        help="Heroku app name (default: crownpack-production) OR full base URL",
    )
    p.add_argument(
        "--base-url",
        default=None,
        help="API base URL (optional). If omitted, uses Heroku app web_url.",
    )
    p.add_argument(
        "--admin-username",
        default=os.getenv("SEED_ADMIN_USERNAME", "admin"),
        help="Admin username to create/promote (default: admin or SEED_ADMIN_USERNAME)",
    )
    p.add_argument(
        "--admin-password",
        default=os.getenv("SEED_ADMIN_PASSWORD", "admin"),
        help="Admin password to set (default: 'admin' or SEED_ADMIN_PASSWORD)",
    )
    p.add_argument(
        "--plate-db",
        default=str(Path("scripts") / "plate-db.tsv"),
        help="Plate database file path relative to repo root (default: scripts/plate-db.tsv)",
    )
    p.add_argument(
        "--include-fixture-min-chain",
        action="store_true",
        help="Also run scripts/fixture_min_chain.py on Heroku (DB-level fixture insert)",
    )
    p.add_argument(
        "--skip-plate-import",
        action="store_true",
        help="Skip importing customers/plates via API (only create/promote admin user).",
    )

    args = p.parse_args(argv)

    _require_heroku_cli()

    base_url = (args.base_url or _default_base_url(args.heroku_app)).rstrip("/")

    plate_db_path = (REPO_ROOT / args.plate_db).resolve()
    if not plate_db_path.exists() and not args.skip_plate_import:
        raise SystemExit(f"ERROR: plate DB file not found: {plate_db_path}")

    if args.admin_password == "admin" and not os.getenv("SEED_ADMIN_PASSWORD"):
        print("WARNING: using default admin password 'admin' (set SEED_ADMIN_PASSWORD to override).", flush=True)

    # 1) Create/promote SYS_ADMIN user on Heroku DB (runs inside a one-off dyno).
    # Note: this does not run migrations; user said they'll do that manually.
    _run(
        [
            "heroku",
            "run",
            "-a",
            args.heroku_app,
            "--",
            "python",
            "scripts/create_admin.py",
            "--username",
            args.admin_username,
            "--password",
            args.admin_password,
            "--reset-password",
            "--roles",
            "SYS_ADMIN",
        ]
    )

    if args.include_fixture_min_chain:
        _run(["heroku", "run", "-a", args.heroku_app, "--", "python", "scripts/fixture_min_chain.py"])

    if args.skip_plate_import:
        print("Done (skipped plate import).", flush=True)
        return 0

    # 2) Import customers + plates via API against the Heroku URL (runs locally).
    py = sys.executable or "python"
    _run(
        [
            py,
            str(REPO_ROOT / "scripts" / "api_import_plate_customers.py"),
            str(plate_db_path),
            "--base-url",
            base_url,
            "--username",
            args.admin_username,
            "--password",
            args.admin_password,
            "--delimiter",
            "\\t",
        ]
    )
    _run(
        [
            py,
            str(REPO_ROOT / "scripts" / "api_import_print_plates.py"),
            str(plate_db_path),
            "--base-url",
            base_url,
            "--username",
            args.admin_username,
            "--password",
            args.admin_password,
            "--delimiter",
            "\\t",
        ]
    )

    print("Done.", flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))

