# Database migrations (Alembic)

## Revision IDs and Postgres / Heroku

Alembic records the current head in the `alembic_version` table, column `version_num`. On **PostgreSQL** (including **Heroku Postgres**), that column is **`VARCHAR(32)`** by default.

Each migration file’s `revision = "..."` string is written into that column when the migration runs. If the revision id is **longer than 32 characters**, the upgrade fails with:

`StringDataRightTruncation: value too long for type character varying(32)`

### What to do

1. **Prefer short revision strings** (≤ 32 characters), e.g. `0007_drop_anilox` instead of a long sentence-style id.
2. **`env.py` runs a check** before migrations: if any `versions/*.py` has `revision =` longer than 32 characters, Alembic exits with an error pointing here.
3. If you truly need longer ids, run a one-off SQL migration to widen the column first, e.g.  
   `ALTER TABLE alembic_version ALTER COLUMN version_num TYPE VARCHAR(128);`  
   (coordinate with the team; new environments still need this applied once.)

### Renaming a revision id after it was applied (dev DB)

If you change a migration’s `revision =` string but your DB’s `alembic_version` row still has the **old** id, Alembic will error (`Can't locate revision identified by '…'`). Fix by updating that row to the **new** id (no need to re-run the migration body).

Current linear head: **`0011_myob_orders_unified`** (see `versions/*.py` for the full chain `0001_initial_schema` → … → `0011_myob_orders_unified`).

Example (Postgres / Heroku `psql`):

```sql
UPDATE alembic_version
SET version_num = '0010_cust_myob_json_nocode'
WHERE version_num = '<old_revision_here>';
```

Example (SQLite):

```bash
sqlite3 production.db "UPDATE alembic_version SET version_num = '0010_cust_myob_json_nocode' WHERE version_num = '<old_revision_here>';"
```

If the stored value looks wrong or truncated, inspect with `SELECT * FROM alembic_version;` and fix manually, then run `alembic upgrade head` again.
