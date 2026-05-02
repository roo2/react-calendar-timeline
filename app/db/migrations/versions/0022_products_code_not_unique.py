"""Product code is display-only: allow duplicate codes across customers.

Revision ID: 0022_products_code_not_unique
Revises: 0021_qdefaults_extr_ft
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0022_products_code_not_unique"
down_revision = "0021_qdefaults_extr_ft"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    is_sqlite = bind.dialect.name == "sqlite"
    insp = sa.inspect(bind)
    uq_names = {c["name"] for c in insp.get_unique_constraints("products") if c.get("name")}
    ix_names = {i["name"] for i in insp.get_indexes("products") if i.get("name")}

    if is_sqlite:
        with op.batch_alter_table("products", schema=None) as batch_op:
            if "uq_product_code" in uq_names:
                batch_op.drop_constraint("uq_product_code", type_="unique")
            if "ix_products_code" in ix_names:
                batch_op.drop_index("ix_products_code")
            batch_op.alter_column(
                "code",
                existing_type=sa.String(length=32),
                nullable=False,
                existing_nullable=False,
            )
        op.create_index("ix_products_code", "products", ["code"], unique=False)
        return

    if "uq_product_code" in uq_names:
        op.drop_constraint("uq_product_code", "products", type_="unique")
    if "ix_products_code" in ix_names:
        op.drop_index("ix_products_code", table_name="products")
    op.alter_column(
        "products",
        "code",
        existing_type=sa.String(length=32),
        nullable=False,
        existing_nullable=False,
        unique=False,
    )
    op.create_index("ix_products_code", "products", ["code"], unique=False)


def downgrade() -> None:
    # Not reversible if duplicate codes exist across customers.
    raise NotImplementedError("Downgrade would require deduplicating products.code globally")
