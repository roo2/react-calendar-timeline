from __future__ import annotations

import csv
import os
from pathlib import Path

from sqlalchemy import create_engine, text


def get_db_url() -> str:
    env_url = os.getenv("DATABASE_URL")
    if env_url:
        return env_url
    return "postgresql+psycopg://app:app@db:5432/app"


def main() -> None:
    tsv_path = Path(__file__).resolve().parent / "waste-factors.tsv"
    if not tsv_path.exists():
        raise FileNotFoundError(f"Missing TSV: {tsv_path}")

    with tsv_path.open("r", newline="") as f:
        rows = list(csv.reader(f, delimiter="\t"))

    if not rows:
        raise RuntimeError("TSV appears empty")

    # First row is a header; skip it.
    data: list[tuple[str, int]] = []
    for r in rows[1:]:
        if not r:
            continue
        factor = (r[0] or "").strip()
        mins_s = (r[1] if len(r) > 1 else "").strip()
        if not factor or not mins_s:
            continue
        try:
            mins = int(float(mins_s))
        except Exception:
            continue
        data.append((factor, mins))

    engine = create_engine(get_db_url(), future=True)
    with engine.begin() as conn:
        for factor, mins in data:
            conn.execute(
                text(
                    """
                    INSERT INTO extrusion_waste_factors (factor, minutes)
                    VALUES (:factor, :minutes)
                    ON CONFLICT (factor) DO UPDATE SET
                      minutes = excluded.minutes
                    """
                ),
                {"factor": factor, "minutes": mins},
            )

    print(f"Seeded/updated {len(data)} extrusion waste factors from {tsv_path.name}")


if __name__ == "__main__":
    main()

