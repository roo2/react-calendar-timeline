#!/usr/bin/env python3
from __future__ import annotations

import argparse
import sys
from decimal import Decimal
from typing import Any, Dict, List, Optional

# Ensure repo root on path when run as a script
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from app.db.session import SessionLocal
from app.db.models.rate_cards import Resin


DEFAULT_TSV = """Resin Type\tLLD\tLD\tLD\tLD\tLD\tHD\tLLD
Density Estimate\t0.001848\t0.001848\t0.001848\t0.001848\t0.001848\t0.001924\t0.001848\t0.001848
Resin Code \tQ1018H\tFD0270\tFD0274\tFE8004\tFE3000\tS199F\t1018RA/25
Resin Name\tLinear\tSanofi\tLight G\tMed G\tHeavy G\tH/D\tMetallizine\tOther
Resin Prices (Update mannually)\t1.98\t2.26\t2.29\t2.28\t2.28\t2.06\t2.21\t2.4
"""


def _norm_key(k: str) -> str:
    return " ".join((k or "").strip().split()).lower()


def parse_transposed_tsv(text: str) -> List[Dict[str, str]]:
    """
    Parse a transposed TSV block:
    - First column is attribute name
    - Remaining columns are per-resin values
    Returns a list of per-column dicts.
    """
    lines = [ln for ln in (text or "").splitlines() if ln.strip()]
    if not lines:
        return []

    rows: List[List[str]] = []
    for ln in lines:
        parts = ln.split("\t")
        # Preserve empty cells but trim whitespace
        rows.append([p.strip() for p in parts])

    # Number of resin columns is max columns minus the first attribute cell
    n = max(0, max(len(r) for r in rows) - 1)
    cols: List[Dict[str, str]] = [dict() for _ in range(n)]

    for r in rows:
        if not r:
            continue
        key = r[0]
        values = r[1:]
        for i in range(n):
            v = values[i].strip() if i < len(values) and values[i] is not None else ""
            cols[i][key] = v
    return cols


def _get(col: Dict[str, str], *candidates: str) -> Optional[str]:
    for c in candidates:
        for k, v in col.items():
            if _norm_key(k) == _norm_key(c):
                return v
    return None


def seed_resins_from_columns(columns: List[Dict[str, str]], currency: str, dry_run: bool) -> int:
    upserts: List[Dict[str, Any]] = []
    for col in columns:
        code = (_get(col, "Resin Code", "Resin Code ") or "").strip()
        if not code:
            continue
        name = (_get(col, "Resin Name") or "").strip() or code
        dens_s = (_get(col, "Density Estimate") or "").strip()
        price_s = (_get(col, "Resin Prices (Update mannually)", "Resin Prices") or "").strip()

        try:
            density = Decimal(dens_s) if dens_s else Decimal("0.0001")
        except Exception:
            density = Decimal("0.0001")
        try:
            price = Decimal(price_s) if price_s else Decimal("0")
        except Exception:
            price = Decimal("0")

        upserts.append(
            {
                "resin_code": code,
                "name": name,
                "density": density,
                "price_per_kg": price,
                "currency": currency,
            }
        )

    if dry_run:
        for u in upserts:
            print(f"[dry-run] upsert resin {u['resin_code']}: name={u['name']!r} density={u['density']} price={u['price_per_kg']} {u['currency']}")
        return len(upserts)

    with SessionLocal.begin() as db:
        for u in upserts:
            r = db.get(Resin, u["resin_code"])
            if not r:
                r = Resin(**u)  # type: ignore[arg-type]
                db.add(r)
            else:
                r.name = u["name"]
                r.density = u["density"]
                r.price_per_kg = u["price_per_kg"]
                r.currency = u["currency"]

    return len(upserts)


def main() -> int:
    ap = argparse.ArgumentParser(description="Seed/upsert resins from a transposed TSV block.")
    ap.add_argument("--file", help="Path to TSV file. If omitted, reads stdin (or uses built-in sample).")
    ap.add_argument("--currency", default="AUD", help="Currency code to set on all rows (default: AUD).")
    ap.add_argument("--dry-run", action="store_true", help="Parse and print actions without writing to DB.")
    ap.add_argument("--use-sample", action="store_true", help="Use the embedded sample TSV block.")
    args = ap.parse_args()

    if args.use_sample:
        text = DEFAULT_TSV
    elif args.file:
        text = Path(args.file).read_text(encoding="utf-8")
    else:
        if sys.stdin.isatty():
            text = DEFAULT_TSV
        else:
            text = sys.stdin.read()

    cols = parse_transposed_tsv(text)
    count = seed_resins_from_columns(cols, currency=args.currency.strip().upper(), dry_run=args.dry_run)
    print(f"Upserted {count} resins.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

