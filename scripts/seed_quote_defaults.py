#!/usr/bin/env python3
"""
Upsert singleton quote_defaults: extrusion retail add-on $/kg (materials retail uplift).

Run from repo root with app on PYTHONPATH, e.g.:
  uv run python scripts/seed_quote_defaults.py
"""

from __future__ import annotations

import os
import sys
from pathlib import Path

_REPO_ROOT = Path(__file__).resolve().parents[1]
if str(_REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(_REPO_ROOT))

os.chdir(_REPO_ROOT)

from sqlalchemy import select  # noqa: E402

from app.db.models.rate_cards import QuoteDefaults  # noqa: E402
from app.db.session import SessionLocal  # noqa: E402

DEFAULT_EXTRUSION_RETAIL_ADDON_PER_KG = 1.8


def main() -> None:
    with SessionLocal.begin() as db:
        row = db.execute(select(QuoteDefaults).where(QuoteDefaults.id == 1)).scalar_one_or_none()
        if row is None:
            db.add(QuoteDefaults(id=1, extrusion_retail_addon_per_kg=DEFAULT_EXTRUSION_RETAIL_ADDON_PER_KG))
        else:
            row.extrusion_retail_addon_per_kg = DEFAULT_EXTRUSION_RETAIL_ADDON_PER_KG
    print(f"OK: quote_defaults id=1 extrusion_retail_addon_per_kg={DEFAULT_EXTRUSION_RETAIL_ADDON_PER_KG}")


if __name__ == "__main__":
    main()
