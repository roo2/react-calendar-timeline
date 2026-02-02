# PROMPT FOR DATABASE/BACKEND AGENT: Fix Alembic Migration Failures

## Agent Role & Scope

**Database/Backend Agent** is responsible for:
- Database schema management (Alembic migrations)
- Database compatibility (SQLite and PostgreSQL)
- Migration correctness and idempotency
- Database seeding and initialization

---

## Problem Statement

Two Alembic migrations are failing, preventing user authentication from working:

1. **Migration `0012_auth.py`** fails with duplicate index error
2. **Migration `0013_seed_auth_users.py`** fails on SQLite due to PostgreSQL-only syntax

These failures prevent:
- User authentication system from initializing
- Admin user from being created
- Login functionality from working

---

## Detailed Problem Analysis

### Problem 1: Duplicate Index in `0012_auth.py`

**Error**: `index ix_sessions_user_id already exists`

**Root Cause**:
- Line 35: `user_id` column has `index=True` in the column definition
- Line 40: Explicit index creation `op.create_index("ix_sessions_user_id", ...)`
- This creates the index twice, causing a conflict

**Location**: `app/db/migrations/versions/0012_auth.py`
- Line 35: Column definition with `index=True`
- Line 40: Explicit index creation

**Fix Required**: Remove `index=True` from line 35, keep the explicit index creation on line 40.

---

### Problem 2: PostgreSQL-Only Syntax in `0012_auth.py`

**Error**: SQLite doesn't support `ON CONFLICT ... DO NOTHING` syntax

**Root Cause**:
- Line 44 uses PostgreSQL-only `ON CONFLICT (code) DO NOTHING`
- SQLite requires `INSERT OR IGNORE` syntax instead

**Location**: `app/db/migrations/versions/0012_auth.py`
- Line 44: Role seeding with PostgreSQL-only syntax

**Fix Required**: Make dialect-aware:
- Use `INSERT OR IGNORE` for SQLite
- Use `ON CONFLICT (code) DO NOTHING` for PostgreSQL

---

### Problem 3: PostgreSQL-Only Syntax in `0013_seed_auth_users.py`

