from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
import time
from pathlib import Path
from urllib.parse import urlparse


REPO_ROOT = Path(__file__).resolve().parents[1]

# IMPORTANT: these are executed inside a Heroku dyno, so they must be repo-relative paths
# (the dyno does not have your local /Users/... filesystem).
SEED_EXTRUDERS_SCRIPT = Path("scripts") / "seed_extruders_from_tsv.py"
SEED_WASTE_FACTORS_SCRIPT = Path("scripts") / "seed_waste_factors_from_tsv.py"
SEED_PRINTING_PRICING_SCRIPT = Path("scripts") / "seed_printing_pricing_from_tsv.py"
SEED_CONVERSION_SCRIPT = Path("scripts") / "seed_conversion_from_tsv.py"
SEED_CARTON_OPTIONS_SCRIPT = Path("scripts") / "seed_carton_options_from_tsv.py"
SEED_ANILOX_SCRIPT = Path("scripts") / "seed_anilox_from_tsv.py"


def _run(cmd: list[str], *, cwd: Path | None = None, env: dict[str, str] | None = None) -> None:
    print(f"$ {' '.join(cmd)}", flush=True)
    subprocess.check_call(cmd, cwd=str(cwd or REPO_ROOT), env=env)


def _run_with_retry(
    cmd: list[str],
    *,
    cwd: Path | None = None,
    env: dict[str, str] | None = None,
    max_attempts: int = 3,
    retry_delay_sec: float = 30.0,
) -> None:
    """Run command; on failure retry up to max_attempts-1 times with delay (for transient 504 etc)."""
    print(f"$ {' '.join(cmd)}", flush=True)
    last = None
    for attempt in range(max_attempts):
        try:
            subprocess.check_call(cmd, cwd=str(cwd or REPO_ROOT), env=env)
            return
        except subprocess.CalledProcessError as e:
            last = e
            if attempt < max_attempts - 1:
                wait = retry_delay_sec * (1.5 ** attempt)
                print(
                    "Command failed (exit %s). Retrying in %.0fs (attempt %s/%s)…"
                    % (e.returncode, wait, attempt + 2, max_attempts),
                    flush=True,
                )
                time.sleep(wait)
            else:
                raise
    if last is not None:
        raise last


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


def _heroku_app_name(heroku_app: str) -> str:
    """Return the Heroku app name for CLI commands (e.g. pg:reset). If heroku_app is a URL, derive name from host."""
    if not _looks_like_url(heroku_app):
        return heroku_app
    host = urlparse(heroku_app).netloc or heroku_app
    if host.endswith(".herokuapp.com"):
        return host[: -len(".herokuapp.com")]
    return heroku_app


def _heroku_web_url(app: str) -> str | None:
    """
    Ask Heroku for the canonical web URL of the app (e.g. pipeline/review apps
    use URLs like https://crownpack-production-38f4b529d3b6.herokuapp.com/).
    """
    app_name = _heroku_app_name(app) if _looks_like_url(app) else app
    try:
        out = subprocess.check_output(
            ["heroku", "apps:info", "-a", app_name, "--json"],
            stderr=subprocess.STDOUT,
            text=True,
        )
        info = json.loads(out)
        if not isinstance(info, dict):
            return None
        # web_url is under the "app" key in heroku apps:info --json
        app_info = info.get("app")
        web = app_info.get("web_url") if isinstance(app_info, dict) else info.get("web_url")
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
            "Reset Heroku Postgres and run full seed (parity with reset_local_db).\n\n"
            "Steps:\n"
            "1. heroku pg:reset DATABASE (unless --skip-reset)\n"
            "2. alembic upgrade head\n"
            "3. Seed from TSVs: extruders, waste factors, printing pricing, conversion, carton options, anilox (unless --skip-tsv-seeds)\n"
            "4. create_admin.py (admin user with SYS_ADMIN)\n"
            "5. API import: plate customers + print plates from plate-db.tsv (unless --skip-plate-import)\n\n"
            "Use --skip-reset to re-run migrations/seeds without wiping the database."
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
        "--skip-reset",
        action="store_true",
        help="Skip heroku pg:reset (re-run migrations and seeds only).",
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
        "--skip-tsv-seeds",
        action="store_true",
        help="Skip seeding TSV-backed admin data (extruders/waste/printing pricing/conversion).",
    )
    p.add_argument(
        "--include-fixture-min-chain",
        action="store_true",
        help="Also run scripts/fixture_min_chain.py on Heroku (DB-level fixture insert)",
    )
    p.add_argument(
        "--skip-plate-import",
        action="store_true",
        help="Skip importing customers/plates via API.",
    )

    args = p.parse_args(argv)

    _require_heroku_cli()

    app_name = _heroku_app_name(args.heroku_app)
    base_url = (args.base_url or _default_base_url(args.heroku_app)).rstrip("/")

    plate_db_path = (REPO_ROOT / args.plate_db).resolve()
    if not plate_db_path.exists() and not args.skip_plate_import:
        raise SystemExit(f"ERROR: plate DB file not found: {plate_db_path}")

    if args.admin_password == "admin" and not os.getenv("SEED_ADMIN_PASSWORD"):
        print("WARNING: using default admin password 'admin' (set SEED_ADMIN_PASSWORD to override).", flush=True)

    # 0) Reset Heroku Postgres (destructive).
    if not args.skip_reset:
        print("Resetting Heroku database…", flush=True)
        _run_with_retry(
            ["heroku", "pg:reset", "DATABASE", "-a", app_name, "--confirm", app_name],
            max_attempts=3,
            retry_delay_sec=30.0,
        )
    else:
        print("Skipping pg:reset (--skip-reset).", flush=True)

    # 1) Migrations + TSV seeds (runs inside one-off dynos).
    _run(["heroku", "run", "-a", app_name, "--", "python", "-m", "alembic", "upgrade", "head"])
    if not args.skip_tsv_seeds:
        _run(["heroku", "run", "-a", app_name, "--", "python", SEED_EXTRUDERS_SCRIPT.as_posix()])
        _run(["heroku", "run", "-a", app_name, "--", "python", SEED_WASTE_FACTORS_SCRIPT.as_posix()])
        _run(["heroku", "run", "-a", app_name, "--", "python", SEED_PRINTING_PRICING_SCRIPT.as_posix()])
        _run(["heroku", "run", "-a", app_name, "--", "python", SEED_CONVERSION_SCRIPT.as_posix()])
        _run(["heroku", "run", "-a", app_name, "--", "python", SEED_CARTON_OPTIONS_SCRIPT.as_posix()])
        _run(["heroku", "run", "-a", app_name, "--", "python", SEED_ANILOX_SCRIPT.as_posix()])
    else:
        print("Skipping TSV seeds (--skip-tsv-seeds).", flush=True)

    # 2) Create/promote SYS_ADMIN user on Heroku DB (runs inside a one-off dyno).
    _run(
        [
            "heroku",
            "run",
            "-a",
            app_name,
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
        _run(["heroku", "run", "-a", app_name, "--", "python", "scripts/fixture_min_chain.py"])

    if args.skip_plate_import:
        print("Done (skipped plate import).", flush=True)
        return 0

    # 3) Import customers + plates via API against the Heroku URL (runs locally).
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
