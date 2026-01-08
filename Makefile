PY=python
PIP=pip

.PHONY: install lint test migrate run

install:
	$(PIP) install -r requirements.txt

lint:
	ruff check .
	black --check .
	isort --check-only .
	mypy .

test:
	pytest

migrate:
	alembic upgrade head

run:
	uvicorn app.main:app --reload --host 0.0.0.0 --port 8000