**Error**: Multiple SQLite incompatibilities:
1. Line 21: `ON CONFLICT (code) DO NOTHING` (PostgreSQL-only)
2. Line 36: `ON CONFLICT (username) DO NOTHING` (PostgreSQL-only)
3. Line 36: `true` boolean value (SQLite needs `1`)
4. Line 46: `ON CONFLICT DO NOTHING` (PostgreSQL-only)
5. Missing user_id fetch after insert (if user already exists, UUID won't match)

**Root Cause**:
- Migration uses PostgreSQL-specific syntax throughout
- No dialect detection
- Boolean values use `true` instead of `1` for SQLite
- User ID is generated before insert, but if user exists, the generated UUID won't match the existing user's ID

**Location**: `app/db/migrations/versions/0013_seed_auth_users.py`
- Line 21: Role insertion
- Line 36: User insertion
- Line 46: User-role assignment

**Fix Required**: 
- Make all SQL dialect-aware
- Use `1` instead of `true` for SQLite booleans
- Fetch user_id after insert/ignore to handle existing users

---

## Reference Pattern

The existing migration `0011_seeds.py` demonstrates the correct pattern:

```python
conn = op.get_bind()
is_pg = conn.dialect.name == "postgresql"

if is_pg:
    conn.execute(sa.text("INSERT ... ON CONFLICT (code) DO NOTHING"), {...})
else:
    conn.execute(sa.text("INSERT ..."), {...})  # SQLite doesn't need conflict handling if using INSERT OR IGNORE
```

**Key Points**:
- Use `conn.dialect.name == "postgresql"` to detect database type
- Use `INSERT OR IGNORE` for SQLite (no conflict clause needed)
- Use `ON CONFLICT ... DO NOTHING` for PostgreSQL
- Use `1` instead of `true` for SQLite boolean values
- Use `TRUE` for PostgreSQL boolean values

---

## Required Fixes

### Fix 1: `app/db/migrations/versions/0012_auth.py`

#### Change 1.1: Remove Duplicate Index (Line 35)

**Current Code** (Line 35):
```python
sa.Column("user_id", sa.String(length=36), sa.ForeignKey("users.id"), nullable=False, index=True),
```

**Fixed Code**:
```python
sa.Column("user_id", sa.String(length=36), sa.ForeignKey("users.id"), nullable=False),
```

**Rationale**: The explicit index creation on line 40 is sufficient. Removing `index=True` prevents duplicate index creation.

---

#### Change 1.2: Make Role Seeding Dialect-Aware (Line 44)

**Current Code** (Lines 42-44):
```python
conn = op.get_bind()
for code in ["SALES", "OPERATOR", "PROD_MANAGER", "SYS_ADMIN"]:
    conn.execute(sa.text("INSERT INTO roles (code) VALUES (:c) ON CONFLICT (code) DO NOTHING"), {"c": code})
```

**Fixed Code**:
```python
conn = op.get_bind()
is_pg = conn.dialect.name == "postgresql"
for code in ["SALES", "OPERATOR", "PROD_MANAGER", "SYS_ADMIN"]:
    if is_pg:
        conn.execute(sa.text("INSERT INTO roles (code) VALUES (:c) ON CONFLICT (code) DO NOTHING"), {"c": code})
    else:
        conn.execute(sa.text("INSERT OR IGNORE INTO roles (code) VALUES (:c)"), {"c": code})
```

**Rationale**: SQLite doesn't support `ON CONFLICT` syntax. Use `INSERT OR IGNORE` for SQLite, `ON CONFLICT ... DO NOTHING` for PostgreSQL.

---

### Fix 2: `app/db/migrations/versions/0013_seed_auth_users.py`

#### Change 2.1: Make Role Seeding Dialect-Aware (Line 21)

**Current Code** (Lines 19-21):
```python
roles = ["SALES", "OPERATOR", "PROD_MANAGER", "SYS_ADMIN"]
for code in roles:
    conn.execute(sa.text("INSERT INTO roles (code) VALUES (:c) ON CONFLICT (code) DO NOTHING"), {"c": code})
```

**Fixed Code**:
```python
conn = op.get_bind()
is_pg = conn.dialect.name == "postgresql"
roles = ["SALES", "OPERATOR", "PROD_MANAGER", "SYS_ADMIN"]
for code in roles:
    if is_pg:
        conn.execute(sa.text("INSERT INTO roles (code) VALUES (:c) ON CONFLICT (code) DO NOTHING"), {"c": code})
    else:
        conn.execute(sa.text("INSERT OR IGNORE INTO roles (code) VALUES (:c)"), {"c": code})
```

**Rationale**: Same as Fix 1.2 - make dialect-aware.

---

#### Change 2.2: Make User Insertion Dialect-Aware and Fix Boolean (Lines 29-39)

**Current Code** (Lines 29-39):
```python
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
```

**Fixed Code**:
```python
conn = op.get_bind()
is_pg = conn.dialect.name == "postgresql"
for username, pw, rlist in seed:
    uid = str(uuid.uuid4())
    pwd = ph.hash(pw)
    if is_pg:
        conn.execute(
            sa.text(
                "INSERT INTO users (id, username, password_hash, is_active) "
                "VALUES (:id, :u, :p, TRUE) "
                "ON CONFLICT (username) DO NOTHING"
            ),
            {"id": uid, "u": username, "p": pwd},
        )
        # Fetch user_id in case user already existed
        result = conn.execute(sa.text("SELECT id FROM users WHERE username = :u"), {"u": username})
        uid = result.scalar()
    else:
        conn.execute(
            sa.text(
                "INSERT OR IGNORE INTO users (id, username, password_hash, is_active) "
                "VALUES (:id, :u, :p, 1)"
            ),
            {"id": uid, "u": username, "p": pwd},
        )
        # Fetch user_id in case user already existed
        result = conn.execute(sa.text("SELECT id FROM users WHERE username = :u"), {"u": username})
        uid = result.scalar()
```

**Rationale**: 
- Use `1` instead of `true` for SQLite boolean
- Use `INSERT OR IGNORE` for SQLite
- Fetch user_id after insert to handle existing users (UUID won't match if user already exists)

---

#### Change 2.3: Make User-Role Assignment Dialect-Aware (Lines 41-49)

**Current Code** (Lines 41-49):
```python
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
```

**Fixed Code**:
```python
# attach roles
for r in rlist:
    if is_pg:
        conn.execute(
            sa.text(
                "INSERT INTO user_roles (user_id, role_id) "
                "SELECT :uid, r.id FROM roles r WHERE r.code = :code "
                "ON CONFLICT DO NOTHING"
            ),
            {"uid": uid, "code": r},
        )
    else:
        conn.execute(
            sa.text(
                "INSERT OR IGNORE INTO user_roles (user_id, role_id) "
                "SELECT :uid, r.id FROM roles r WHERE r.code = :code"
            ),
            {"uid": uid, "code": r},
        )
```

**Rationale**: Use `INSERT OR IGNORE` for SQLite, `ON CONFLICT DO NOTHING` for PostgreSQL.

---

## Complete Fixed Files

### File 1: `app/db/migrations/versions/0012_auth.py`

```python
from __future__ import annotations

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = "0012_auth"
down_revision = "0011_seeds"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "users",
        sa.Column("id", sa.String(length=36), primary_key=True),
        sa.Column("username", sa.String(length=80), nullable=False, unique=True),
        sa.Column("password_snip" if False else "password_hash", sa.String(), nullable=False),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
    )
    op.create_table(
        "roles",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("code", sa.String(length=32), nullable=False, unique=True),
    )
    op.create_table(
        "user_roles",
        sa.Column("user_id", sa.String(length=36), sa.ForeignKey("users.id"), primary_key=True),
        sa.Column("role_id", sa.Integer(), sa.ForeignKey("roles.id"), primary_key=True),
    )
    op.create_table(
        "sessions",
        sa.Column("id", sa.String(length=36), primary_key=True),
        sa.Column("user_id", sa.String(length=36), sa.ForeignKey("users.id"), nullable=False),  # Removed index=True
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("csrf_token", sa.String(length=64), nullable=False),
    )
    op.create_index("ix_sessions_user_id", "sessions", ["user_id"])
    # Seed roles
    conn = op.get_bind()
    is_pg = conn.dialect.name == "postgresql"
    for code in ["SALES", "OPERATOR", "PROD_MANAGER", "SYS_ADMIN"]:
        if is_pg:
            conn.execute(sa.text("INSERT INTO roles (code) VALUES (:c) ON CONFLICT (code) DO NOTHING"), {"c": code})
        else:
            conn.execute(sa.text("INSERT OR IGNORE INTO roles (code) VALUES (:c)"), {"c": code})


def downgrade() -> None:
    op.drop_index("ix_sessions_user_id", table_name="sessions")
    op.drop_table("sessions")
    op.drop_table("user_roles")
    op.drop_table("roles")
    op.drop_table("users")
```

---

### File 2: `app/db/migrations/versions/0013_seed_auth_users.py`

```python
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
    is_pg = conn.dialect.name == "postgresql"
    # Ensure roles exist
    roles = ["SALES", "OPERATOR", "PROD_MANAGER", "SYS_ADMIN"]
    for code in roles:
        if is_pg:
            conn.execute(sa.text("INSERT INTO roles (code) VALUES (:c) ON CONFLICT (code) DO NOTHING"), {"c": code})
        else:
            conn.execute(sa.text("INSERT OR IGNORE INTO roles (code) VALUES (:c)"), {"c": code})
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
        if is_pg:
            conn.execute(
                sa.text(
                    "INSERT INTO users (id, username, password_hash, is_active) "
                    "VALUES (:id, :u, :p, TRUE) "
                    "ON CONFLICT (username) DO NOTHING"
                ),
                {"id": uid, "u": username, "p": pwd},
            )
            # Fetch user_id in case user already existed
            result = conn.execute(sa.text("SELECT id FROM users WHERE username = :u"), {"u": username})
            uid = result.scalar()
        else:
            conn.execute(
                sa.text(
                    "INSERT OR IGNORE INTO users (id, username, password_hash, is_active) "
                    "VALUES (:id, :u, :p, 1)"
                ),
                {"id": uid, "u": username, "p": pwd},
            )
            # Fetch user_id in case user already existed
            result = conn.execute(sa.text("SELECT id FROM users WHERE username = :u"), {"u": username})
            uid = result.scalar()
        # attach roles
        for r in rlist:
            if is_pg:
                conn.execute(
                    sa.text(
                        "INSERT INTO user_roles (user_id, role_id) "
                        "SELECT :uid, r.id FROM roles r WHERE r.code = :code "
                        "ON CONFLICT DO NOTHING"
                    ),
                    {"uid": uid, "code": r},
                )
            else:
                conn.execute(
                    sa.text(
                        "INSERT OR IGNORE INTO user_roles (user_id, role_id) "
                        "SELECT :uid, r.id FROM roles r WHERE r.code = :code"
                    ),
                    {"uid": uid, "code": r},
                )


def downgrade() -> None:
    conn = op.get_bind()
    conn.execute(sa.text("DELETE FROM user_roles WHERE user_id IN (SELECT id FROM users WHERE username IN ('admin','manager','operator','sales'))"))
    conn.execute(sa.text("DELETE FROM users WHERE username IN ('admin','manager','operator','sales')"))
```

---

## Testing Requirements

### Test 1: Fresh SQLite Database

1. **Setup**:
   ```bash
   # Remove existing database
   rm production.db production.db-journal 2>/dev/null || true
   
   # Run migrations
   alembic upgrade head
   ```

2. **Expected Results**:
   - ✅ All migrations complete without errors
   - ✅ No duplicate index errors
   - ✅ No SQL syntax errors
   - ✅ Database file `production.db` is created
   - ✅ Tables `users`, `roles`, `user_roles`, `sessions` exist

3. **Verify Data**:
   ```bash
   sqlite3 production.db "SELECT username, is_active FROM users;"
   ```
   **Expected Output**:
   ```
   admin|1
   manager|1
   operator|1
   sales|1
   ```

4. **Verify Roles**:
   ```bash
   sqlite3 production.db "SELECT u.username, r.code FROM users u JOIN user_roles ur ON u.id = ur.user_id JOIN roles r ON ur.role_id = r.id ORDER BY u.username, r.code;"
   ```
   **Expected Output**:
   ```
   admin|PROD_MANAGER
   admin|SYS_ADMIN
   manager|PROD_MANAGER
   operator|OPERATOR
   sales|SALES
   ```

5. **Test Login**:
   - Start application: `uvicorn app.main:app --reload`
   - Navigate to: `http://localhost:8000/auth/login`
   - Login with: `admin` / `Admin123!`
   - ✅ Login succeeds
   - ✅ User is redirected to home page
   - ✅ User identity shows roles: `SYS_ADMIN, PROD_MANAGER`

---

### Test 2: Fresh PostgreSQL Database

1. **Setup**:
   ```bash
   # Ensure PostgreSQL is running
   docker compose up -d db
   
   # Set DATABASE_URL
   export DATABASE_URL="postgresql+psycopg://app:app@localhost:5432/app"
   
   # Run migrations
   alembic upgrade head
   ```

2. **Expected Results**:
   - ✅ All migrations complete without errors
   - ✅ No duplicate index errors
   - ✅ No SQL syntax errors

3. **Verify Data**:
   ```sql
   SELECT username, is_active FROM users;
   ```
   **Expected Output**:
   ```
   admin  | true
   manager| true
   operator| true
   sales  | true
   ```

4. **Verify Roles**:
   ```sql
   SELECT u.username, r.code 
   FROM users u 
   JOIN user_roles ur ON u.id = ur.user_id 
   JOIN roles r ON ur.role_id = r.id 
   ORDER BY u.username, r.code;
   ```
   **Expected Output**: Same as SQLite test

5. **Test Login**: Same as SQLite test

---

### Test 3: Idempotency (Re-run Migrations)

1. **Setup**:
   ```bash
   # With existing database (SQLite or PostgreSQL)
   alembic upgrade head
   ```

2. **Expected Results**:
   - ✅ Migrations complete without errors
   - ✅ No duplicate data created
   - ✅ Existing users remain unchanged
   - ✅ No constraint violations

---

### Test 4: Migration Rollback (Optional)

1. **Setup**:
   ```bash
   # Rollback one migration
   alembic downgrade -1
   
   # Upgrade again
   alembic upgrade head
   ```

2. **Expected Results**:
   - ✅ Rollback succeeds
   - ✅ Re-upgrade succeeds
   - ✅ Data integrity maintained

---

## Acceptance Criteria

- [ ] **Fix 1 Applied**: `0012_auth.py` line 35 has `index=True` removed
- [ ] **Fix 2 Applied**: `0012_auth.py` line 44 uses dialect-aware SQL
- [ ] **Fix 3 Applied**: `0013_seed_auth_users.py` line 21 uses dialect-aware SQL
- [ ] **Fix 4 Applied**: `0013_seed_auth_users.py` line 36 uses dialect-aware SQL and `1` for SQLite boolean
- [ ] **Fix 5 Applied**: `0013_seed_auth_users.py` fetches user_id after insert
- [ ] **Fix 6 Applied**: `0013_seed_auth_users.py` line 46 uses dialect-aware SQL
- [ ] **Test 1 Passes**: Fresh SQLite database migrations complete successfully
- [ ] **Test 2 Passes**: Fresh PostgreSQL database migrations complete successfully
- [ ] **Test 3 Passes**: Migrations are idempotent (can run multiple times)
- [ ] **Login Works**: Admin user can log in with `admin` / `Admin123!`
- [ ] **Roles Assigned**: Admin user has `SYS_ADMIN` and `PROD_MANAGER` roles
- [ ] **All Users Created**: All 4 seed users exist with correct roles

---

## Implementation Notes

### Dialect Detection Pattern

Always use this pattern for dialect detection:
```python
conn = op.get_bind()
is_pg = conn.dialect.name == "postgresql"
```

### SQLite vs PostgreSQL Differences

| Feature | SQLite | PostgreSQL |
|---------|--------|------------|
| Conflict handling | `INSERT OR IGNORE` | `ON CONFLICT ... DO NOTHING` |
| Boolean values | `1` or `0` | `TRUE` or `FALSE` |
| JSON type | `TEXT` (stored as JSON string) | `JSONB` (with `::jsonb` cast) |

### User ID Fetching After Insert

**Important**: When inserting users with `INSERT OR IGNORE` or `ON CONFLICT DO NOTHING`, always fetch the actual user_id after the insert:

```python
# Insert (may be ignored if user exists)
conn.execute(sa.text("INSERT OR IGNORE INTO users ..."), {...})

# Fetch actual user_id (handles both new and existing users)
result = conn.execute(sa.text("SELECT id FROM users WHERE username = :u"), {"u": username})
uid = result.scalar()
```

This ensures the UUID matches the existing user if the user already exists.

---

## Files to Modify

1. `app/db/migrations/versions/0012_auth.py`
   - Line 35: Remove `index=True`
   - Lines 42-44: Make role seeding dialect-aware

2. `app/db/migrations/versions/0013_seed_auth_users.py`
   - Lines 15-49: Complete rewrite with dialect-aware SQL
   - Add user_id fetching after insert
   - Fix boolean values for SQLite

---

## Definition of Done

The work is complete when:

1. ✅ Both migration files are fixed
2. ✅ Migrations run successfully on fresh SQLite database
3. ✅ Migrations run successfully on fresh PostgreSQL database
4. ✅ Migrations are idempotent (can run multiple times)
5. ✅ Admin user can log in with `admin` / `Admin123!`
6. ✅ All seed users are created with correct roles
7. ✅ No duplicate index errors
8. ✅ No SQL syntax errors
9. ✅ Code follows existing patterns (matches `0011_seeds.py` style)

---

## Reference Files

- `app/db/migrations/versions/0011_seeds.py` - Example of dialect-aware migrations
- `app/db/migrations/versions/0012_auth.py` - File to fix
- `app/db/migrations/versions/0013_seed_auth_users.py` - File to fix
- `app/auth/service.py` - Authentication service (for context)

---

**End of Prompt for Database/Backend Agent**
