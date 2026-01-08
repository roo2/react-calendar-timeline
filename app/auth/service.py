from __future__ import annotations

import os
import secrets
import uuid
from datetime import datetime, timedelta, timezone
from typing import Iterable, List, Optional, Tuple

from sqlalchemy import select, delete
from sqlalchemy.orm import Session
import logging

from app.db.session import SessionLocal
from app.auth.models import User, Role, UserSession
from app.auth.security import hash_password, verify_password, ROLES
from app.auth.security import _HAVE_ARGON2  # type: ignore
from typing import NoReturn


class AuthError(Exception):
    pass


class AuthService:
    def __init__(self, db: Optional[Session] = None, *, session_ttl_hours: int | None = None) -> None:
        self._db = db or SessionLocal()
        self._ttl = timedelta(hours=(session_ttl_hours or 8))
        self._logger = logging.getLogger("auth")

    # --- User/Role provisioning helpers (for seeds) ---
    def ensure_role(self, code: str) -> Role:
        if code not in ROLES:
            raise ValueError(f"Unknown role: {code}")
        with self._db.begin():
            role = self._db.scalar(select(Role).where(Role.code == code))
            if role is None:
                role = Role(code=code)
                self._db.add(role)
                self._db.flush()
        return role

    def ensure_user(self, username: str, password: str, roles: Iterable[str]) -> User:
        with self._db.begin():
            user = self._db.scalar(select(User).where(User.username == username))
            if user is None:
                user = User(username=username, password_hash=hash_password(password), is_active=True)
                self._db.add(user)
                self._db.flush()
            # sync roles
            role_objs = [self.ensure_role(r) for r in roles]
            user.roles = list(set(role_objs))
        return user

    # --- Auth flows ---
    def login(self, username: str, password: str) -> UserSession:
        self._logger.info("login_attempt username=%s argon2=%s", username, _HAVE_ARGON2)
        user: Optional[User] = self._db.scalar(select(User).where(User.username == username))
        if not user:
            self._logger.warning("login_user_not_found username=%s", username)
            return self._fail_login(username)
        if not user.is_active:
            self._logger.warning("login_inactive_user username=%s user_id=%s", username, user.id)
            return self._fail_login(username)
        ok = False
        try:
            ok = verify_password(password, user.password_hash)
        except Exception as e:
            self._logger.exception("login_verify_exception username=%s err=%s", username, e)
        if not ok:
            # Log failed auth event (could be to DB or standard logging)
            self._logger.info("login_failed username=%s", username)
            return self._fail_login(username)
        # Invalidate existing session(s) if any (single session policy for simplicity)
        self._db.execute(delete(UserSession).where(UserSession.user_id == user.id))
        sess = UserSession(
            user_id=user.id,
            created_at=datetime.now(timezone.utc),
            expires_at=datetime.now(timezone.utc) + self._callable_ttl(),
            csrf_token=secrets.token_urlsafe(32),
        )
        self._db.add(sess)
        self._db.commit()
        self._logger.info("login_success username=%s user_id=%s", user.username, user.id)
        return sess

    def logout(self, session_id: str) -> None:
        self._db.execute(delete(UserSession).where(UserSession.id == str(session_id)))
        self._db.commit()
        self._logger.info("logout session_id=%s", session_id)

    def get_current_user(self, sid: Optional[str]) -> Tuple[Optional[User], List[str], Optional[str]]:
        if not sid:
            return None, [], None
        now = datetime.now(timezone.utc)
        with self._db.begin():
            sess: Optional[UserSession] = self._db.get(UserSession, str(sid))
            if not sess:
                return None, [], None
            # Normalize expires_at to UTC-aware datetime before comparison
            exp = sess.expires_at
            if exp.tzinfo is None:
                exp = exp.replace(tzinfo=timezone.utc)
            if exp <= now:
                return None, [], None
            user = self._db.get(User, sess.user_id)
            roles = [r.code for r in (user.roles if user else [])]
            return user, roles, str(sess.csrf_token)

    # --- Authorization helpers ---
    def require_roles(self, have: List[str], needed: Tuple[str, ...]) -> None:
        wanted = set(needed)
        have_set = set(have)
        if not wanted.issubset(have_set):
            raise PermissionError("forbidden")

    def require_capability(self, have: List[str], capability: str) -> None:
        if capability == "system_admin":
            if "SYS_ADMIN" not in have:
                raise PermissionError("forbidden")
        else:
            raise PermissionError("unknown capability")

    def _callable_ttl(self) -> timedelta:
        return self._ttl

    # Logging (placeholder for persistence)
    def _fail_login(self, username: str) -> NoReturn:
        # Hook: integrate with audit logging per SDS 13 §7.1
        raise AuthError("invalid_credentials")

