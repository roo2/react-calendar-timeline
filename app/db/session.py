from sqlalchemy import create_engine
import os
import logging
from sqlalchemy.orm import sessionmaker
from app.config import settings
from app.db.models import Base


def _create_engine():
    db_url = settings.DATABASE_URL
    # Prefer local SQLite if the default Postgres URL is in use and a local DB file exists
    if (not os.getenv("DATABASE_URL")) and db_url.startswith("postgresql") and os.path.exists("production.db"):
        db_url = "sqlite+pysqlite:///./production.db"
        logging.getLogger("auth").info("Using local SQLite database at ./production.db (env DATABASE_URL not set)")
    try:
        return create_engine(db_url, pool_pre_ping=True, future=True)
    except Exception:
        # Test/CI fallback: avoid requiring a PostgreSQL driver for import-time engine creation
        # Use file-based SQLite to persist schema across connections within a test run
        return create_engine("sqlite+pysqlite:///./dev.db", future=True)


engine = _create_engine()
SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False, future=True)


def _ensure_schema_and_seed() -> None:
    """
    Create tables if they don't exist (SQLite only) and seed initial data once.
    MVP simplification: avoid alembic requirement for local setups.
    """
    try:
        if str(engine.url).startswith("sqlite+pysqlite://"):
            # Ensure mapped models are imported so metadata is populated
            try:
                import app.auth.models  # noqa: F401
                import app.db.models.domain  # noqa: F401
                import app.db.models.rate_cards  # noqa: F401
            except Exception as _imp_err:  # pragma: no cover
                import sys as _sys
                print(f"WARNING: Failed to import some models: {_imp_err}", file=_sys.stderr)

            from sqlalchemy import inspect, text as _text

            inspector = inspect(engine)
            existing_tables = set(inspector.get_table_names())

            if not existing_tables:
                Base.metadata.create_all(engine)
                print("✓ Database schema created")
                # Attempt to seed initial data
                try:
                    from app.db.seed import seed_database  # type: ignore

                    seed_database(engine)
                    print("✓ Initial data seeded")
                except Exception as e:  # pragma: no cover
                    import sys

                    print(f"WARNING: Failed to seed database: {e}", file=sys.stderr)
            else:
                # If tables exist but no users, seed minimal data
                try:
                    with engine.connect() as conn:
                        result = conn.execute(_text("SELECT COUNT(*) FROM users"))
                        user_count = result.scalar_one()
                        if user_count == 0:
                            from app.db.seed import seed_database  # type: ignore

                            seed_database(engine)
                            print("✓ Initial data seeded (empty users table)")
                except Exception:
                    # If the users table doesn't exist or query fails, skip silently
                    pass
    except Exception as e:  # pragma: no cover
        import sys

        print(f"WARNING: Database auto-setup failed: {e}", file=sys.stderr)
        # Do not fail startup; allow manual setup


# Run schema setup on module import (SQLite only)
_ensure_schema_and_seed()

