# PROMPT FOR DATABASE/BACKEND AGENT: Fix Migration 0012_auth.py

## Agent Role & Scope

**Database/Backend Agent** is responsible for:
- Database schema management (Alembic migrations)
- Database compatibility (SQLite and PostgreSQL)
- Migration correctness and idempotency

---

## Problem Statement

Migration `0012_auth.py` has two critical issues preventing it from running successfully:

1. **Duplicate Index Error**: The migration fails with `index ix_sessions_user_id already exists`
2. **SQLite Incompatibility**: The migration uses PostgreSQL-only syntax that fails on SQLite

These failures prevent:
- Authentication tables from being created
- Subsequent migrations from running
- User authentication system from initializing

---

## Detailed Problem Analysis

### Issue 1: Duplicate Index Creation

**Error Message**: 
```
sqlalchemy.exc.OperationalError: (sqlite3.OperationalError) index ix_sessions_user_id already exists
```

**Root Cause**:
- **Line 35**: The `user_id` column definition includes `index=True`, which automatically creates an index named `ix_sessions_user_id` when the table is created
- **Line 40**: The migration also explicitly creates the same index with `op.create_index("ix_sessions_user_id", "sessions", ["user_id"])`
- This results in the index being created twice, causing a conflict

**Current Code** (Lines 32-40):
```python
op.create_table(
    "sessions",
    sa.Column("id", sa.String(length=36), primary_key=True),
    sa.Column("user_id", sa.String(length=36), sa.ForeignKey("users.id"), nullable=False, index=True),  # ← Creates index automatically
    sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
    sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
    sa.Column("csrf_token", sa.String(length=64), nullable=False),
)
op.create_index("ix_sessions_user_id", "sessions", ["user_id"])  # ← Creates same index again
```

**Fix Required**: Remove `index=True` from line 35. Keep the explicit `op.create_index()` call on line 40.

---

### Issue 2: PostgreSQL-Only SQL Syntax

**Error Message** (on SQLite):
```
sqlalchemy.exc.OperationalError: (sqlite3.OperationalError) near "ON": syntax error
```

**Root Cause**:
- **Line 44**: Uses PostgreSQL-specific `ON CONFLICT (code) DO NOTHING` syntax
- SQLite doesn't support `ON CONFLICT` syntax in this form
- SQLite requires `INSERT OR IGNORE` syntax instead

**Current Code** (Lines 41-44):
```python
# Seed roles
conn = op.get_bind()
for code in ["SALES", "OPERATOR", "PROD_MANAGER", "SYS_ADMIN"]:
    conn.execute(sa.text("INSERT INTO roles (code) VALUES (:c) ON CONFLICT (code) DO NOTHING"), {"c": code})
```

**Fix Required**: Make the role seeding dialect-aware:
- Use `INSERT OR IGNORE` for SQLite
- Use `ON CONFLICT (code) DO NOTHING` for PostgreSQL

---

## Reference Pattern

The existing migration `0011_seeds.py` demonstrates the correct pattern for dialect detection:

```python
conn = op.get_bind()
is_pg = conn.dialect.name == "postgresql"

if is_pg:
    conn.execute(sa.text("INSERT ... ON CONFLICT (code) DO NOTHING"), {...})
else:
    conn.execute(sa.text("INSERT OR IGNORE ..."), {...})
```

**Key Points**:
- Use `conn.dialect.name == "postgresql"` to detect PostgreSQL
- Use `conn.dialect.name == "sqlite"` to detect SQLite
- Use `INSERT OR IGNORE` for SQLite conflict handling
- Use `ON CONFLICT ... DO NOTHING` for PostgreSQL conflict handling

---

## Required Fixes

### Fix 1: Remove Duplicate Index (Line 35)

**Current Code** (Line 35):
```python
sa.Column("user_id", sa.String(length=36), sa.ForeignKey("users.id"), nullable=False, index=True),
```

**Fixed Code**:
```python
sa.Column("user_id", sa.String(length=36), sa.ForeignKey("users.id"), nullable=False),
```

