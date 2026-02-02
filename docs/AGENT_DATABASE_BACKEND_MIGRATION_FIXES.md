# PROMPT FOR DATABASE/BACKEND AGENT: Fix Alembic Migration Files

## Agent Role & Scope

**Database/Backend Agent** is responsible for:
- Database schema management (Alembic migrations)
- Database compatibility (SQLite and PostgreSQL)
- Migration correctness and idempotency
- Database seeding and initialization

---

## Problem Statement

Two Alembic migration files have critical issues preventing successful database initialization:

1. **`0012_auth.py`**: Duplicate index error and PostgreSQL-only SQL syntax
2. **`0013_seed_auth_users.py`**: PostgreSQL-only SQL syntax and missing user_id fetch

These failures prevent:
- Authentication tables from being created
- Admin user from being seeded
- User authentication system from working
- Login functionality from working

---

## Detailed Problem Analysis

### File 1: `0012_auth.py` - Two Issues

#### Issue 1.1: Duplicate Index Error
- **Line 35**: `user_id` column has `index=True`, which automatically creates an index
- **Line 40**: Explicit `op.create_index()` creates the same index again
- **Result**: `index ix_sessions_user_id already exists` error

#### Issue 1.2: PostgreSQL-Only SQL Syntax
- **Line 44**: Uses `ON CONFLICT (code) DO NOTHING` which fails on SQLite
- **Result**: SQL syntax error on SQLite databases

### File 2: `0013_seed_auth_users.py` - Multiple Issues

#### Issue 2.1: PostgreSQL-Only Role Seeding
- **Line 21**: Uses `ON CONFLICT (code) DO NOTHING` which fails on SQLite

#### Issue 2.2: PostgreSQL-Only User Insertion
- **Line 35**: Uses `true` boolean value (SQLite needs `1`)
- **Line 36**: Uses `ON CONFLICT (username) DO NOTHING` which fails on SQLite

#### Issue 2.3: Missing User ID Fetch
- **Problem**: After `INSERT OR IGNORE` or `ON CONFLICT DO NOTHING`, if user already exists, the generated UUID won't match the existing user's ID
- **Result**: Role assignments fail because `uid` doesn't match existing user's ID

#### Issue 2.4: PostgreSQL-Only User-Role Assignment
- **Line 46**: Uses `ON CONFLICT DO NOTHING` which fails on SQLite

---

## Required Changes

### File 1: `app/db/migrations/versions/0012_auth.py`

#### Change 1.1: Remove Duplicate Index (Line 35)

**Current Code** (Line 35):
```python
sa.Column("user_id", sa.String(length=36), sa.ForeignKey("users.id"), nullable=False, index=True),
```

**Change To**:
```python
sa.Column("user_id", sa.String(length=36), sa.ForeignKey("users.id"), nullable=False),
```

**Rationale**: Remove `index=True` to prevent automatic index creation. The explicit `op.create_index()` on line 40 will create the index.

---

#### Change 1.2: Make Role Seeding Dialect-Aware (Lines 41-44)

**Current Code** (Lines 41-44):
```python
# Seed roles
conn = op.get_bind()
for code in ["SALES", "OPERATOR", "PROD_MANAGER", "SYS_ADMIN"]:
    conn.execute(sa.text("INSERT INTO roles (code) VALUES (:c) ON CONFLICT (code) DO NOTHING"), {"c": code})
```

**Change To**:
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

**Rationale**: SQLite uses `INSERT OR IGNORE`, PostgreSQL uses `ON CONFLICT ... DO NOTHING`.

---

### File 2: `app/db/migrations/versions/0013_seed_auth_users.py`

#### Change 2.1: Replace Entire `upgrade()` Function (Lines 15-49)

**Current Code** (Lines 15-49):
```python
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
```

**Change To**:
```python
def upgrade() -> None:
    ph = PasswordHasher()
    conn = op.get_bind()
    is_sqlite = conn.dialect.name == "sqlite"
    
    # Ensure roles exist
    roles = ["SALES", "OPERATOR", "PROD_MANAGER", "SYS_ADMIN"]
    for code in roles:
        if is_sqlite:
            conn.execute(sa.text("INSERT OR IGNORE INTO roles (code) VALUES (:c)"), {"c": code})
        else:
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
        if is_sqlite:
            conn.execute(
                sa.text(
                    "INSERT OR IGNORE INTO users (id, username, password_hash, is_active) "
                    "VALUES (:id, :u, :p, 1)"
                ),
                {"id": uid, "u": username, "p": pwd},
            )
        else:
            conn.execute(
                sa.text(
                    "INSERT INTO users (id, username, password_hash, is_active) "
                    "VALUES (:id, :u, :p, true) "
                    "ON CONFLICT (username) DO NOTHING"
                ),
                {"id": uid, "u": username, "p": pwd},
            )
        
        # Get the user_id (in case it already existed)
        result = conn.execute(
            sa.text("SELECT id FROM users WHERE username = :u"),
            {"u": username}
        ).fetchone()
        if result:
            uid = result[0]
        
        # attach roles
        for r in rlist:
            if is_sqlite:
                conn.execute(
                    sa.text(
                        "INSERT OR IGNORE INTO user_roles (user_id, role_id) "
                        "SELECT :uid, r.id FROM roles r WHERE r.code = :code"
                    ),
                    {"uid": uid, "code": r},
                )
            else:
                conn.execute(
                    sa.text(
                        "INSERT INTO user_roles (user_id, role_id) "
                        "SELECT :uid, r.id FROM roles r WHERE r.code = :code "
                        "ON CONFLICT DO NOTHING"
                    ),
                    {"uid": uid, "code": r},
                )
```

