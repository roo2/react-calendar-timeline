# Production_software
Repo for Crown Pack Production Software

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

### Operational Dashboard (MVP)

- Page: `GET /dashboard` (Production Manager; server-rendered)
- Cards refresh via HTMX every 60s:
  - Inventory & WIP snapshot → `GET /dashboard/partial/inventory_snapshot`
  - Throughput (weekly) → `GET /dashboard/partial/throughput_weekly?start=YYYY-Www`
- Weekly KPI export (stub for MVP): `GET /reports/kpi/weekly?start=YYYY-Www&weeks=N&format=json|csv`

Add a new card (pattern):
1) Create template `app/templates/dashboard/_card_<name>.html`
2) Extend `DashboardService.get_card("<name>", window)` to return render context
3) Map the route in `app/dashboard/routes.py` to render the template
4) Add a container to `app/templates/dashboard/index.html`:
   ```html
   <div hx-get="/dashboard/partial/<name>" hx-trigger="load, every 60s" hx-swap="outerHTML"></div>
   ```

Data sources (MVP):
- Inventory snapshot prefers views `v_inventory_balances_by_category`, `v_wip_stage_balances`; falls back to ledger aggregation.
- Throughput aggregates `run_output_entries` by operation type and week.

Performance:
- 60s in-process TTL cache per card+window; page <700ms, card refresh <250ms (target).

Screenshot (placeholder):

`docs/images/dashboard_mvp_placeholder.png` (add later)

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

### HTMX partials pattern

- Route: `GET /partials/ping` implemented in `app/health/routes.py`, renders `app/templates/partials/ping.html` with current time and a green “OK” badge.
- The home page (`app/templates/index.html`) includes:

```html
<div id="ping-slot"
     hx-get="/partials/ping"
     hx-trigger="load, every 30s"
     hx-swap="outerHTML"></div>
```

This demonstrates how dashboard cards and other widgets can be implemented as independently refreshable HTMX partials.

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
- `app/templates/` Jinja2 pages (server-rendered + HTMX)
- `app/db/` SQLAlchemy session, Alembic migrations
- `static/` assets

No business logic yet: downstream agents will add domain models and services.