#!/usr/bin/env python3
"""Import Dolphin Plastics MYOB ``Receivable Invoice Detail`` export (TSV) into app orders."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

# Repo root: scripts/ → parent
ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from app.db.session import SessionLocal  # noqa: E402
from app.integrations.dolphin.import_orders import import_dolphin_tsv  # noqa: E402


def main() -> int:
    p = argparse.ArgumentParser(
        description="Import Dolphin orders from a Receivable Invoice TSV export.",
    )
    p.add_argument(
        "tsv_path",
        nargs="?",
        default=str(ROOT / "scripts" / "dolphin-orders.tsv"),
        help="Path to tab-separated export (default: scripts/dolphin-orders.tsv)",
    )
    p.add_argument(
        "--dry-run",
        action="store_true",
        help="Parse and count only; do not write the database.",
    )
    args = p.parse_args()
    path = Path(args.tsv_path)
    if not path.is_file():
        print(json.dumps({"ok": False, "error": f"file not found: {path}"}))
        return 1
    db = SessionLocal()
    try:
        r = import_dolphin_tsv(db, str(path), dry_run=bool(args.dry_run))
        print(json.dumps(r, indent=2, default=str))
    finally:
        db.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
