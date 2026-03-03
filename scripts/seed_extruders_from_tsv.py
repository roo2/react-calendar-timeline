from __future__ import annotations

import csv
import os
from pathlib import Path
from typing import Any

from sqlalchemy import create_engine, text


def get_db_url() -> str:
    env_url = os.getenv("DATABASE_URL")
    if env_url:
        # Normalize Heroku-style URLs for SQLAlchemy
        if env_url.startswith("postgres://"):
            return "postgresql+psycopg://" + env_url[len("postgres://") :]
        if env_url.startswith("postgresql://"):
            return "postgresql+psycopg://" + env_url[len("postgresql://") :]
        return env_url
    return "postgresql+psycopg://app:app@db:5432/app"


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
        for code, fields in data.items():
            conn.execute(
                text(
                    """
                    INSERT INTO extruders
                    (extruder_code, model, film_width_min_mm, film_width_max_mm, decision_width_mm, average_kg_hr, ave_width, cost_per_hr)
                    VALUES
                    (:extruder_code, :model, :film_width_min_mm, :film_width_max_mm, :decision_width_mm, :average_kg_hr, :ave_width, :cost_per_hr)
                    ON CONFLICT (extruder_code) DO UPDATE SET
                      model = excluded.model,
                      film_width_min_mm = excluded.film_width_min_mm,
                      film_width_max_mm = excluded.film_width_max_mm,
                      decision_width_mm = excluded.decision_width_mm,
                      average_kg_hr = excluded.average_kg_hr,
                      ave_width = excluded.ave_width,
                      cost_per_hr = excluded.cost_per_hr
                    """
                ),
                {"extruder_code": code, **fields},
            )

    print(f"Seeded/updated {len(data)} extruders from {tsv_path.name}")


if __name__ == "__main__":
    main()

