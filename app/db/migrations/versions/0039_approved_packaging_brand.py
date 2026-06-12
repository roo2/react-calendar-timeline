"""Add Approved Packaging brand row."""

from __future__ import annotations

import uuid

import sqlalchemy as sa
from alembic import op

revision = "0039_approved_packaging_brand"
down_revision = "0038_order_xero_invoice_export"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    existing = bind.execute(
        sa.text("SELECT id FROM brands WHERE code = 'APPROVED_PACKAGING' LIMIT 1")
    ).first()
    if existing is not None:
        return
    op.execute(
        sa.text(
            "INSERT INTO brands (id, code, name) VALUES (:id, 'APPROVED_PACKAGING', 'Approved Packaging')"
        ).bindparams(id=str(uuid.uuid4()))
    )


def downgrade() -> None:
    op.execute(sa.text("DELETE FROM brands WHERE code = 'APPROVED_PACKAGING'"))
