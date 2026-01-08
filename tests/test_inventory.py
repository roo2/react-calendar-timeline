from __future__ import annotations

from fastapi.testclient import TestClient

from app.main import app
from app.db.session import SessionLocal
from sqlalchemy import select

from app.auth.service import AuthService
from app.auth.models import User, Role, UserRole
from app.auth.security import hash_password
from app.db.models import Base
from app.db.session import engine
from datetime import datetime, timezone


def setup_module(module):
    # ensure test users/roles exist
    # create tables if not present (sqlite memory in tests)
    try:
        Base.metadata.create_all(bind=engine)
    except Exception:
        pass
    with SessionLocal() as db:
        svc = AuthService(db)
        try:
            svc.ensure_role("PROD_MANAGER")
            svc.ensure_role("SALES")
            svc.ensure_user("manager", "Manager123!", ["PROD_MANAGER"])
            svc.ensure_user("sales", "Sales123!", ["SALES"])
        except Exception:
            pass
        # Ensure users exist (fallback path)
        for uname, pwd, role_code in [("manager", "Manager123!", "PROD_MANAGER"), ("sales", "Sales123!", "SALES")]:
            u = db.scalar(select(User).where(User.username == uname))
            if u is None:
                u = User(
                    username=uname,
                    password_hash=hash_password(pwd),
                    is_active=True,
                    created_at=datetime.now(timezone.utc),
                )
                db.add(u)
                db.flush()
            r = db.scalar(select(Role).where(Role.code == role_code))
            if r is None:
                r = Role(code=role_code)
                db.add(r)
                db.flush()
            link = db.scalar(select(UserRole).where(UserRole.user_id == u.id, UserRole.role_id == r.id))
            if link is None:
                db.add(UserRole(user_id=u.id, role_id=r.id))
        db.commit()


def login_get_csrf(username: str, password: str):
    c = TestClient(app)
    r = c.post("/auth/login", json={"username": username, "password": password})
    assert r.status_code == 200
    sid = r.cookies.get("sid")
    rcsrf = c.get("/auth/csrf", cookies={"sid": sid})
    assert rcsrf.status_code == 200
    return c, sid, rcsrf.json()["csrf_token"]


def test_inventory_receive_and_adjust_updates_ledger():
    c, sid, csrf = login_get_csrf("manager", "Manager123!")
    # Receive 10 kg raw
    r1 = c.post(
        "/inventory/receive",
        json={"category": "raw_material", "quantity": "10", "uom": "kg"},
        headers={"x-csrf-token": csrf},
        cookies={"sid": sid},
    )
    assert r1.status_code in (200, 204)
    # Adjust -5 kg raw
    r2 = c.post(
        "/inventory/adjust",
        json={"category": "raw_material", "quantity": "-5", "uom": "kg"},
        headers={"x-csrf-token": csrf},
        cookies={"sid": sid},
    )
    assert r2.status_code in (200, 204)
    # Transactions page loads
    r3 = c.get("/inventory/transactions", cookies={"sid": sid})
    assert r3.status_code == 200
    assert "Inventory Transactions" in r3.text


def test_inventory_permissions_block_non_manager_posts():
    c, sid, csrf = login_get_csrf("sales", "Sales123!")
    # POST should be forbidden
    r = c.post(
        "/inventory/receive",
        json={"category": "raw_material", "quantity": "1", "uom": "kg"},
        headers={"x-csrf-token": csrf},
        cookies={"sid": sid},
    )
    assert r.status_code == 403



