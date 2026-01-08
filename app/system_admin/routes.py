from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select

from app.auth.deps import require_capability, csrf_protect
from app.auth.models import User
from app.auth.service import AuthService
from app.db.session import SessionLocal
from app.system_admin.schemas import CreateUserBody

router = APIRouter(prefix="/sys", tags=["system_admin"])


@router.get("/users", dependencies=[Depends(require_capability("system_admin"))])
async def list_users():
    with SessionLocal() as db:
        users = db.execute(select(User)).scalars().all()
        return [{"id": str(u.id), "username": u.username, "roles": [r.code for r in u.roles], "is_active": u.is_active} for u in users]


@router.post("/users", dependencies=[Depends(require_capability("system_admin")), Depends(csrf_protect())])
async def create_user(body: CreateUserBody):
    with SessionLocal() as db:
        svc = AuthService(db)
        user = svc.ensure_user(body.username, body.password, body.roles)
        return {"id": str(user.id), "username": user.username, "roles": [r.code for r in user.roles]}