**Rationale**: 
- Removing `index=True` prevents automatic index creation
- The explicit `op.create_index()` call on line 40 will create the index
- This eliminates the duplicate index conflict

---

### Fix 2: Make Role Seeding Dialect-Aware (Lines 41-44)

**Current Code** (Lines 41-44):
```python
# Seed roles
conn = op.get_bind()
for code in ["SALES", "OPERATOR", "PROD_MANAGER", "SYS_ADMIN"]:
    conn.execute(sa.text("INSERT INTO roles (code) VALUES (:c) ON CONFLICT (code) DO NOTHING"), {"c": code})
```

**Fixed Code**:
```python
# Seed roles
conn = op.get_bind()
is_sqlite = conn.dialect.name == "sqlite"
for code in ["SALES", "OPERATOR", "PROD_MANAGER", "SYS_ADMIN"]:
    if is_sqlite:
        conn.execute(sa.text("INSERT OR IGNORE INTO roles (code) VALUES (:c)"), {"c": code})
    else:
        conn.execute(sa.text("INSERT INTO roles (code) VALUES (:c) ON CONFLICT (code) DO NOTHING"), {"c": code})
```

**Rationale**:
- SQLite doesn't support `ON CONFLICT` syntax
- `INSERT OR IGNORE` is the SQLite equivalent for conflict handling
- PostgreSQL uses `ON CONFLICT (code) DO NOTHING`
- Both approaches make the migration idempotent (safe to run multiple times)

---

## Complete Fixed File

Here is the complete corrected `app/db/migrations/versions/0012_auth.py`:

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
        sa.Column("user_id", sa.String(length=36), sa.ForeignKey("users.id"), nullable=False),  # ← Removed index=True
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("csrf_token", sa.String(length=64), nullable=False),
    )
    op.create_index("ix_sessions_user_id", "sessions", ["user_id"])
    # Seed roles
    conn = op.get_bind()
    is_sqlite = conn.dialect.name == "sqlite"
    for code in ["SALES", "OPERATOR", "PROD_MANAGER", "SYS_ADMIN"]:
        if is_sqlite:
            conn.execute(sa.text("INSERT OR IGNORE INTO roles (code) VALUES (:c)"), {"c": code})
        else:
            conn.execute(sa.text("INSERT INTO roles (code) VALUES (:c) ON CONFLICT (code) DO NOTHING"), {"c": code})


def downgrade() -> None:
    op.drop_index("ix_sessions_user_id", table_name="sessions")
    op.drop_table("sessions")
    op.drop_table("user_roles")
    op.drop_table("roles")
    op.drop_table("users")
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
   - ✅ Migration `0012_auth` completes without errors
   - ✅ No duplicate index error
   - ✅ No SQL syntax errors
   - ✅ Tables `users`, `roles`, `user_roles`, `sessions` are created
   - ✅ Index `ix_sessions_user_id` exists (only once)

3. **Verify Tables**:
   ```bash
   sqlite3 production.db ".tables"
   ```
   **Expected Output**:
   ```
   alembic_version  machines  roles  sessions  tool_types  user_roles  users
   ```

4. **Verify Index**:
   ```bash
   sqlite3 production.db ".indexes sessions"
   ```
   **Expected Output**:
   ```
   ix_sessions_user_id
   ```
   (Should appear only once)

5. **Verify Roles**:
   ```bash
   sqlite3 production.db "SELECT code FROM roles ORDER BY code;"
   ```
   **Expected Output**:
   ```
   OPERATOR
   PROD_MANAGER
   SALES
   SYS_ADMIN
   ```

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
   - ✅ Migration `0012_auth` completes without errors
   - ✅ No duplicate index error
   - ✅ No SQL syntax errors
   - ✅ All tables are created

3. **Verify Index**:
   ```sql
   SELECT indexname FROM pg_indexes WHERE tablename = 'sessions';
   ```
   **Expected Output**:
   ```
   ix_sessions_user_id
   ```
   (Should appear only once)

4. **Verify Roles**:
   ```sql
   SELECT code FROM roles ORDER BY code;
   ```
   **Expected Output**: Same as SQLite test

