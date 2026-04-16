#!/usr/bin/env python3
"""
Upsert singleton quote_defaults: extrusion retail add-on $/kg and formulation pass-through markups.

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
DEFAULT_FORMULATION_MARKUP = 0.25


def main() -> None:
    with SessionLocal.begin() as db:
        row = db.execute(select(QuoteDefaults).where(QuoteDefaults.id == 1)).scalar_one_or_none()
        if row is None:
            db.add(
                QuoteDefaults(
                    id=1,
                    extrusion_retail_addon_per_kg=DEFAULT_EXTRUSION_RETAIL_ADDON_PER_KG,
                    formulation_colours_markup=DEFAULT_FORMULATION_MARKUP,
                    formulation_additives_markup=DEFAULT_FORMULATION_MARKUP,
                    formulation_custom_blend_markup=DEFAULT_FORMULATION_MARKUP,
                )
            )
        else:
            row.extrusion_retail_addon_per_kg = DEFAULT_EXTRUSION_RETAIL_ADDON_PER_KG
            row.formulation_colours_markup = DEFAULT_FORMULATION_MARKUP
            row.formulation_additives_markup = DEFAULT_FORMULATION_MARKUP
            row.formulation_custom_blend_markup = DEFAULT_FORMULATION_MARKUP
    print(
        "OK: quote_defaults id=1 "
        f"extrusion_retail_addon_per_kg={DEFAULT_EXTRUSION_RETAIL_ADDON_PER_KG} "
        f"formulation markups={DEFAULT_FORMULATION_MARKUP}"
    )


if __name__ == "__main__":
    main()
