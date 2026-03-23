"""Jobs: optional order_id; job_sheet_id for standalone manufacturing jobs."""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa

revision = "0006_jobs_standalone_job_sheet"
down_revision = "0005_production_operating_hours"
branch_labels = None
depends_on = None


def upgrade() -> None:
	conn = op.get_bind()
	is_sqlite = conn.dialect.name == "sqlite"
	is_pg = conn.dialect.name == "postgresql"

	if is_sqlite:
		with op.batch_alter_table("jobs", recreate="always") as batch:
			batch.drop_constraint("uq_job_order_jobcode", type_="unique")
			batch.alter_column(
				"order_id",
				existing_type=sa.String(36),
				nullable=True,
			)
			batch.add_column(sa.Column("job_sheet_id", sa.String(36), nullable=True))
			batch.create_foreign_key(
				"fk_jobs_job_sheet_id",
				"job_sheets",
				["job_sheet_id"],
				["id"],
				ondelete="RESTRICT",
			)
		op.create_index("ix_jobs_job_sheet_id", "jobs", ["job_sheet_id"], unique=False)
		op.execute(
			sa.text(
				"CREATE UNIQUE INDEX IF NOT EXISTS uq_jobs_standalone_sheet ON jobs (job_sheet_id) "
				"WHERE job_sheet_id IS NOT NULL"
			)
		)
		op.execute(
			sa.text(
				"CREATE UNIQUE INDEX IF NOT EXISTS uq_jobs_order_jobcode_partial ON jobs (order_id, job_code) "
				"WHERE order_id IS NOT NULL"
			)
		)
	elif is_pg:
		op.drop_constraint("uq_job_order_jobcode", "jobs", type_="unique")
		op.alter_column("jobs", "order_id", existing_type=sa.String(36), nullable=True)
		op.add_column("jobs", sa.Column("job_sheet_id", sa.String(36), nullable=True))
		op.create_foreign_key("fk_jobs_job_sheet_id", "jobs", "job_sheets", ["job_sheet_id"], ["id"], ondelete="RESTRICT")
		op.create_index("ix_jobs_job_sheet_id", "jobs", ["job_sheet_id"], unique=False)
		op.execute(
			sa.text(
				"CREATE UNIQUE INDEX uq_jobs_standalone_sheet ON jobs (job_sheet_id) WHERE job_sheet_id IS NOT NULL"
			)
		)
		op.execute(
			sa.text(
				"CREATE UNIQUE INDEX uq_jobs_order_jobcode_partial ON jobs (order_id, job_code) WHERE order_id IS NOT NULL"
			)
		)
		op.execute(
			sa.text(
				"ALTER TABLE jobs ADD CONSTRAINT ck_jobs_order_xor_sheet CHECK ("
				"(order_id IS NOT NULL AND job_sheet_id IS NULL) OR "
				"(order_id IS NULL AND job_sheet_id IS NOT NULL)"
				")"
			)
		)
	else:
		op.drop_constraint("uq_job_order_jobcode", "jobs", type_="unique")
		op.alter_column("jobs", "order_id", existing_type=sa.String(36), nullable=True)
		op.add_column("jobs", sa.Column("job_sheet_id", sa.String(36), nullable=True))
		op.create_foreign_key("fk_jobs_job_sheet_id", "jobs", "job_sheets", ["job_sheet_id"], ["id"], ondelete="RESTRICT")
		op.create_index("ix_jobs_job_sheet_id", "jobs", ["job_sheet_id"], unique=False)


def downgrade() -> None:
	conn = op.get_bind()
	is_sqlite = conn.dialect.name == "sqlite"
	is_pg = conn.dialect.name == "postgresql"

	if is_sqlite:
		op.execute(sa.text("DROP INDEX IF EXISTS uq_jobs_order_jobcode_partial"))
		op.execute(sa.text("DROP INDEX IF EXISTS uq_jobs_standalone_sheet"))
		op.drop_index("ix_jobs_job_sheet_id", table_name="jobs")
		with op.batch_alter_table("jobs", recreate="always") as batch:
			batch.drop_constraint("fk_jobs_job_sheet_id", type_="foreignkey")
			batch.drop_column("job_sheet_id")
			batch.alter_column("order_id", existing_type=sa.String(36), nullable=False)
			batch.create_unique_constraint("uq_job_order_jobcode", ["order_id", "job_code"])
	elif is_pg:
		op.execute(sa.text("ALTER TABLE jobs DROP CONSTRAINT IF EXISTS ck_jobs_order_xor_sheet"))
		op.execute(sa.text("DROP INDEX IF EXISTS uq_jobs_order_jobcode_partial"))
		op.execute(sa.text("DROP INDEX IF EXISTS uq_jobs_standalone_sheet"))
		op.drop_index("ix_jobs_job_sheet_id", table_name="jobs")
		op.drop_constraint("fk_jobs_job_sheet_id", "jobs", type_="foreignkey")
		op.drop_column("jobs", "job_sheet_id")
		op.alter_column("jobs", "order_id", existing_type=sa.String(36), nullable=False)
		op.create_unique_constraint("uq_job_order_jobcode", "jobs", ["order_id", "job_code"])
	else:
		op.drop_constraint("fk_jobs_job_sheet_id", "jobs", type_="foreignkey")
		op.drop_index("ix_jobs_job_sheet_id", table_name="jobs")
		op.drop_column("jobs", "job_sheet_id")
		op.alter_column("jobs", "order_id", existing_type=sa.String(36), nullable=False)
		op.create_unique_constraint("uq_job_order_jobcode", "jobs", ["order_id", "job_code"])
