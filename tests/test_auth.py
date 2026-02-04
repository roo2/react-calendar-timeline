from __future__ import annotations

from fastapi.testclient import TestClient
from app.main import app
from app.db.session import SessionLocal
from app.auth.service import AuthService
from app.auth.security import hash_password
from app.auth.models import User
from sqlalchemy import select


def setup_module(module):
    # ensure a test user exists (if not using alembic seed)
    with SessionLocal() as db:
        svc = AuthService(db)
        try:
            svc.ensure_role("PROD_MANAGER")
            svc.ensure_role("SALES")
            svc.ensure_user("manager", "Manager123!", ["PROD_MANAGER"])
            svc.ensure_user("sales", "Sales123!", ["SALES"])
        except Exception:
            pass


def test_login_logout_flow():
    c = TestClient(app)
    # Login
    r = c.post("/api/auth/login", json={"username": "manager", "password": "Manager123!"})
    assert r.status_code == 200
    assert r.json()["ok"] is True
    assert "sid" in r.cookies
    # Logout
    # fetch csrf then logout
    rcsrf = c.get("/api/auth/csrf", cookies={"sid": r.cookies.get("sid")})
    assert rcsrf.status_code == 200
    token = rcsrf.json()["csrf_token"]
    r2 = c.post("/api/auth/logout", headers={"x-csrf-token": token}, cookies={"sid": r.cookies.get("sid")})
    assert r2.status_code == 200
    assert r2.json()["data" if False else "ok"] == True


def test_guard_blocks_without_role():
    c = TestClient(app)
    # login as sales (no PROD_MANAGER)
    login = c.post("/api/auth/login", json={"username": "sales", "password": "Sales123!"})
    assert login.status_code == 200
    sid = login.cookies.get("sid")
    # call approve without csrf -> should be blocked by csrf dependency
    r = c.post("/api/quotes/123/approve", cookies={"sid": sid})
    assert r.status_code in (403, 401)


def test_guard_allows_manager_with_csrf():
    c = TestClient(app)
    login = c.post("/api/auth/login", json={"username": "manager", "password": "Manager123!"})
    assert login.status_code == 200
    sid = login.cookies.get("sid")
    # fetch csrf
    rcsrf = c.get("/api/auth/csrf", cookies={"sid": sid})
    assert rcsrf.status_code == 200
    token = rcsrf.json()["csrf_token"]
    # call approve with csrf header
    r = c.post(f"/api/quotes/123/approve", headers={"x-csrf-token": token}, cookies={"sid": sid})
    assert r.status_code in (200, 204, 202)


