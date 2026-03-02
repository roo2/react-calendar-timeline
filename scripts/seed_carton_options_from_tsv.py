from __future__ import annotations

import csv
import os
import re
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


def _slugify(name: str) -> str:
    s = (name or "").strip().lower()
    s = re.sub(r"[^a-z0-9]+", "_", s).strip("_")
    return s[:64] if s else "carton_option"


def _to_float(v: str) -> float | None:
    s = (v or "").strip().replace("$", "").replace(",", "").strip()
    if not s:
        return None
    try:
        return float(s)
    except Exception:
        return None


def main() -> None:
    root = Path(__file__).resolve().parent
    tsv_path = root / "carton-options.tsv"
    if not tsv_path.exists():
        raise FileNotFoundError(f"Missing TSV: {tsv_path}")

    with tsv_path.open("r", newline="") as f:
        rows = list(csv.reader(f, delimiter="\t"))

    if len(rows) < 2:
        raise RuntimeError("carton-options.tsv appears empty/malformed")

    # Row 0: option names (first cell empty or label), Row 1: costs, Row 2 (optional): is_default (1 in one column)
    names_row = rows[0]
    costs_row = rows[1]
    default_col: int | None = None
    if len(rows) > 2 and len(rows[2]) > 1:
        for i in range(1, len(rows[2])):
            if (rows[2][i] or "").strip() == "1":
                default_col = i
                break

    records: list[dict] = []
    for i in range(1, max(len(names_row), len(costs_row))):
        name = (names_row[i] or "").strip() if i < len(names_row) else ""
        if not name:
            continue
        cost = _to_float(costs_row[i] if i < len(costs_row) else "")
        if cost is None or cost < 0:
            continue
        slug = _slugify(name)
        is_default = default_col == i
        records.append({"slug": slug, "name": name, "cost_per_unit": cost, "is_default": is_default})

    if not records:
        raise RuntimeError("No carton options parsed from TSV")

    engine = create_engine(get_db_url(), future=True)
    with engine.begin() as conn:
        # Ensure only one default: clear all first if we have a default in the TSV
        default_slug = next((r["slug"] for r in records if r["is_default"]), None)
        if default_slug:
            conn.execute(text("UPDATE carton_options SET is_default = :v"), {"v": False})

        for rec in records:
            conn.execute(
                text(
                    """
                    INSERT INTO carton_options (slug, name, cost_per_unit, is_default)
                    VALUES (:slug, :name, :cost_per_unit, :is_default)
                    ON CONFLICT (slug) DO UPDATE SET
                      name = excluded.name,
                      cost_per_unit = excluded.cost_per_unit,
                      is_default = excluded.is_default
                    """
                ),
                rec,
            )

    print(f"Seeded/updated {len(records)} carton options from {tsv_path.name}")


if __name__ == "__main__":
    main()