**Key Changes**:
1. Added `is_sqlite = conn.dialect.name == "sqlite"` at the start
2. Made role seeding dialect-aware
3. Made user insertion dialect-aware with `1` for SQLite boolean
4. **Added user_id fetch after insert** (critical fix)
5. Made user-role assignment dialect-aware

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
    is_sqlite = conn.dialect.name == "sqlite"
    
    # Ensure roles exist
    roles = ["SALES", "OPERATOR", "PROD_MANAGER", "SYS_ADMIN"]
    for code in roles:
        if is_sqlite:
            conn.execute(sa.text("INSERT OR IGNORE INTO roles (code) VALUES (:c)"), {"c": code})
        else:
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
        if is_sqlite:
            conn.execute(
                sa.text(
                    "INSERT OR IGNORE INTO users (id, username, password_hash, is_active) "
                    "VALUES (:id, :u, :p, 1)"
                ),
                {"id": uid, "u": username, "p": pwd},
            )
        else:
            conn.execute(
                sa.text(
                    "INSERT INTO users (id, username, password_hash, is_active) "
                    "VALUES (:id, :u, :p, true) "
                    "ON CONFLICT (username) DO NOTHING"
                ),
                {"id": uid, "u": username, "p": pwd},
            )
        
        # Get the user_id (in case it already existed)
        result = conn.execute(
            sa.text("SELECT id FROM users WHERE username = :u"),
            {"u": username}
        ).fetchone()
        if result:
            uid = result[0]
        
        # attach roles
        for r in rlist:
            if is_sqlite:
                conn.execute(
                    sa.text(
                        "INSERT OR IGNORE INTO user_roles (user_id, role_id) "
                        "SELECT :uid, r.id FROM roles r WHERE r.code = :code"
                    ),
                    {"uid": uid, "code": r},
                )
            else:
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
```

---

## Implementation Notes

### Dialect Detection Pattern

Always use this pattern at the start of the `upgrade()` function:
```python
conn = op.get_bind()
is_sqlite = conn.dialect.name == "sqlite"
```

### SQLite vs PostgreSQL Differences

| Feature | SQLite | PostgreSQL |
|---------|--------|------------|
| Conflict handling | `INSERT OR IGNORE` | `ON CONFLICT ... DO NOTHING` |
| Boolean true | `1` | `true` or `TRUE` |
| Boolean false | `0` | `false` or `FALSE` |

### User ID Fetching Pattern

**Critical**: After inserting/ignoring a user, always fetch the actual user_id:

```python
# Insert (may be ignored if user exists)
conn.execute(sa.text("INSERT OR IGNORE INTO users ..."), {...})

# Fetch actual user_id (handles both new and existing users)
result = conn.execute(
    sa.text("SELECT id FROM users WHERE username = :u"),
    {"u": username}
).fetchone()
if result:
    uid = result[0]  # Use the actual user_id
```

**Why This Matters**: If a user already exists, `INSERT OR IGNORE` won't insert, but the generated UUID won't match the existing user's ID. Fetching ensures we use the correct ID for role assignments.

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
   - ✅ Migration `0012_auth` completes without duplicate index error
   - ✅ Migration `0013_seed_auth_users` completes without SQL syntax errors
   - ✅ All tables are created: `users`, `roles`, `user_roles`, `sessions`
   - ✅ Index `ix_sessions_user_id` exists exactly once

3. **Verify Users**:
   ```bash
   sqlite3 production.db "SELECT username, is_active FROM users ORDER BY username;"
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
   - ✅ Both migrations complete without errors
   - ✅ All tables are created
   - ✅ All users are seeded with correct roles

3. **Verify Data**:
   ```sql
   SELECT u.username, r.code 
   FROM users u 
   JOIN user_roles ur ON u.id = ur.user_id 
   JOIN roles r ON ur.role_id = r.id 
   ORDER BY u.username, r.code;
   ```
   **Expected Output**: Same as SQLite test

