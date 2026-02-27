from __future__ import annotations

import csv
import os
import re
import uuid
from pathlib import Path

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


_RANGE_RE = re.compile(r"^\s*(\d+)\s*-\s*(\d+)\s*")


def _parse_range(cell: str) -> tuple[int, int] | None:
    m = _RANGE_RE.search(cell or "")
    if not m:
        return None
    return int(m.group(1)), int(m.group(2))


def _to_float(v: str) -> float | None:
    s = (v or "").strip()
    if not s:
        return None
    s = s.replace("$", "").replace(",", "").strip()
    try:
        return float(s)
    except Exception:
        return None


def main() -> None:
    root = Path(__file__).resolve().parent
    speeds_path = root / "conversion-speeds.tsv"
    factors_path = root / "conversion-rates.tsv"

    if not speeds_path.exists():
        raise FileNotFoundError(f"Missing TSV: {speeds_path}")
    if not factors_path.exists():
        raise FileNotFoundError(f"Missing TSV: {factors_path}")

    # Parse conversion-speeds.tsv (matrix)
    with speeds_path.open("r", newline="") as f:
        rows = list(csv.reader(f, delimiter="\t"))
    if len(rows) < 3:
        raise RuntimeError("conversion-speeds.tsv appears empty/malformed")

    # Row 2 has length headers; first cell is gauge label.
    length_headers = rows[1][1:]
    length_ranges: list[tuple[int, int]] = []
    for h in length_headers:
        r = _parse_range(h)
        if not r:
            continue
        length_ranges.append(r)
    if not length_ranges:
        raise RuntimeError("Could not parse length ranges from conversion-speeds.tsv header row")

    speed_records: list[dict] = []
    for r in rows[2:]:
        if not r:
            continue
        gauge_cell = (r[0] or "").strip()
        gauge_range = _parse_range(gauge_cell)
        if not gauge_range:
            continue
        min_g, max_g = gauge_range
        values = r[1 : 1 + len(length_ranges)]
        for idx, (min_l, max_l) in enumerate(length_ranges):
            raw = values[idx] if idx < len(values) else ""
            bpm = _to_float(raw)
            if bpm is None or bpm <= 0:
                continue
            speed_records.append(
                {
                    "id": str(uuid.uuid4()),
                    "min_gauge_um": min_g,
                    "max_gauge_um": max_g,
                    "min_length_mm": min_l,
                    "max_length_mm": max_l,
                    "bags_per_minute": bpm,
                }
            )

    # Parse conversion-rates.tsv (factors)
    with factors_path.open("r", newline="") as f:
        rows = list(csv.reader(f, delimiter="\t"))
    if len(rows) < 2:
        raise RuntimeError("conversion-rates.tsv appears empty/malformed")

    factor_records: list[dict] = []
    for r in rows[1:]:
        if not r:
            continue
        slug = (r[0] or "").strip()
        name = (r[1] or "").strip() if len(r) > 1 else ""
        val = _to_float(r[2] if len(r) > 2 else "")
        if not slug or not name or val is None:
            continue
        factor_records.append({"slug": slug, "name": name, "value": val})

    engine = create_engine(get_db_url(), future=True)
    with engine.begin() as conn:
        for rec in speed_records:
            conn.execute(
                text(
                    """
                    INSERT INTO conversion_speeds
                      (id, min_gauge_um, max_gauge_um, min_length_mm, max_length_mm, bags_per_minute)
                    VALUES
                      (:id, :min_gauge_um, :max_gauge_um, :min_length_mm, :max_length_mm, :bags_per_minute)
                    ON CONFLICT (min_gauge_um, max_gauge_um, min_length_mm, max_length_mm) DO UPDATE SET
                      bags_per_minute = excluded.bags_per_minute
                    """
                ),
                rec,
            )

        for rec in factor_records:
            conn.execute(
                text(
                    """
                    INSERT INTO conversion_factors (slug, name, value)
                    VALUES (:slug, :name, :value)
                    ON CONFLICT (slug) DO UPDATE SET
                      name = excluded.name,
                      value = excluded.value
                    """
                ),
                rec,
            )

    print(
        f"Seeded/updated {len(speed_records)} conversion speeds and {len(factor_records)} conversion factors from TSVs"
    )


if __name__ == "__main__":
    main()

