from __future__ import annotations
from logging.config import fileConfig
import os
import re
import sys
from pathlib import Path

from alembic import context
from sqlalchemy import engine_from_config, pool

# Set environment variable to disable auto-create during migrations
os.environ["ALEMBIC_RUNNING"] = "1"

# Ensure the repo root is on sys.path so `import app...` works regardless of
# how Alembic is invoked (some setups put only the migrations directory on path).
_REPO_ROOT = Path(__file__).resolve().parents[3]
if str(_REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(_REPO_ROOT))

# this is the Alembic Config object, which provides
# access to the values within the .ini file in use.
config = context.config

# Interpret the config file for Python logging.
if config.config_file_name is not None:
    fileConfig(config.config_file_name)

# Override DB URL from environment if provided
db_url = os.getenv("DATABASE_URL")
if db_url:
    # Normalize Heroku-style URLs for SQLAlchemy
    if db_url.startswith("postgres://"):
        db_url = "postgresql+psycopg://" + db_url[len("postgres://") :]
    elif db_url.startswith("postgresql://"):
        db_url = "postgresql+psycopg://" + db_url[len("postgresql://") :]
    config.set_main_option("sqlalchemy.url", db_url)

# Import models so Alembic can (optionally) autogenerate in the future.
# This does not affect runtime upgrades because our migrations are explicit.
from app.db.models import Base  # noqa: E402
import app.db.models.domain  # noqa: F401,E402
import app.db.models.rate_cards  # noqa: F401,E402
import app.auth.models  # noqa: F401,E402

target_metadata = Base.metadata

# Default Postgres `alembic_version.version_num` is VARCHAR(32); revision ids must fit.
_ALEMBIC_VERSION_NUM_MAX_LEN = 32
_REVISION_ASSIGN_RE = re.compile(r"^\s*revision\s*=\s*[\"']([^\"']+)[\"']", re.MULTILINE)


def _assert_migration_revision_ids_fit_version_table() -> None:
    """Fail before running migrations if any revision id exceeds VARCHAR(32)."""
    versions_dir = Path(__file__).resolve().parent / "versions"
    if not versions_dir.is_dir():
        return
    bad: list[str] = []
    for path in sorted(versions_dir.glob("*.py")):
        try:
            text = path.read_text(encoding="utf-8")
        except OSError:
            continue
        m = _REVISION_ASSIGN_RE.search(text)
        if not m:
            continue
        rid = m.group(1)
        if len(rid) > _ALEMBIC_VERSION_NUM_MAX_LEN:
            bad.append(f"  {path.name}: revision={rid!r} ({len(rid)} chars, max {_ALEMBIC_VERSION_NUM_MAX_LEN})")
    if bad:
        msg = (
            "Alembic revision id(s) exceed "
            f"{_ALEMBIC_VERSION_NUM_MAX_LEN} characters; Postgres "
            "`alembic_version.version_num` is VARCHAR(32) by default and will reject "
            "the version update (e.g. on Heroku). Shorten `revision =` in each file, "
            "or widen that column. See app/db/migrations/README.md.\n"
            + "\n".join(bad)
        )
        raise RuntimeError(msg)


def run_migrations_offline() -> None:
    _assert_migration_revision_ids_fit_version_table()
    url = config.get_main_option("sqlalchemy.url")
    context.configure(url=url, target_metadata=target_metadata, literal_binds=True)
    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    _assert_migration_revision_ids_fit_version_table()
    connectable = engine_from_config(
        config.get_section(config.config_ini_section),
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,
    )
    with connectable.connect() as connection:
        context.configure(connection=connection, target_metadata=target_metadata)
        with context.begin_transaction():
            context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()


