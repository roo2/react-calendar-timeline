from __future__ import annotations

import csv
import os
from pathlib import Path

from sqlalchemy import create_engine, text

_SLUG_OVERRIDES: dict[str, str] = {
    "Colour (not clear)": "colour_not_clear",
    "Simple Job": "simple_job",
    "Gusset": "gusset",
    "Non standard Resin": "non_standard_resin",
}


def slugify_factor(factor: str) -> str:
    s = (factor or "").strip()
    if s in _SLUG_OVERRIDES:
        return _SLUG_OVERRIDES[s]
    s = s.lower()
    out = []
    prev_us = False
    for ch in s:
        ok = ("a" <= ch <= "z") or ("0" <= ch <= "9")
        if ok:
            out.append(ch)
            prev_us = False
        else:
            if not prev_us:
                out.append("_")
                prev_us = True
    slug = "".join(out).strip("_")
    return (slug[:64] if slug else "waste_factor")


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
    data: list[tuple[str, str, int]] = []
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
        data.append((factor, slugify_factor(factor), mins))

    engine = create_engine(get_db_url(), future=True)
    with engine.begin() as conn:
        for factor, slug, mins in data:
            conn.execute(
                text(
                    """
                    INSERT INTO extrusion_waste_factors (factor, slug, minutes)
                    VALUES (:factor, :slug, :minutes)
                    ON CONFLICT (factor) DO UPDATE SET
                      slug = excluded.slug,
                      minutes = excluded.minutes
                    """
                ),
                {"factor": factor, "slug": slug, "minutes": mins},
            )

    print(f"Seeded/updated {len(data)} extrusion waste factors from {tsv_path.name}")


if __name__ == "__main__":
    main()

