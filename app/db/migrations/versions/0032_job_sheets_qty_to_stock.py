"""Add qty_to_stock on job_sheets; backfill from spec conversion.

Revision ID: 0032_job_sheets_qty_to_stock
Revises: 0031_carton_sizes_order
Create Date: 2026-05-20
"""

from __future__ import annotations

import json
from typing import Any

from alembic import op
import sqlalchemy as sa


revision = "0032_job_sheets_qty_to_stock"
down_revision = "0031_carton_sizes_order"
branch_labels = None
depends_on = None


def _qty_to_stock_from_spec_payload(raw: Any) -> int | None:
    """Legacy value lived at run_requirements.conversion.qty_to_stock in spec JSON."""
    if raw is None:
        return None
    if isinstance(raw, (bytes, bytearray)):
        raw = raw.decode("utf-8", errors="replace")
    if isinstance(raw, str):
        try:
            data = json.loads(raw)
        except (json.JSONDecodeError, TypeError):
            return None
    elif isinstance(raw, dict):
        data = raw
    else:
        return None
    if not isinstance(data, dict):
        return None
    rr = data.get("run_requirements")
    if not isinstance(rr, dict):
        return None
    conv = rr.get("conversion")
    if not isinstance(conv, dict):
        return None
    v = conv.get("qty_to_stock")
    if v is None:
        return None
    try:
        n = int(v)
        return n if n >= 0 else None
    except (TypeError, ValueError):
        return None


def _backfill_qty_to_stock_from_spec() -> None:
    conn = op.get_bind()
    rows = conn.execute(
        sa.text(
            """
            SELECT js.id, pv.spec_payload
            FROM job_sheets AS js
            JOIN product_versions AS pv ON pv.id = js.product_version_id
            WHERE js.qty_to_stock IS NULL
            """
        )
    ).fetchall()
    for js_id, spec_payload in rows:
        qty = _qty_to_stock_from_spec_payload(spec_payload)
        if qty is None:
            continue
        conn.execute(
            sa.text("UPDATE job_sheets SET qty_to_stock = :qty WHERE id = :id"),
            {"qty": qty, "id": js_id},
        )


def upgrade() -> None:
    conn = op.get_bind()
    insp = sa.inspect(conn)
    if not any(c["name"] == "qty_to_stock" for c in insp.get_columns("job_sheets")):
        op.add_column("job_sheets", sa.Column("qty_to_stock", sa.Integer(), nullable=True))
    _backfill_qty_to_stock_from_spec()


def downgrade() -> None:
    op.drop_column("job_sheets", "qty_to_stock")
