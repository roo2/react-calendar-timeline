from __future__ import annotations

import csv
import os
from pathlib import Path
from typing import Any

from sqlalchemy import create_engine, text


def get_db_url() -> str:
    """
    Resolve DB URL for seeding.

    - If ``DATABASE_URL`` is set, use it (Postgres URLs are normalized for SQLAlchemy + psycopg).
    - Otherwise use the same default as ``app.config.Settings``: SQLite file ``production.db`` in the
      repo root (absolute path so the script works regardless of current working directory).

    For Postgres or a non-default SQLite path, set ``DATABASE_URL`` (e.g. in ``.env``).
    """
    env_url = os.getenv("DATABASE_URL")
    if env_url:
        if env_url.startswith("postgres://"):
            return "postgresql+psycopg://" + env_url[len("postgres://") :]
        if env_url.startswith("postgresql://"):
            return "postgresql+psycopg://" + env_url[len("postgresql://") :]
        return env_url
    repo_root = Path(__file__).resolve().parent.parent
    db_file = (repo_root / "production.db").resolve()
    return f"sqlite+pysqlite:///{db_file.as_posix()}"


def to_int(v: str) -> int | None:
    s = (v or "").strip()
    if not s:
        return None
    try:
        return int(float(s))
    except Exception:
        return None


def to_float(v: str) -> float | None:
    s = (v or "").strip()
    if not s:
        return None
    try:
        return float(s)
    except Exception:
        return None


def to_money(v: str) -> float | None:
    s = (v or "").strip()
    if not s:
        return None
    # Allow "$40", "$40.50", "40", etc.
    s = s.replace("$", "").replace(",", "").strip()
    try:
        return float(s)
    except Exception:
        return None


FIELD_MAP: dict[str, tuple[str, Any]] = {
    "Model": ("model", lambda x: (x or "").strip() or None),
    "Die Size": ("die_size_mm", to_int),
    "Film Width Min (mm)": ("film_width_min_mm", to_int),
    "Film Width Max (mm)": ("film_width_max_mm", to_int),
    "Decision Width (mm)": ("decision_width_mm", to_int),
    "Average (kg/hr)": ("average_kg_hr", to_int),
    "Ave Width": ("ave_width", to_float),
    "Cost/hr": ("cost_per_hr", to_money),
    "Cost/hr($)": ("cost_per_hr", to_money),  # TSV header with $ (decimal dollars)
}


def main() -> None:
    tsv_path = Path(__file__).resolve().parent / "extruder-db.tsv"
    if not tsv_path.exists():
        raise FileNotFoundError(f"Missing TSV: {tsv_path}")

    with tsv_path.open("r", newline="") as f:
        rows = list(csv.reader(f, delimiter="\t"))

    if not rows or len(rows[0]) < 2:
        raise RuntimeError("TSV appears empty or malformed")

    extruder_codes = [c.strip() for c in rows[0][1:] if c.strip()]
    data: dict[str, dict[str, Any]] = {code: {} for code in extruder_codes}

    for r in rows[1:]:
        if not r:
            continue
        label = (r[0] or "").strip()
        if not label or label not in FIELD_MAP:
            continue
        col_name, parser = FIELD_MAP[label]
        values = r[1:]
        for idx, code in enumerate(extruder_codes):
            raw = values[idx] if idx < len(values) else ""
            data[code][col_name] = parser(raw)

    engine = create_engine(get_db_url(), future=True)
    with engine.begin() as conn:
        deleted = conn.execute(text("DELETE FROM extruders")).rowcount
        # rowcount may be -1 for some DBAPI drivers; still log when available
        if deleted is not None and deleted >= 0:
            print(f"Removed {deleted} existing extruder row(s).")
        else:
            print("Cleared existing extruders (DELETE FROM extruders).")

        for code, fields in data.items():
            row_payload = {
                "extruder_code": code,
                "model": fields.get("model"),
                "die_size_mm": fields.get("die_size_mm"),
                "film_width_min_mm": fields.get("film_width_min_mm"),
                "film_width_max_mm": fields.get("film_width_max_mm"),
                "decision_width_mm": fields.get("decision_width_mm"),
                "average_kg_hr": fields.get("average_kg_hr"),
                "ave_width": fields.get("ave_width"),
                "cost_per_hr": fields.get("cost_per_hr"),
            }
            conn.execute(
                text(
                    """
                    INSERT INTO extruders (
                        extruder_code,
                        model,
                        die_size_mm,
                        film_width_min_mm,
                        film_width_max_mm,
                        decision_width_mm,
                        average_kg_hr,
                        ave_width,
                        cost_per_hr
                    )
                    VALUES (
                        :extruder_code,
                        :model,
                        :die_size_mm,
                        :film_width_min_mm,
                        :film_width_max_mm,
                        :decision_width_mm,
                        :average_kg_hr,
                        :ave_width,
                        :cost_per_hr
                    )
                    """
                ),
                row_payload,
            )

    print(f"Seeded {len(data)} extruders from {tsv_path.name}")


if __name__ == "__main__":
    main()

