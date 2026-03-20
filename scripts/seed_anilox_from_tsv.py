"""
Load Uteco anilox reference rows from ``scripts/anilox.tsv`` (tab-separated).

Expected header::

    anilox_code\\tdescription

Aliases ``code`` / ``description`` are accepted. Sample data: see ``scripts/anilox.tsv``.
Used by ``scripts/reset_local_db.py`` and ``scripts/reset_heroku.py`` after migrations.
"""

from __future__ import annotations

import csv
import os
from pathlib import Path

from sqlalchemy import create_engine, text


def get_db_url() -> str:
    env_url = os.getenv("DATABASE_URL")
    if env_url:
        if env_url.startswith("postgres://"):
            return "postgresql+psycopg://" + env_url[len("postgres://") :]
        if env_url.startswith("postgresql://"):
            return "postgresql+psycopg://" + env_url[len("postgresql://") :]
        return env_url
    return "postgresql+psycopg://app:app@db:5432/app"


def main() -> None:
    root = Path(__file__).resolve().parent
    tsv_path = root / "anilox.tsv"
    if not tsv_path.exists():
        raise FileNotFoundError(f"Missing TSV: {tsv_path}")

    with tsv_path.open("r", newline="") as f:
        reader = csv.DictReader(f, delimiter="\t")
        rows = list(reader)

    if not rows:
        raise RuntimeError("anilox.tsv appears empty")

    records: list[dict] = []
    for row in rows:
        code = (row.get("anilox_code") or row.get("code") or "").strip()
        desc = (row.get("description") or "").strip()
        if not code or not desc:
            continue
        records.append({"anilox_code": code, "description": desc})

    if not records:
        raise RuntimeError("No anilox rows parsed from TSV")

    engine = create_engine(get_db_url(), future=True)
    with engine.begin() as conn:
        for rec in records:
            conn.execute(
                text(
                    """
                    INSERT INTO anilox (anilox_code, description)
                    VALUES (:anilox_code, :description)
                    ON CONFLICT (anilox_code) DO UPDATE SET
                      description = excluded.description
                    """
                ),
                rec,
            )

    print(f"Seeded/updated {len(records)} anilox rows from {tsv_path.name}")


if __name__ == "__main__":
    main()
