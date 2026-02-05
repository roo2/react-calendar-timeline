from __future__ import annotations

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = "0004_drop_customer_code"
down_revision = "0003_views_and_seeds"
branch_labels = None
depends_on = None


def _is_postgres(conn) -> bool:
    return conn.dialect.name == "postgresql"


def upgrade() -> None:
    conn = op.get_bind()

    # Drop the unique index on customers.code (created in 0001).
    op.drop_index("ix_customers_code", table_name="customers")

    # Drop the column itself.
    if conn.dialect.name == "sqlite":
        # SQLite requires batch mode to drop columns reliably.
        with op.batch_alter_table("customers") as batch_op:
            batch_op.drop_column("code")
    else:
        op.drop_column("customers", "code")

    # Clean up old sequence used for customer codes (created in 0002, PG only).
    if _is_postgres(conn):
        op.execute(sa.text("DROP SEQUENCE IF EXISTS customer_code_seq"))


def downgrade() -> None:
    conn = op.get_bind()

    if conn.dialect.name == "sqlite":
        with op.batch_alter_table("customers") as batch_op:
            batch_op.add_column(sa.Column("code", sa.String(length=32), nullable=True))
    else:
        op.add_column("customers", sa.Column("code", sa.String(length=32), nullable=True))

    op.create_index("ix_customers_code", "customers", ["code"], unique=True)

