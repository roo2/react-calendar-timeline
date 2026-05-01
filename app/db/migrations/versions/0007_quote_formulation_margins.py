"""Quote formulation pass-through markups (colours / additives / non-LD blend).

Revision ID: 0007_quote_form_margins
Revises: 0006_myob_oauth

Stored as decimal rates applied to incremental formulation **cost** (job $)
to compute an extra sell line under Materials in the quote preview.
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0007_quote_form_margins"
down_revision = "0006_myob_oauth"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    is_sqlite = bind.dialect.name == "sqlite"
    insp = sa.inspect(bind)
    existing_cols = {c["name"] for c in insp.get_columns("quote_defaults")}
    existing_checks = {c["name"] for c in insp.get_check_constraints("quote_defaults") if c.get("name")}

    if "formulation_colours_markup" not in existing_cols:
        op.add_column(
            "quote_defaults",
            sa.Column(
                "formulation_colours_markup",
                sa.Numeric(12, 4),
                nullable=False,
                server_default=sa.text("0.5"),
            ),
        )
    if "formulation_additives_markup" not in existing_cols:
        op.add_column(
            "quote_defaults",
            sa.Column(
                "formulation_additives_markup",
                sa.Numeric(12, 4),
                nullable=False,
                server_default=sa.text("0.5"),
            ),
        )
    if "formulation_custom_blend_markup" not in existing_cols:
        op.add_column(
            "quote_defaults",
            sa.Column(
                "formulation_custom_blend_markup",
                sa.Numeric(12, 4),
                nullable=False,
                server_default=sa.text("0.5"),
            ),
        )

    # If this migration was partially applied, ensure existing rows are populated.
    op.execute(
        sa.text(
            "UPDATE quote_defaults SET "
            "formulation_colours_markup = COALESCE(formulation_colours_markup, 0.25), "
            "formulation_additives_markup = COALESCE(formulation_additives_markup, 0.25), "
            "formulation_custom_blend_markup = COALESCE(formulation_custom_blend_markup, 0.25)"
        )
    )

    missing_checks = [
        ("ck_quote_defaults_form_colours_markup_nonneg", "formulation_colours_markup >= 0"),
        ("ck_quote_defaults_form_additives_markup_nonneg", "formulation_additives_markup >= 0"),
        ("ck_quote_defaults_form_custom_blend_markup_nonneg", "formulation_custom_blend_markup >= 0"),
    ]
    missing_checks = [(name, sql) for name, sql in missing_checks if name not in existing_checks]

    if not missing_checks:
        return

    if is_sqlite:
        # SQLite cannot ALTER constraints directly; use batch copy-and-move.
        with op.batch_alter_table("quote_defaults", recreate="always") as batch_op:
            for name, sqltext in missing_checks:
                batch_op.create_check_constraint(name, sqltext)
    else:
        for name, sqltext in missing_checks:
            op.create_check_constraint(name, "quote_defaults", sqltext)


def downgrade() -> None:
    bind = op.get_bind()
    is_sqlite = bind.dialect.name == "sqlite"
    insp = sa.inspect(bind)
    existing_cols = {c["name"] for c in insp.get_columns("quote_defaults")}
    existing_checks = {c["name"] for c in insp.get_check_constraints("quote_defaults") if c.get("name")}

    drop_checks = [
        "ck_quote_defaults_form_custom_blend_markup_nonneg",
        "ck_quote_defaults_form_additives_markup_nonneg",
        "ck_quote_defaults_form_colours_markup_nonneg",
    ]
    drop_checks = [n for n in drop_checks if n in existing_checks]
    drop_cols = [
        "formulation_custom_blend_markup",
        "formulation_additives_markup",
        "formulation_colours_markup",
    ]
    drop_cols = [n for n in drop_cols if n in existing_cols]

    if not drop_checks and not drop_cols:
        return

    if is_sqlite:
        # SQLite cannot ALTER constraints directly; use batch copy-and-move.
        with op.batch_alter_table("quote_defaults", recreate="always") as batch_op:
            for name in drop_checks:
                batch_op.drop_constraint(name, type_="check")
            for name in drop_cols:
                batch_op.drop_column(name)
    else:
        for name in drop_checks:
            op.drop_constraint(name, "quote_defaults", type_="check")
        for name in drop_cols:
            op.drop_column("quote_defaults", name)
