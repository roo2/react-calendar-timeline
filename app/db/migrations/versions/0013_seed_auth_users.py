from __future__ import annotations

from alembic import op
import sqlalchemy as sa
import uuid
from argon2 import PasswordHasher

# revision identifiers, used by Alembic.
revision = "0013_seed_auth_users"
down_revision = "0012_auth"
branch_labels = None
depends_on = None


def upgrade() -> None:
    ph = PasswordHasher()
    conn = op.get_bind()
    # Ensure roles exist
    roles = ["SALES", "OPERATOR", "PROD_MANAGER", "SYS_ADMIN"]
    for code in roles:
        conn.execute(sa.text("INSERT INTO roles (code) VALUES (:c) ON CONFLICT (code) DO NOTHING"), {"c": code})
    # Seed users
    seed = [
        ("admin", "Admin123!", ["SYS_ADMIN", "PROD_MANAGER"]),
        ("manager", "Manager123!", ["PROD_MANAGER"]),
        ("operator", "Operator123!", ["OPERATOR"]),
        ("sales", "Sales123!", ["SALES"]),
    ]
    for username, pw, rlist in seed:
        uid = str(uuid.uuid4())
        pwd = ph.hash(pw)
        conn.execute(
            sa.text(
                "INSERT INTO users (id, username, password_hash, is_active) "
                "VALUES (:id, :u, :p, true) "
                "ON CONFLICT (username) DO NOTHING"
            ),
            {"id": uid, "u": username, "p": pwd},
        )
        # attach roles
        for r in rlist:
            conn.execute(
                sa.text(
                    "INSERT INTO user_roles (user_id, role_id) "
                    "SELECT :uid, r.id FROM roles r WHERE r.code = :code "
                    "ON CONFLICT DO NOTHING"
                ),
                {"uid": uid, "code": r},
            )


def downgrade() -> None:
    conn = op.get_bind()
    conn.execute(sa.text("DELETE FROM user_roles WHERE user_id IN (SELECT id FROM users WHERE username IN ('admin','manager','operator','sales'))"))
    conn.execute(sa.text("DELETE FROM users WHERE username IN ('admin','manager','operator','sales')"))


