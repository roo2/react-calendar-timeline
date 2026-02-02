from __future__ import annotations

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = "0016_customer_fields"
down_revision = "0015_rate_card_seeds"
branch_labels = None
depends_on = None


def upgrade() -> None:
    conn = op.get_bind()
    
    # Add new columns to customers table
    op.add_column("customers", sa.Column("abn", sa.String(length=50), nullable=True))
    op.add_column("customers", sa.Column("tax_id", sa.String(length=50), nullable=True))
    op.add_column("customers", sa.Column("status", sa.String(length=50), nullable=False, server_default="Active"))
    op.add_column("customers", sa.Column("delivery_preferences", sa.JSON, nullable=False, server_default=sa.text("'{}'")))
    op.add_column("customers", sa.Column("payment_terms", sa.String(length=255), nullable=True))
    op.add_column("customers", sa.Column("credit_limit", sa.Numeric(18, 2), nullable=True))
    op.add_column("customers", sa.Column("currency_preference", sa.String(length=3), nullable=False, server_default="AUD"))
    op.add_column("customers", sa.Column("notes", sa.Text, nullable=True))
    op.add_column("customers", sa.Column("internal_notes", sa.Text, nullable=True))
    
    # Update existing customers to have proper JSON structure for contacts and delivery_addresses
    # Convert from {} to {"items": []} if needed
    if conn.dialect.name == "postgresql":
        op.execute(sa.text("""
            UPDATE customers 
            SET contacts = '{"items": []}'::jsonb 
            WHERE contacts = '{}'::jsonb OR contacts IS NULL
        """))
        op.execute(sa.text("""
            UPDATE customers 
            SET delivery_addresses = '{"items": []}'::jsonb 
            WHERE delivery_addresses = '{}'::jsonb OR delivery_addresses IS NULL
        """))
    elif conn.dialect.name == "sqlite":
        # SQLite JSON handling
        op.execute(sa.text("""
            UPDATE customers 
            SET contacts = '{"items": []}' 
            WHERE contacts = '{}' OR contacts IS NULL OR contacts = ''
        """))
        op.execute(sa.text("""
            UPDATE customers 
            SET delivery_addresses = '{"items": []}' 
            WHERE delivery_addresses = '{}' OR delivery_addresses IS NULL OR delivery_addresses = ''
        """))


def downgrade() -> None:
    # Remove added columns
    op.drop_column("customers", "internal_notes")
    op.drop_column("customers", "notes")
    op.drop_column("customers", "currency_preference")
    op.drop_column("customers", "credit_limit")
    op.drop_column("customers", "payment_terms")
    op.drop_column("customers", "delivery_preferences")
    op.drop_column("customers", "status")
    op.drop_column("customers", "tax_id")
    op.drop_column("customers", "abn")
