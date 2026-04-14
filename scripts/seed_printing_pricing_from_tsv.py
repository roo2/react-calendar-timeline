from __future__ import annotations

import csv
import os
import re
import uuid
from pathlib import Path

from sqlalchemy import create_engine, text


def get_db_url() -> str:
    """
    Resolve DB URL for seeding.

    - If ``DATABASE_URL`` is set, use it (Postgres URLs are normalized for SQLAlchemy + psycopg).
    - Otherwise use the same default as ``app.config.Settings``: SQLite file ``production.db`` in the
      repo root (absolute path so the script works regardless of current working directory).

    For Postgres or a non-default SQLite path, set ``DATABASE_URL`` (e.g. in ``.env``).
    """
    env_url = os.getenv("DATABASE_URL")
    if env_url:
        if env_url.startswith("postgres://"):
            return "postgresql+psycopg://" + env_url[len("postgres://") :]
        if env_url.startswith("postgresql://"):
            return "postgresql+psycopg://" + env_url[len("postgresql://") :]
        return env_url
    repo_root = Path(__file__).resolve().parent.parent
    db_file = (repo_root / "production.db").resolve()
    return f"sqlite+pysqlite:///{db_file.as_posix()}"


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


def to_positive_float(v: str) -> float | None:
    s = (v or "").strip().lower().replace(",", "")
    if not s:
        return None
    try:
        n = float(s)
        return n if n > 0 else None
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

    # rows[2]=Min meters, [3]=Min charge, [4]=Setup cost, [5]=Setup price, [6]=Cost/1000m, [7]=Price/1000m
    if len(rows) < 8:
        raise RuntimeError(
            "Inline TSV needs rows: tiers, min meters, min charge, setup cost, setup price, cost/1000m, price/1000m"
        )
    inline_min_m = [to_int(v) for v in rows[2][1 : 1 + len(inline_tiers)]]
    inline_min_charge = [to_money(v) for v in rows[3][1 : 1 + len(inline_tiers)]]
    inline_setup_cost = [to_money(v) for v in rows[4][1 : 1 + len(inline_tiers)]]
    inline_setup_price = [to_money(v) for v in rows[5][1 : 1 + len(inline_tiers)]]
    inline_cost_1000 = [to_money(v) for v in rows[6][1 : 1 + len(inline_tiers)]]
    inline_price_1000 = [to_money(v) for v in rows[7][1 : 1 + len(inline_tiers)]]

    inline_records: list[dict] = []
    for idx, (num_colours, max_w) in enumerate(inline_tiers):
        min_m = inline_min_m[idx] if idx < len(inline_min_m) else None
        min_charge = inline_min_charge[idx] if idx < len(inline_min_charge) else None
        setup_cost = inline_setup_cost[idx] if idx < len(inline_setup_cost) else None
        setup_price = inline_setup_price[idx] if idx < len(inline_setup_price) else None
        cost_1000 = inline_cost_1000[idx] if idx < len(inline_cost_1000) else None
        price_1000 = inline_price_1000[idx] if idx < len(inline_price_1000) else None
        if min_m is None or setup_cost is None or setup_price is None or cost_1000 is None or price_1000 is None:
            continue
        inline_records.append(
            {
                "id": str(uuid.uuid4()),
                "method": "inline",
                "max_print_width_mm": max_w,
                "num_colours": num_colours,
                "min_meters": int(min_m),
                "min_charge": float(min_charge) if min_charge is not None else None,
                "setup_cost": float(setup_cost),
                "setup_price": float(setup_price),
                "cost_per_1000m": float(cost_1000),
                "price_per_1000m": float(price_1000),
                "meters_per_min": None,
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

    # rows[2]=Min meters, [3]=Setup cost, [4]=Setup price, [5]=Cost/1000m, [6]=Price/1000m, [7]=m/min
    if len(rows) < 8:
        raise RuntimeError("Uteco TSV needs rows: tiers, min meters, setup cost, setup price, cost/1000m, price/1000m, m/min")
    uteco_min_m = [to_int(v) for v in rows[2][1 : 1 + len(uteco_tiers)]]
    uteco_setup_cost = [to_money(v) for v in rows[3][1 : 1 + len(uteco_tiers)]]
    uteco_setup_price = [to_money(v) for v in rows[4][1 : 1 + len(uteco_tiers)]]
    uteco_cost_1000 = [to_money(v) for v in rows[5][1 : 1 + len(uteco_tiers)]]
    uteco_price_1000 = [to_money(v) for v in rows[6][1 : 1 + len(uteco_tiers)]]
    uteco_mpm = [to_positive_float(v) for v in rows[7][1 : 1 + len(uteco_tiers)]]

    uteco_records: list[dict] = []
    for idx, (num_colours, max_w) in enumerate(uteco_tiers):
        min_m = uteco_min_m[idx] if idx < len(uteco_min_m) else None
        setup_cost = uteco_setup_cost[idx] if idx < len(uteco_setup_cost) else None
        setup_price = uteco_setup_price[idx] if idx < len(uteco_setup_price) else None
        cost_1000 = uteco_cost_1000[idx] if idx < len(uteco_cost_1000) else None
        price_1000 = uteco_price_1000[idx] if idx < len(uteco_price_1000) else None
        mpm = uteco_mpm[idx] if idx < len(uteco_mpm) else None
        if min_m is None or setup_cost is None or setup_price is None or cost_1000 is None or price_1000 is None:
            continue
        uteco_records.append(
            {
                "id": str(uuid.uuid4()),
                "method": "uteco",
                "max_print_width_mm": max_w,
                "num_colours": num_colours,
                "min_meters": int(min_m),
                "min_charge": None,
                "setup_cost": float(setup_cost),
                "setup_price": float(setup_price),
                "cost_per_1000m": float(cost_1000),
                "price_per_1000m": float(price_1000),
                "meters_per_min": float(mpm) if mpm is not None else None,
            }
        )

    records = inline_records + uteco_records
    if not records:
        raise RuntimeError("No printing pricing tiers parsed")

    insert_sql = text(
        """
        INSERT INTO printing_pricing_tiers
          (id, method, max_print_width_mm, num_colours, min_meters, min_charge,
           setup_cost, setup_price, cost_per_1000m, price_per_1000m, meters_per_min)
        VALUES
          (:id, :method, :max_print_width_mm, :num_colours, :min_meters, :min_charge,
           :setup_cost, :setup_price, :cost_per_1000m, :price_per_1000m, :meters_per_min)
        """
    )

    engine = create_engine(get_db_url(), future=True)
    with engine.begin() as conn:
        conn.execute(text("DELETE FROM printing_pricing_tiers"))
        for r in records:
            conn.execute(insert_sql, r)

    print(f"Re-seeded {len(records)} printing pricing tiers from TSVs (table cleared first)")


if __name__ == "__main__":
    main()

