"""Quote defaults: configurable default order waste % (baseline extrusion allowance)."""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0034_default_order_waste_pct"
down_revision = "0033_product_code_additive_codes"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    is_sqlite = bind.dialect.name == "sqlite"
    insp = sa.inspect(bind)
    existing_cols = {c["name"] for c in insp.get_columns("quote_defaults")}
    existing_checks = {c["name"] for c in insp.get_check_constraints("quote_defaults") if c.get("name")}

    if "default_order_waste_pct" not in existing_cols:
        op.add_column(
            "quote_defaults",
            sa.Column(
                "default_order_waste_pct",
                sa.Numeric(8, 4),
                nullable=False,
                server_default=sa.text("1"),
            ),
        )

    check_name = "ck_quote_defaults_default_order_waste_pct_range"
    if check_name not in existing_checks:
        sql = "default_order_waste_pct >= 0 AND default_order_waste_pct <= 100"
        if is_sqlite:
            with op.batch_alter_table("quote_defaults", recreate="always") as batch_op:
                batch_op.create_check_constraint(check_name, sql)
        else:
            op.create_check_constraint(check_name, "quote_defaults", sql)

    op.execute(
        sa.text(
            "UPDATE quote_defaults SET default_order_waste_pct = 1 "
            "WHERE default_order_waste_pct IS NULL"
        )
    )


def downgrade() -> None:
    bind = op.get_bind()
    is_sqlite = bind.dialect.name == "sqlite"
    insp = sa.inspect(bind)
    existing_cols = {c["name"] for c in insp.get_columns("quote_defaults")}
    existing_checks = {c["name"] for c in insp.get_check_constraints("quote_defaults") if c.get("name")}

    check_name = "ck_quote_defaults_default_order_waste_pct_range"
    drop_check = check_name in existing_checks
    drop_col = "default_order_waste_pct" in existing_cols

    if not drop_check and not drop_col:
        return

    if is_sqlite:
        with op.batch_alter_table("quote_defaults", recreate="always") as batch_op:
            if drop_check:
                batch_op.drop_constraint(check_name, type_="check")
            if drop_col:
                batch_op.drop_column("default_order_waste_pct")
    else:
        if drop_check:
            op.drop_constraint(check_name, "quote_defaults", type_="check")
        if drop_col:
            op.drop_column("quote_defaults", "default_order_waste_pct")
