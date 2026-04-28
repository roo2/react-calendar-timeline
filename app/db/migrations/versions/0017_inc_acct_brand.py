"""Income accounts: app ``id`` PK, optional MYOB UID, ``brand_source`` (crownpack vs dolphin).

Revision ID: 0017_inc_acct_brand
Revises: 0016_myob_import_jobs
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0017_inc_acct_brand"
down_revision = "0016_myob_import_jobs"
branch_labels = None
depends_on = None


def _is_sqlite(conn) -> bool:
    return conn.dialect.name == "sqlite"


def _is_postgres(conn) -> bool:
    return conn.dialect.name == "postgresql"


def upgrade() -> None:
    conn = op.get_bind()

    if _is_sqlite(conn):
        with op.batch_alter_table("resell_products", schema=None) as batch:
            batch.drop_constraint("fk_resell_products_myob_income_account", type_="foreignkey")
        with op.batch_alter_table("myob_item_selling_uoms", schema=None) as batch:
            batch.drop_constraint("fk_myob_item_selling_uoms_income_account", type_="foreignkey")

        op.create_table(
            "myob_income_accounts_new",
            sa.Column("id", sa.String(length=36), nullable=False),
            sa.Column("myob_account_uid", sa.String(length=36), nullable=True),
            sa.Column("name", sa.Text(), nullable=True),
            sa.Column("display_id", sa.String(length=64), nullable=True),
            sa.Column("synced_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("brand_source", sa.String(length=16), nullable=False, server_default="crownpack"),
            sa.PrimaryKeyConstraint("id", name="pk_myob_income_accounts_new"),
        )
        op.execute(
            """
            INSERT INTO myob_income_accounts_new
              (id, myob_account_uid, name, display_id, synced_at, brand_source)
            SELECT myob_account_uid, myob_account_uid, name, display_id, synced_at, 'crownpack'
            FROM myob_income_accounts
            """
        )
        op.drop_table("myob_income_accounts")
        op.rename_table("myob_income_accounts_new", "myob_income_accounts")
        op.create_index("ix_myob_income_accounts_display_id", "myob_income_accounts", ["display_id"], unique=False)
        op.create_index("ix_myob_income_accounts_brand", "myob_income_accounts", ["brand_source"], unique=False)
        op.create_index(
            "ix_myob_income_accounts_myob_account_uid", "myob_income_accounts", ["myob_account_uid"], unique=False
        )

        with op.batch_alter_table("resell_products", schema=None) as batch:
            batch.create_foreign_key(
                "fk_resell_products_myob_income_account",
                "myob_income_accounts",
                ["myob_income_account_uid"],
                ["id"],
                ondelete="SET NULL",
            )
        with op.batch_alter_table("myob_item_selling_uoms", schema=None) as batch:
            batch.create_foreign_key(
                "fk_myob_item_selling_uoms_income_account",
                "myob_income_accounts",
                ["myob_income_account_uid"],
                ["id"],
                ondelete="SET NULL",
            )
        return

    if not _is_sqlite(conn):
        op.drop_constraint("fk_resell_products_myob_income_account", "resell_products", type_="foreignkey")
        op.drop_constraint("fk_myob_item_selling_uoms_income_account", "myob_item_selling_uoms", type_="foreignkey")

    op.add_column("myob_income_accounts", sa.Column("id", sa.String(length=36), nullable=True))
    op.add_column(
        "myob_income_accounts",
        sa.Column("brand_source", sa.String(length=16), nullable=False, server_default="crownpack"),
    )
    op.execute("UPDATE myob_income_accounts SET id = myob_account_uid, brand_source = 'crownpack'")
    op.alter_column("myob_income_accounts", "id", existing_type=sa.String(length=36), nullable=False)
    op.drop_constraint("pk_myob_income_accounts", "myob_income_accounts", type_="primary")
    op.create_primary_key("pk_myob_income_accounts", "myob_income_accounts", ["id"])
    op.alter_column("myob_income_accounts", "myob_account_uid", existing_type=sa.String(length=36), nullable=True)
    if _is_postgres(conn):
        op.alter_column(
            "myob_income_accounts", "brand_source", server_default=None, existing_type=sa.String(length=16)
        )

    op.create_index("ix_myob_income_accounts_brand", "myob_income_accounts", ["brand_source"], unique=False)
    op.create_index("ix_myob_income_accounts_myob_account_uid", "myob_income_accounts", ["myob_account_uid"], unique=False)

    op.create_foreign_key(
        "fk_resell_products_myob_income_account",
        "resell_products",
        "myob_income_accounts",
        ["myob_income_account_uid"],
        ["id"],
        ondelete="SET NULL",
    )
    op.create_foreign_key(
        "fk_myob_item_selling_uoms_income_account",
        "myob_item_selling_uoms",
        "myob_income_accounts",
        ["myob_income_account_uid"],
        ["id"],
        ondelete="SET NULL",
    )


def downgrade() -> None:
    raise NotImplementedError("downgrade is not supported for 0017_inc_acct_brand")
