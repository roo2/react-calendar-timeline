from __future__ import annotations

import argparse
import os
import signal
import subprocess
import sys
import time
from pathlib import Path
from urllib.request import urlopen


REPO_ROOT = Path(__file__).resolve().parents[1]

CREATE_ADMIN_SCRIPT = (REPO_ROOT / "scripts" / "create_admin.py").resolve()
IMPORT_PLATE_CUSTOMERS_SCRIPT = (REPO_ROOT / "scripts" / "api_import_plate_customers.py").resolve()
IMPORT_PRINT_PLATES_SCRIPT = (REPO_ROOT / "scripts" / "api_import_print_plates.py").resolve()
SEED_EXTRUDERS_SCRIPT = (REPO_ROOT / "scripts" / "seed_extruders_from_tsv.py").resolve()
SEED_WASTE_FACTORS_SCRIPT = (REPO_ROOT / "scripts" / "seed_waste_factors_from_tsv.py").resolve()
SEED_PRINTING_PRICING_SCRIPT = (REPO_ROOT / "scripts" / "seed_printing_pricing_from_tsv.py").resolve()
SEED_CONVERSION_SCRIPT = (REPO_ROOT / "scripts" / "seed_conversion_from_tsv.py").resolve()


def _can_import(module: str, python_exe: str) -> bool:
    try:
        subprocess.check_output(
            [python_exe, "-c", f"import {module}"],
            cwd=str(REPO_ROOT),
            stderr=subprocess.STDOUT,
        )
        return True
    except Exception:
        return False


def _choose_python() -> str:
    """
    Prefer the project's virtualenv interpreter if available.

    This script may be invoked with a system Python that doesn't have dependencies
    like alembic installed; in that case we fall back to .venv/bin/python.
    """
    candidates: list[str] = []
    if sys.executable:
        candidates.append(sys.executable)

    venv_bin = REPO_ROOT / ".venv" / "bin"
    for name in ("python", "python3"):
        p = venv_bin / name
        if p.exists():
            candidates.append(str(p))

    for py in candidates:
        if _can_import("alembic", py) and _can_import("uvicorn", py):
            return py

    for py in candidates:
        if _can_import("alembic", py):
            return py

    raise RuntimeError(
        "Could not find a Python interpreter with Alembic installed. "
        "Activate the project's venv and install requirements, then re-run. "
        "Example: `source .venv/bin/activate && pip install -r requirements.txt`."
    )


def _run(cmd: list[str], *, env: dict[str, str] | None = None) -> None:
    print(f"$ {' '.join(cmd)}", flush=True)
    subprocess.check_call(cmd, cwd=str(REPO_ROOT), env=env)


def _http_get_ok(url: str, timeout_s: float = 2.0) -> bool:
    try:
        with urlopen(url, timeout=timeout_s) as resp:
            return 200 <= getattr(resp, "status", 0) < 300
    except Exception:
        return False


def _wait_for_http(url: str, *, timeout_s: float = 20.0) -> None:
    deadline = time.time() + timeout_s
    while time.time() < deadline:
        if _http_get_ok(url, timeout_s=2.0):
            return
        time.sleep(0.25)
    raise RuntimeError(f"Timed out waiting for {url}")


