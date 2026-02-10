#!/usr/bin/env python3
from __future__ import annotations

import argparse
import sys
from pathlib import Path
from typing import Any

# Ensure repo root on path when run as a script
REPO_ROOT = Path(__file__).resolve().parents[1]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from app.db.session import SessionLocal
from app.db.models.rate_cards import ResinBlend, ResinBlendComponent


PRESETS: list[dict[str, Any]] = [
    {
        "blend_code": "HOUSE_LD",
        "name": "House Blend (LD)",
        "components": [
            {"resin_code": "Q1018H", "pct": 50.0},
            {"resin_code": "FE3000", "pct": 50.0},
        ],
    },
    {
        "blend_code": "LD",
        "name": "LD",
        "components": [
            {"resin_code": "FD0270", "pct": 50.0},
            {"resin_code": "S199F", "pct": 50.0},
        ],
    },
    {
        "blend_code": "MD",
        "name": "MD",
        "components": [
            {"resin_code": "FD0270", "pct": 30.0},
            {"resin_code": "FE3000", "pct": 40.0},
            {"resin_code": "S199F", "pct": 30.0},
        ],
    },
]


def main() -> int:
    ap = argparse.ArgumentParser(description="Seed/upsert resin blend presets.")
    ap.add_argument("--dry-run", action="store_true", help="Print actions without writing to DB.")
    args = ap.parse_args()

    if args.dry_run:
        for b in PRESETS:
            print(f"[dry-run] upsert blend {b['blend_code']}: {b['name']}")
            for c in b["components"]:
                print(f"          - {c['resin_code']}: {c['pct']}%")
        return 0

    with SessionLocal.begin() as db:
        for b in PRESETS:
            code = b["blend_code"]
            name = b["name"]
            comps = b["components"]

            obj = db.get(ResinBlend, code)
            if not obj:
                obj = ResinBlend(blend_code=code, name=name)
                db.add(obj)
            else:
                obj.name = name

            # Replace components
            db.query(ResinBlendComponent).filter(ResinBlendComponent.blend_code == code).delete()
            for c in comps:
                db.add(ResinBlendComponent(blend_code=code, resin_code=c["resin_code"], pct=float(c["pct"])))

    print(f"Upserted {len(PRESETS)} resin blends.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

