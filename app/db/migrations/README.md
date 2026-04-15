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

If you shorten a `revision =` string but your local DB’s `alembic_version` row still has the **old** id, Alembic will error (`Can't locate revision identified by '…'`). Fix by updating that row to the **new** id (no need to re-run the migration body).

Example (Postgres / Heroku `psql`):

```sql
UPDATE alembic_version
SET version_num = '0006_quote_mat_retail_bands'
WHERE version_num = '0006_quote_materials_retail_bands';
```

Example (SQLite):

```bash
sqlite3 production.db "UPDATE alembic_version SET version_num = '0006_quote_mat_retail_bands' WHERE version_num = '0006_quote_materials_retail_bands';"
```

**Heroku:** if deploy failed on the `UPDATE alembic_version …` step, the DB usually never left the previous head (e.g. `0005_drop_carton_options`) — then you only deploy the shortened revision and run `alembic upgrade head` again. If somehow a truncated or inconsistent value exists, inspect with `SELECT * FROM alembic_version;` and fix manually.
