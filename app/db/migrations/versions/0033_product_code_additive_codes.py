"""Rename additive master codes; refresh product codes (underscores + additives).

Revision ID: 0033_product_code_additive_codes
Revises: 0032_job_sheets_qty_to_stock
Create Date: 2026-05-20
"""

from __future__ import annotations

import copy
import json
from typing import Any

from alembic import op
import sqlalchemy as sa

from app.products.product_code_additive import (
    ADDITIVE_CODE_MIGRATION_ROWS,
    migrate_additive_code_in_spec_payload,
)
from app.products.service import compute_product_code_base

revision = "0033_product_code_additive_codes"
down_revision = "0032_job_sheets_qty_to_stock"
branch_labels = None
depends_on = None

_LEGACY_ADDITIVE_NAMES = {
    "AB": "Anti Block",
    "AS": "Anti Static",
    "SP": "Slip",
    "UV": "UV",
}


def _load_spec_dict(raw: Any) -> dict | None:
    if raw is None:
        return None
    if isinstance(raw, (bytes, bytearray)):
        raw = raw.decode("utf-8", errors="replace")
    if isinstance(raw, str):
        try:
            data = json.loads(raw)
        except json.JSONDecodeError:
            return None
    elif isinstance(raw, dict):
        data = copy.deepcopy(raw)
    else:
        return None
    return data if isinstance(data, dict) else None


def _dump_spec_dict(data: dict) -> str:
    return json.dumps(data, separators=(",", ":"), sort_keys=False)


def _refresh_product_codes(conn) -> None:
    rows = conn.execute(
        sa.text(
            """
            SELECT p.id AS product_id, pv.spec_payload
            FROM products AS p
            JOIN product_versions AS pv ON pv.id = p.active_version_id
            WHERE p.active_version_id IS NOT NULL
            """
        )
    ).mappings().all()
    for row in rows:
        spec = row["spec_payload"]
        if isinstance(spec, str):
            try:
                spec = json.loads(spec)
            except json.JSONDecodeError:
                continue
        if not isinstance(spec, dict):
            continue
        new_code = (compute_product_code_base(spec) or "").strip()[:32]
        if not new_code:
            continue
        conn.execute(
            sa.text("UPDATE products SET code = :code WHERE id = :pid"),
            {"code": new_code, "pid": str(row["product_id"])},
        )


def upgrade() -> None:
    conn = op.get_bind()

    for old_code, new_code, name in ADDITIVE_CODE_MIGRATION_ROWS:
        if old_code == new_code:
            conn.execute(
                sa.text("UPDATE additives SET name = :name WHERE additive_code = :code"),
                {"name": name, "code": new_code},
            )
            continue
        conn.execute(
            sa.text(
                """
                INSERT INTO additives (additive_code, name, price_per_kg, notes, highlight_hex_code)
                SELECT :new_code, :name, price_per_kg, notes, highlight_hex_code
                FROM additives
                WHERE additive_code = :old_code
                ON CONFLICT (additive_code) DO UPDATE SET
                  name = excluded.name,
                  price_per_kg = excluded.price_per_kg,
                  notes = excluded.notes,
                  highlight_hex_code = excluded.highlight_hex_code
                """
            ),
            {"old_code": old_code, "new_code": new_code, "name": name},
        )

    version_rows = conn.execute(sa.text("SELECT id, spec_payload FROM product_versions")).mappings().all()
    for vr in version_rows:
        data = _load_spec_dict(vr["spec_payload"])
        if data is None:
            continue
        migrated = migrate_additive_code_in_spec_payload(data, to_legacy=False)
        conn.execute(
            sa.text("UPDATE product_versions SET spec_payload = :spec WHERE id = :id"),
            {"spec": _dump_spec_dict(migrated), "id": str(vr["id"])},
        )

    conn.execute(
        sa.text("DELETE FROM additives WHERE additive_code IN ('ANTI_BLOCK', 'ANTI_STATIC', 'SLIP')")
    )

    _refresh_product_codes(conn)


def downgrade() -> None:
    conn = op.get_bind()

    for old_code, new_code, _name in ADDITIVE_CODE_MIGRATION_ROWS:
        if old_code == new_code:
            continue
        legacy_name = _LEGACY_ADDITIVE_NAMES.get(old_code, old_code)
        conn.execute(
            sa.text(
                """
                INSERT INTO additives (additive_code, name, price_per_kg, notes, highlight_hex_code)
                SELECT :old_code, :legacy_name, price_per_kg, notes, highlight_hex_code
                FROM additives
                WHERE additive_code = :new_code
                ON CONFLICT (additive_code) DO UPDATE SET
                  name = excluded.name,
                  price_per_kg = excluded.price_per_kg,
                  notes = excluded.notes,
                  highlight_hex_code = excluded.highlight_hex_code
                """
            ),
            {"old_code": old_code, "new_code": new_code, "legacy_name": legacy_name},
        )

    version_rows = conn.execute(sa.text("SELECT id, spec_payload FROM product_versions")).mappings().all()
    for vr in version_rows:
        data = _load_spec_dict(vr["spec_payload"])
        if data is None:
            continue
        migrated = migrate_additive_code_in_spec_payload(data, to_legacy=True)
        conn.execute(
            sa.text("UPDATE product_versions SET spec_payload = :spec WHERE id = :id"),
            {"spec": _dump_spec_dict(migrated), "id": str(vr["id"])},
        )

    conn.execute(
        sa.text("DELETE FROM additives WHERE additive_code IN ('AB', 'AS', 'SP')"),
    )

    _refresh_product_codes(conn)