---

### Test 3: Idempotency (Re-run Migration)

1. **Setup**:
   ```bash
   # With existing database (after Test 1 or 2)
   alembic upgrade head
   ```

2. **Expected Results**:
   - ✅ Migration completes without errors
   - ✅ No duplicate data created
   - ✅ Roles remain unchanged (4 roles, no duplicates)
   - ✅ Index remains unchanged (exists once)

---

### Test 4: Verify Migration Chain Continues

1. **Setup**:
   ```bash
   # After fixing 0012_auth, verify next migration can run
   alembic upgrade head
   ```

2. **Expected Results**:
   - ✅ Migration `0012_auth` completes successfully
   - ✅ Migration `0013_seed_auth_users` can proceed (if it exists)
   - ✅ No blocking errors

---

## Acceptance Criteria

- [ ] **Fix 1 Applied**: Line 35 has `index=True` removed from `user_id` column
- [ ] **Fix 2 Applied**: Lines 41-44 use dialect-aware SQL for role seeding
- [ ] **Test 1 Passes**: Fresh SQLite database migration completes successfully
- [ ] **Test 2 Passes**: Fresh PostgreSQL database migration completes successfully
- [ ] **Test 3 Passes**: Migration is idempotent (can run multiple times)
- [ ] **Test 4 Passes**: Migration chain continues to next migration
- [ ] **No Duplicate Index**: Index `ix_sessions_user_id` exists exactly once
- [ ] **Roles Seeded**: All 4 roles are created (SALES, OPERATOR, PROD_MANAGER, SYS_ADMIN)
- [ ] **Code Style**: Follows pattern from `0011_seeds.py`

---

## Implementation Notes

### Dialect Detection

Use this pattern for dialect detection:
```python
conn = op.get_bind()
is_sqlite = conn.dialect.name == "sqlite"
is_pg = conn.dialect.name == "postgresql"
```

### SQLite vs PostgreSQL Conflict Handling

| Database | Syntax |
|----------|--------|
| SQLite | `INSERT OR IGNORE INTO table (col) VALUES (:val)` |
| PostgreSQL | `INSERT INTO table (col) VALUES (:val) ON CONFLICT (col) DO NOTHING` |

### Index Creation Best Practice

- **Prefer explicit `op.create_index()`** over `index=True` in column definitions
- Explicit index creation gives more control over index naming
- Explicit index creation is easier to manage in migrations

---

## Files to Modify

**Single File**: `app/db/migrations/versions/0012_auth.py`
- Line 35: Remove `index=True`
- Lines 41-44: Replace with dialect-aware role seeding

---

## Definition of Done

The work is complete when:

1. ✅ `index=True` is removed from line 35
2. ✅ Role seeding is dialect-aware (lines 41-44)
3. ✅ Migration runs successfully on fresh SQLite database
4. ✅ Migration runs successfully on fresh PostgreSQL database
5. ✅ Migration is idempotent (can run multiple times)
6. ✅ No duplicate index errors
7. ✅ No SQL syntax errors
8. ✅ All 4 roles are seeded correctly
9. ✅ Code follows existing patterns (`0011_seeds.py` style)
10. ✅ Migration chain can proceed to next migration

---

## Reference Files

- `app/db/migrations/versions/0011_seeds.py` - Example of dialect-aware migrations
- `app/db/migrations/versions/0012_auth.py` - File to fix
- `app/db/migrations/versions/0013_seed_auth_users.py` - Next migration (for context)

---

## Quick Verification Commands

After applying the fix, run these commands to verify:

```bash
# Test on SQLite
rm production.db production.db-journal 2>/dev/null || true
alembic upgrade head
sqlite3 production.db "SELECT code FROM roles ORDER BY code;"
sqlite3 production.db ".indexes sessions"

# Test idempotency
alembic upgrade head

# Test on PostgreSQL (if available)
export DATABASE_URL="postgresql+psycopg://app:app@localhost:5432/app"
alembic upgrade head
```

---

**End of Prompt for Database/Backend Agent**
