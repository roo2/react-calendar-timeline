#!/usr/bin/env python3
"""
Upsert singleton quote_defaults: default margin % for new quotes (Calculator).

Run from repo root with app on PYTHONPATH, e.g.:
  uv run python scripts/seed_quote_defaults.py

Default is 37% (matches initial schema quote_defaults seed in migration 0001).
"""

from __future__ import annotations

import os
import sys
from pathlib import Path

_REPO_ROOT = Path(__file__).resolve().parents[1]
if str(_REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(_REPO_ROOT))

# Allow DATABASE_URL from environment (same as app)
os.chdir(_REPO_ROOT)

from sqlalchemy import select  # noqa: E402

from app.db.models.rate_cards import QuoteDefaults  # noqa: E402
from app.db.session import SessionLocal  # noqa: E402

DEFAULT_MARGIN_PCT = 37.0


def main() -> None:
    with SessionLocal.begin() as db:
        row = db.execute(select(QuoteDefaults).where(QuoteDefaults.id == 1)).scalar_one_or_none()
        if row is None:
            db.add(QuoteDefaults(id=1, default_margin_pct=DEFAULT_MARGIN_PCT))
        else:
            row.default_margin_pct = DEFAULT_MARGIN_PCT
    print(f"OK: quote_defaults id=1 default_margin_pct={DEFAULT_MARGIN_PCT}")


if __name__ == "__main__":
    main()
