#!/usr/bin/env python3
"""
Seed `brands` and `customers` from `scripts/priority-customers.md`.

Expects a GitHub-flavour markdown table with columns: Priority | Company | Customer
where Company is the brand name ("Crown Pack" or "Dolphin").

Run from the repository root (so `app` is importable), with DATABASE_URL / .env configured:

  .venv/bin/python scripts/seed_priority_customers.py
  .venv/bin/python scripts/seed_priority_customers.py --dry-run

Idempotent: matches existing rows by (brand_id, name) and updates `priority_rank` only.
New rows get a 4-letter customer code (CP/Dolphin prefix + per-brand sequence).
Placeholder contact and delivery address JSON is added so rows satisfy app conventions.
"""

from __future__ import annotations

import argparse
import re
import sys
import uuid
from pathlib import Path

_REPO_ROOT = Path(__file__).resolve().parents[1]
if str(_REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(_REPO_ROOT))

from sqlalchemy import select  # noqa: E402
from sqlalchemy.orm import Session  # noqa: E402

from app.db.models.domain import Brand, Customer  # noqa: E402
from app.db.session import SessionLocal  # noqa: E402

_MARKDOWN = Path(__file__).resolve().parent / "priority-customers.md"

_PLACEHOLDER_CONTACTS = {
    "items": [
        {
            "type": "Primary Contact",
            "name": "TBD",
            "title": None,
            "email": "tbd@example.com",
            "phone": None,
            "phone_alt": None,
            "notes": "Placeholder from priority customer import",
        }
    ]
}
_PLACEHOLDER_ADDRESSES = {
    "items": [
        {
            "label": "Head office",
            "type": "Both",
            "street1": "TBD",
            "street2": None,
            "suburb": "TBD",
            "state": "QLD",
            "postcode": "0000",
            "country": "Australia",
            "contact_name": None,
            "contact_phone": None,
            "delivery_instructions": None,
            "is_default": True,
        }
    ]
}


def _parse_table(path: Path) -> list[tuple[int, str, str]]:
    rows: list[tuple[int, str, str]] = []
    text = path.read_text(encoding="utf-8")
    for raw in text.splitlines():
        line = raw.strip()
        if not line.startswith("|"):
            continue
        parts = [p.strip() for p in line.split("|")]
        parts = [p for p in parts if p != ""]
        if len(parts) < 3:
            continue
        p_s, company, customer = parts[0], parts[1], parts[2]
        if p_s.lower() == "priority":
            continue
        if re.match(r"^[-\s|]+$", p_s):
            continue
        if not p_s.isdigit():
            continue
        rows.append((int(p_s), company, customer))
    return rows


def _brand_key(company: str) -> tuple[str, str]:
    """Return (stable brand code, display name)."""
    c = company.strip().lower()
    if "crown" in c and "pack" in c:
        return ("CROWN_PACK", "Crown Pack")
    if c == "dolphin" or c.startswith("dolphin"):
        return ("DOLPHIN", "Dolphin")
    raise ValueError(f"Unknown brand / company column value: {company!r}")


def _four_letter_code(brand_code: str, index_within_brand: int) -> str:
    prefix = "CP" if brand_code == "CROWN_PACK" else "DO"
    if index_within_brand > 26 * 26 - 1:
        raise ValueError("Too many customers for 4-letter code scheme")
    hi, lo = divmod(index_within_brand, 26)
    return f"{prefix}{chr(65 + hi)}{chr(65 + lo)}"


def _allocate_customer_code(db: Session, brand_code: str, start_index_within_brand: int) -> str:
    """Pick first unused 4-letter code for this brand, scanning forward from start_index."""
    for k in range(26 * 26):
        cand = _four_letter_code(brand_code, start_index_within_brand + k)
        if not db.scalar(select(Customer.id).where(Customer.code == cand)):
            return cand
    raise RuntimeError("Could not allocate a unique customer code")


def _ensure_brands(db: Session) -> dict[str, Brand]:
    specs = [("CROWN_PACK", "Crown Pack"), ("DOLPHIN", "Dolphin")]
    out: dict[str, Brand] = {}
    for code, name in specs:
        b = db.scalar(select(Brand).where(Brand.code == code))
        if b is None:
            b = Brand(id=str(uuid.uuid4()), code=code, name=name)
            db.add(b)
            db.flush()
        out[code] = b
    db.flush()
    return out


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dry-run", action="store_true", help="Parse and print counts only")
    args = parser.parse_args()

    if not _MARKDOWN.exists():
        print(f"Missing {_MARKDOWN}", file=sys.stderr)
        return 1

    try:
        parsed = _parse_table(_MARKDOWN)
    except Exception as e:
        print(f"Parse error: {e}", file=sys.stderr)
        return 1

    if args.dry_run:
        print(f"Would process {len(parsed)} rows from {_MARKDOWN}")
        return 0

    crown_idx = 0
    dolphin_idx = 0
    created = 0
    updated = 0

    with SessionLocal() as db:
        brands = _ensure_brands(db)
        for priority, company, name in parsed:
            name = (name or "").strip()
            if not name:
                continue
            if len(name) > 255:
                name = name[:255]

            bcode, _bname = _brand_key(company)
            brand = brands[bcode]

            existing = db.scalar(
                select(Customer).where(
                    Customer.brand_id == brand.id,
                    Customer.name == name,
                )
            )
            if existing is not None:
                if existing.priority_rank != priority:
                    existing.priority_rank = priority
                    updated += 1
                continue

            if bcode == "CROWN_PACK":
                idx = crown_idx
                crown_idx += 1
            else:
                idx = dolphin_idx
                dolphin_idx += 1

            code = _allocate_customer_code(db, bcode, idx)
            c = Customer(
                id=str(uuid.uuid4()),
                code=code,
                name=name,
                brand_id=brand.id,
                priority_rank=priority,
                status="Active",
                contacts=_PLACEHOLDER_CONTACTS,
                delivery_addresses=_PLACEHOLDER_ADDRESSES,
                delivery_preferences={},
            )
            db.add(c)
            created += 1

        db.commit()

    print(f"Done. Created {created} customers, updated priority on {updated} existing rows.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