def main(argv: list[str]) -> int:
    p = argparse.ArgumentParser(
        description="Reset local SQLite DB (production.db), create admin/admin, and import customers + print plates from plate-db.tsv."
    )
    p.add_argument(
        "--db-path",
        default="production.db",
        help="SQLite DB file path relative to repo root (default: production.db)",
    )
    p.add_argument(
        "--api-port",
        type=int,
        default=int(os.getenv("API_PORT", "8001")),
        help="Port to run the temporary API server on (default: 8001)",
    )
    p.add_argument(
        "--no-api",
        action="store_true",
        help="Skip starting/pinging the API and skip importing plate DB data",
    )
    p.add_argument(
        "--plate-db",
        default=str(Path("scripts") / "plate-db.tsv"),
        help="Plate database file path relative to repo root (default: scripts/plate-db.tsv)",
    )
    p.add_argument(
        "--no-migrations",
        action="store_true",
        help="Skip alembic upgrade head (not recommended)",
    )
    args = p.parse_args(argv)

    py = _choose_python()
    print(f"Using python: {py}")

    db_path = (REPO_ROOT / args.db_path).resolve()
    wal_path = db_path.with_suffix(db_path.suffix + "-wal")
    shm_path = db_path.with_suffix(db_path.suffix + "-shm")
    journal_path = db_path.with_suffix(db_path.suffix + "-journal")

    # Force local DB, regardless of caller shell env (prevents invalid/remote DATABASE_URL breaking reset).
    env = os.environ.copy()
    env["DATABASE_URL"] = f"sqlite+pysqlite:///{db_path}"

    print(f"DB file: {db_path}")
    if db_path.exists():
        print(f"Deleting {db_path}")
        db_path.unlink()
    else:
        print("DB file does not exist; continuing")
    for extra in (wal_path, shm_path, journal_path):
        if extra.exists():
            print(f"Deleting {extra}")
            extra.unlink()

    if not args.no_migrations:
        _run([py, "-m", "alembic", "upgrade", "head"], env=env)

        # Seed non-ratecard admin master data from TSVs.
        _run([py, str(SEED_EXTRUDERS_SCRIPT)], env=env)
        _run([py, str(SEED_WASTE_FACTORS_SCRIPT)], env=env)
        _run([py, str(SEED_PRINTING_PRICING_SCRIPT)], env=env)
        _run([py, str(SEED_CONVERSION_SCRIPT)], env=env)
    else:
        print("Skipping TSV seeds (--no-migrations).")

    # Create/update admin user (admin/admin)
    _run(
        [
            py,
            str(CREATE_ADMIN_SCRIPT),
            "--username",
            "admin",
            "--password",
            "admin",
            "--reset-password",
            "--roles",
            "SYS_ADMIN",
        ],
        env=env,
    )

    if args.no_api:
        print("Skipping API import (--no-api).")
        return 0

    base_url = f"http://127.0.0.1:{args.api_port}"
    health_url = base_url.rstrip("/") + "/health"

    proc: subprocess.Popen[str] | None = None
    try:
        # Always start an isolated API instance so we control its DATABASE_URL and avoid
        # interacting with any already-running dev server that might have a stale DB handle.
        print(f"Starting temporary API on {base_url}…")
        proc = subprocess.Popen(
            [
                py,
                "-m",
                "uvicorn",
                "app.main:app",
                "--port",
                str(args.api_port),
                "--host",
                "127.0.0.1",
                "--log-level",
                "warning",
            ],
            cwd=str(REPO_ROOT),
            env=env,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
        )
        _wait_for_http(health_url, timeout_s=25.0)

        plate_db_path = (REPO_ROOT / args.plate_db).resolve()
        if not plate_db_path.exists():
            raise RuntimeError(f"Plate DB file not found: {plate_db_path}")

        # Import customers + plates via API (assumes admin/admin)
        _run(
            [
                py,
                str(IMPORT_PLATE_CUSTOMERS_SCRIPT),
                str(plate_db_path),
                "--base-url",
                base_url,
                "--username",
                "admin",
                "--password",
                "admin",
                "--delimiter",
                "\\t",
            ],
            env=env,
        )
        _run(
            [
                py,
                str(IMPORT_PRINT_PLATES_SCRIPT),
                str(plate_db_path),
                "--base-url",
                base_url,
                "--username",
                "admin",
                "--password",
                "admin",
                "--delimiter",
                "\\t",
            ],
            env=env,
        )
    finally:
        if proc is not None and proc.poll() is None:
            print("Stopping uvicorn…")
            try:
                proc.send_signal(signal.SIGINT)
                proc.wait(timeout=10)
            except Exception:
                proc.kill()

    print("Done.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))