4. **Test Login**: Same as SQLite test

---

### Test 3: Idempotency (Re-run Migrations)

1. **Setup**:
   ```bash
   # With existing database (after Test 1 or 2)
   alembic upgrade head
   ```

2. **Expected Results**:
   - ✅ Migrations complete without errors
   - ✅ No duplicate data created
   - ✅ Existing users remain unchanged
   - ✅ Roles remain unchanged (4 roles, no duplicates)
   - ✅ User-role assignments remain unchanged

---

### Test 4: Verify Index Creation

1. **SQLite**:
   ```bash
   sqlite3 production.db ".indexes sessions"
   ```
   **Expected**: `ix_sessions_user_id` appears exactly once

2. **PostgreSQL**:
   ```sql
   SELECT indexname FROM pg_indexes WHERE tablename = 'sessions';
   ```
   **Expected**: `ix_sessions_user_id` appears exactly once

---

## Verification Checklist

After applying changes, verify:

- [ ] **0012_auth.py line 35**: No longer contains `index=True`
- [ ] **0012_auth.py lines 41-44**: Uses `if is_sqlite:` for role insertion
- [ ] **0013_seed_auth_users.py**: `upgrade()` function uses `is_sqlite` checks for all INSERT statements
- [ ] **0013_seed_auth_users.py**: SQLite boolean values use `1` instead of `true`
- [ ] **0013_seed_auth_users.py**: User ID is fetched after insert/ignore before role assignment
- [ ] **0013_seed_auth_users.py**: Role seeding is dialect-aware
- [ ] **0013_seed_auth_users.py**: User insertion is dialect-aware
- [ ] **0013_seed_auth_users.py**: User-role assignment is dialect-aware
- [ ] **Both files**: Follow pattern from `0011_seeds.py` for dialect detection

---

## Expected Outcome

After applying these changes and running `alembic upgrade head` on a fresh SQLite database:

1. ✅ Migration `0012_auth` completes without the duplicate index error
2. ✅ Migration `0013_seed_auth_users` completes and creates the admin user
3. ✅ All 4 seed users are created: `admin`, `manager`, `operator`, `sales`
4. ✅ Admin user has roles: `SYS_ADMIN` and `PROD_MANAGER`
5. ✅ Login works with username `admin` and password `Admin123!`
6. ✅ Migrations are idempotent (can run multiple times safely)
7. ✅ Works on both SQLite and PostgreSQL

---

## Files to Modify

1. **`app/db/migrations/versions/0012_auth.py`**
   - Line 35: Remove `index=True`
   - Lines 41-44: Replace with dialect-aware role seeding

2. **`app/db/migrations/versions/0013_seed_auth_users.py`**
   - Lines 15-49: Replace entire `upgrade()` function with dialect-aware version

---

## Definition of Done

The work is complete when:

1. ✅ Both migration files are fixed
2. ✅ `index=True` removed from `0012_auth.py` line 35
3. ✅ All SQL statements are dialect-aware
4. ✅ User ID is fetched after insert/ignore
5. ✅ SQLite uses `1` for boolean, PostgreSQL uses `true`
6. ✅ Migrations run successfully on fresh SQLite database
7. ✅ Migrations run successfully on fresh PostgreSQL database
8. ✅ Migrations are idempotent (can run multiple times)
9. ✅ Admin user can log in with `admin` / `Admin123!`
10. ✅ All seed users are created with correct roles
11. ✅ No duplicate index errors
12. ✅ No SQL syntax errors
13. ✅ Code follows existing patterns (`0011_seeds.py` style)

---

## Reference Files

- `app/db/migrations/versions/0011_seeds.py` - Example of dialect-aware migrations
- `app/db/migrations/versions/0012_auth.py` - File to fix
- `app/db/migrations/versions/0013_seed_auth_users.py` - File to fix
- `app/auth/service.py` - Authentication service (for context)

---

## Quick Verification Commands

After applying the fixes, run these commands to verify:

```bash
# Test on SQLite
rm production.db production.db-journal 2>/dev/null || true
alembic upgrade head

# Verify users
sqlite3 production.db "SELECT username FROM users ORDER BY username;"

# Verify admin roles
sqlite3 production.db "SELECT r.code FROM users u JOIN user_roles ur ON u.id = ur.user_id JOIN roles r ON ur.role_id = r.id WHERE u.username = 'admin';"

# Verify index
sqlite3 production.db ".indexes sessions"

# Test idempotency
alembic upgrade head

# Test login (start app first)
uvicorn app.main:app --reload
# Then navigate to http://localhost:8000/auth/login
# Login with: admin / Admin123!
```

---

**End of Prompt for Database/Backend Agent**
