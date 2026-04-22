from __future__ import annotations

import argparse
import os
import subprocess
import sys
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[1]

CREATE_ADMIN_SCRIPT = (REPO_ROOT / "scripts" / "create_admin.py").resolve()
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


def main(argv: list[str]) -> int:
    p = argparse.ArgumentParser(
        description=(
            "Reset local SQLite DB (production.db), create admin/admin, and seed rate-card TSV data. "
            "Customers are not bulk-seeded here—use MYOB sync or the app UI."
        )
    )
    p.add_argument(
        "--db-path",
        default="production.db",
        help="SQLite DB file path relative to repo root (default: production.db)",
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
        print("Skipping alembic and TSV seeders (--no-migrations).")

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

    print("Done.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
