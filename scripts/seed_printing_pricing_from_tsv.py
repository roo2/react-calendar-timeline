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
        return env_url
    return "postgresql+psycopg://app:app@db:5432/app"


def to_int(v: str) -> int | None:
    s = (v or "").strip()
    if not s:
        return None
    try:
        return int(float(s))
    except Exception:
        return None


def to_money(v: str) -> float | None:
    s = (v or "").strip()
    if not s:
        return None
    s = s.replace("$", "").replace(",", "").strip()
    try:
        return float(s)
    except Exception:
        return None


_COLOUR_RE = re.compile(r"^\s*(\d+)\s*")
_WIDTH_RE = re.compile(r"\(\s*(?:up\s*to\s*)?(\d+)\s*mm", re.IGNORECASE)


def _parse_inline_columns(header_row: list[str]) -> list[tuple[int, int]]:
    """
    Returns list of (num_colours, max_print_width_mm) in column order.
    """
    out: list[tuple[int, int]] = []
    for cell in header_row[1:]:
        label = (cell or "").strip()
        if not label:
            continue
        m_c = _COLOUR_RE.search(label)
        m_w = _WIDTH_RE.search(label)
        if not m_c or not m_w:
            continue
        out.append((int(m_c.group(1)), int(m_w.group(1))))
    return out


def _parse_uteco_columns(header_row: list[str], *, default_max_width_mm: int) -> list[tuple[int, int]]:
    out: list[tuple[int, int]] = []
    for cell in header_row[1:]:
        label = (cell or "").strip()
        if not label:
            continue
        m_c = _COLOUR_RE.search(label)
        if not m_c:
            continue
        out.append((int(m_c.group(1)), default_max_width_mm))
    return out


def main() -> None:
    root = Path(__file__).resolve().parent
    inline_path = root / "printing-inline.tsv"
    uteco_path = root / "printing-utecco.tsv"

    if not inline_path.exists():
        raise FileNotFoundError(f"Missing TSV: {inline_path}")
    if not uteco_path.exists():
        raise FileNotFoundError(f"Missing TSV: {uteco_path}")

    # Parse Inline
    with inline_path.open("r", newline="") as f:
        rows = list(csv.reader(f, delimiter="\t"))
    if len(rows) < 3:
        raise RuntimeError("Inline TSV appears empty/malformed")
    # Row 2 has tier headers
    inline_tiers = _parse_inline_columns(rows[1])
    if not inline_tiers:
        raise RuntimeError("Could not parse inline printing tiers from header row")

    inline_min_m = [to_int(v) for v in rows[2][1 : 1 + len(inline_tiers)]]
    inline_min_charge = [to_money(v) for v in rows[3][1 : 1 + len(inline_tiers)]] if len(rows) > 3 else [None] * len(inline_tiers)
    inline_rate = [to_money(v) for v in rows[4][1 : 1 + len(inline_tiers)]] if len(rows) > 4 else [None] * len(inline_tiers)

    inline_records: list[dict] = []
    for idx, (num_colours, max_w) in enumerate(inline_tiers):
        min_m = inline_min_m[idx] if idx < len(inline_min_m) else None
        min_charge = inline_min_charge[idx] if idx < len(inline_min_charge) else None
        rate_1000 = inline_rate[idx] if idx < len(inline_rate) else None
        if min_m is None or rate_1000 is None:
            continue
        inline_records.append(
            {
                "id": str(uuid.uuid4()),
                "method": "inline",
                "max_print_width_mm": max_w,
                "num_colours": num_colours,
                "min_meters": int(min_m),
                "min_charge": float(min_charge) if min_charge is not None else None,
                "setup_fee": None,
                "cost_per_1000m": float(rate_1000),
            }
        )

    # Parse Uteco
    with uteco_path.open("r", newline="") as f:
        rows = list(csv.reader(f, delimiter="\t"))
    if len(rows) < 3:
        raise RuntimeError("Uteco TSV appears empty/malformed")
    uteco_tiers = _parse_uteco_columns(rows[1], default_max_width_mm=1200)
    if not uteco_tiers:
        raise RuntimeError("Could not parse uteco printing tiers from header row")

    uteco_min_m = [to_int(v) for v in rows[2][1 : 1 + len(uteco_tiers)]]
    uteco_setup_fee = [to_money(v) for v in rows[3][1 : 1 + len(uteco_tiers)]] if len(rows) > 3 else [None] * len(uteco_tiers)
    uteco_rate = [to_money(v) for v in rows[4][1 : 1 + len(uteco_tiers)]] if len(rows) > 4 else [None] * len(uteco_tiers)

    uteco_records: list[dict] = []
    for idx, (num_colours, max_w) in enumerate(uteco_tiers):
        min_m = uteco_min_m[idx] if idx < len(uteco_min_m) else None
        setup_fee = uteco_setup_fee[idx] if idx < len(uteco_setup_fee) else None
        rate_1000 = uteco_rate[idx] if idx < len(uteco_rate) else None
        if min_m is None or setup_fee is None or rate_1000 is None:
            continue
        uteco_records.append(
            {
                "id": str(uuid.uuid4()),
                "method": "uteco",
                "max_print_width_mm": max_w,
                "num_colours": num_colours,
                "min_meters": int(min_m),
                "min_charge": None,
                "setup_fee": float(setup_fee),
                "cost_per_1000m": float(rate_1000),
            }
        )

    records = inline_records + uteco_records
    if not records:
        raise RuntimeError("No printing pricing tiers parsed")

    engine = create_engine(get_db_url(), future=True)
    with engine.begin() as conn:
        for r in records:
            conn.execute(
                text(
                    """
                    INSERT INTO printing_pricing_tiers
                      (id, method, max_print_width_mm, num_colours, min_meters, min_charge, setup_fee, cost_per_1000m)
                    VALUES
                      (:id, :method, :max_print_width_mm, :num_colours, :min_meters, :min_charge, :setup_fee, :cost_per_1000m)
                    ON CONFLICT (method, max_print_width_mm, num_colours) DO UPDATE SET
                      min_meters = excluded.min_meters,
                      min_charge = excluded.min_charge,
                      setup_fee = excluded.setup_fee,
                      cost_per_1000m = excluded.cost_per_1000m
                    """
                ),
                r,
            )

    print(f"Seeded/updated {len(records)} printing pricing tiers from TSVs")


if __name__ == "__main__":
    main()

