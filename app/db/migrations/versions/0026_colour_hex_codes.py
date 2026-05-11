"""Add colour/additive highlight hex codes.

Revision ID: 0026_colour_hex_codes
Revises: 0025_conversion_carton_sizes
Create Date: 2026-05-07
"""

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = "0026_colour_hex_codes"
down_revision = "0025_conversion_carton_sizes"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("colours") as batch_op:
        batch_op.add_column(sa.Column("hex_code", sa.String(length=7), nullable=True))
    with op.batch_alter_table("additives") as batch_op:
        batch_op.add_column(sa.Column("highlight_hex_code", sa.String(length=7), nullable=True))

    seed_hex_by_code = {
        "WHITE": "#FFFFFF",
        "BLACK": "#D6D6D6",
        "SILVER": "#E6E9EC",
        "GREY": "#DEE3E8",
        "BLUE": "#BFD7FF",
        "PIPE_COVER_BLUE": "#C9DBF7",
        "PIPECOVER_PURPLE": "#DECFF3",
        "PIPECOVER_BEIGE": "#EFE2D2",
        "YELLOW": "#FFF4B8",
        "SIGNET_YELLOW": "#FFF0A6",
        "GREEN": "#CBEBCF",
        "ORANGE": "#FFE2C2",
        "RED": "#F9CCCC",
        "PURPLE": "#E7D3F5",
        "BROWN": "#E5D6CF",
        "PINK": "#FFD6E6",
        "OTHER": "#E1E8ED",
    }
    additive_highlight_hex_by_code = {
        "ANTI_BLOCK": "#FFF59D",
        "ANTI_STATIC": "#B2EBF2",
        "SLIP": "#FFE082",
        "UV": "#FFCCBC",
    }
    conn = op.get_bind()
    for colour_code, hex_code in seed_hex_by_code.items():
        conn.execute(
            sa.text("UPDATE colours SET hex_code = :hex_code WHERE colour_code = :colour_code"),
            {"hex_code": hex_code, "colour_code": colour_code},
        )
    for additive_code, hex_code in additive_highlight_hex_by_code.items():
        conn.execute(
            sa.text(
                "UPDATE additives SET highlight_hex_code = :hex_code WHERE additive_code = :additive_code"
            ),
            {"hex_code": hex_code, "additive_code": additive_code},
        )


def downgrade() -> None:
    with op.batch_alter_table("additives") as batch_op:
        batch_op.drop_column("highlight_hex_code")
    with op.batch_alter_table("colours") as batch_op:
        batch_op.drop_column("hex_code")
