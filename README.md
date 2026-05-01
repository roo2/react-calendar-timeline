# Production_software

Repo for Crown Pack Production Software.

- Database additions for Quote Engine and Analytics:
  - Rate card tables: `resins`, `additives`, `colours`, `cores`, `printing_rates`, `conversion_rates`, `waste_adders`
  - Enums: `printing_method` (none | inline | uteco)
  - Code defaults: DB sequences applied to `customers.code`, `products.code`, `orders.code`
  - Views: `v_inventory_balances_by_category`, `v_wip_stage_balances`
  - See `docs/DB_SCHEMA.md` for details and constraints

## Local Development Setup (SQLite by default)

Prereqs: Python 3.11+

1) Create a virtualenv and install dependencies

```bash
python -m venv .venv && source .venv/bin/activate  # Windows: py -m venv .venv && .venv\Scripts\activate
pip install -r requirements.txt
```

2) Configure environment

```bash
cp env.example .env  # defaults to SQLite: sqlite+pysqlite:///./production.db
# (Optional) To use PostgreSQL instead, set DATABASE_URL in .env accordingly.
```

3) Run migrations

```bash
alembic upgrade head
```

4) Start the server

```bash
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

5) Visit

- App: http://localhost:8000/
- Health: http://localhost:8000/health

## Frontend (React + Redux)

The UI is a React SPA in `frontend/` (Redux Toolkit + React Router).

### Run in dev (two terminals)

Backend:

```bash
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

Frontend:

```bash
cd frontend
npm install
npm run dev
```

## Tests & tooling

```
pip install -r requirements.txt
pytest
ruff check .
black --check .
isort --check-only .
mypy .
```

Pre-commit:

```
pre-commit install
pre-commit run -a
```

## Local Dev & Quality

1. Install dependencies and tooling

```bash
python -m venv .venv && source .venv/bin/activate  # or use py -m venv .venv on Windows
pip install -r requirements.txt
pip install pre-commit
pre-commit install
```

## How to Run Locally

Prerequisites: Python 3.11+, Docker, Docker Compose, pre-commit.

1) Clone repository

```bash
git clone <your_repo_url> && cd <repo_dir>
```

2) Environment

```bash
cp env.example .env  # or set DATABASE_URL in your environment
```

3) Start database

```bash
docker compose up -d db
```

4) Apply migrations

```bash
export DATABASE_URL=postgresql+psycopg://app:app@localhost:5432/app
alembic upgrade head
```

5) Start dev server

```bash
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

6) Verify health

- http://localhost:8000/health → {"status":"ok"}
- http://localhost:8000/health/db → {"status":"ok","db":"ok"}

2. Run locally

```bash
# start Postgres
docker compose up -d db
# migrate schema
export DATABASE_URL=postgresql+psycopg://app:app@localhost:5432/app
alembic upgrade head
# run dev server with reload
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

3. Run quality checks locally

```bash
pre-commit run -a                 # ruff --fix, black, isort, mypy, basic hooks
pytest                            # unit tests
make lint || true                 # optional convenience target
```

### API

- All application endpoints are exposed under `/api/*` (cookie auth + CSRF header `x-csrf-token`).
- The React dev server proxies `/api` to `http://localhost:8000` (see `frontend/vite.config.ts`).

### Troubleshooting

- /health/db returns 503:
  - Ensure Docker DB is running: `docker compose ps db`
  - Verify `DATABASE_URL` points to the running DB
  - Re-run migrations: `alembic upgrade head`
  - Check network access to `localhost:5432`
- pre-commit failures:
  - Ensure hooks are installed: `pre-commit install`
  - Confirm Python 3.11+ is active in your environment
  - Run `pre-commit run -a` and follow reported fixes

## Structure (SDS 11 aligned)

- `app/` modular monolith packages (routes/service/schemas)
- `frontend/` React + Redux SPA
- `app/db/` SQLAlchemy session, Alembic migrations
- `static/` assets

No business logic yet: downstream agents will add domain models and services.