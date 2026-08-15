"""Auth core — bcrypt hashing, JWT tokens, FastAPI dependencies.

Design (Prompt 220 §Auth):
  - Users stored in MongoDB `users` collection. NEVER in Notion.
  - Passwords: bcrypt hash only. NEVER plaintext (DB/logs/Notion/frontend/source).
  - Roles: "operator" | "admin".
  - Session invalidation after password reset via `password_version` — the JWT
    embeds `pwv`, and `get_current_user` rejects tokens whose `pwv` no longer
    matches the user's current `password_version`.
  - Bootstrap: NO auto-seeded admin. Endpoint `POST /api/auth/bootstrap`
    works ONLY when `db.users` is empty (see routes/auth_routes.py).
"""
from __future__ import annotations

import os
import logging
from datetime import datetime, timezone, timedelta
from typing import Optional, Dict, Any

import bcrypt
import jwt
from bson import ObjectId
from fastapi import HTTPException, Depends, Header, Request

logger = logging.getLogger(__name__)

JWT_ALGORITHM = "HS256"
ROLE_ADMIN = "admin"
ROLE_OPERATOR = "operator"
VALID_ROLES = {ROLE_ADMIN, ROLE_OPERATOR}


def _jwt_secret() -> str:
    s = os.environ.get("JWT_SECRET")
    if not s:
        raise RuntimeError("JWT_SECRET missing in environment")
    return s


def _access_ttl_minutes() -> int:
    try:
        return int(os.environ.get("JWT_ACCESS_TTL_MINUTES", "480"))
    except ValueError:
        return 480


# ---------- Password hashing ----------

def hash_password(password: str) -> str:
    if not password or len(password) < 6:
        raise ValueError("La password deve avere almeno 6 caratteri")
    salt = bcrypt.gensalt(rounds=12)
    return bcrypt.hashpw(password.encode("utf-8"), salt).decode("utf-8")


def verify_password(plain: str, hashed: str) -> bool:
    if not plain or not hashed:
        return False
    try:
        return bcrypt.checkpw(plain.encode("utf-8"), hashed.encode("utf-8"))
    except (ValueError, TypeError):
        return False


# ---------- JWT ----------

def create_access_token(user_id: str, username: str, role: str, password_version: int) -> str:
    now = datetime.now(timezone.utc)
    payload = {
        "sub": user_id,
        "username": username,
        "role": role,
        "pwv": password_version,
        "iat": int(now.timestamp()),
        "exp": now + timedelta(minutes=_access_ttl_minutes()),
        "type": "access",
    }
    return jwt.encode(payload, _jwt_secret(), algorithm=JWT_ALGORITHM)


def decode_token(token: str) -> Dict[str, Any]:
    try:
        return jwt.decode(token, _jwt_secret(), algorithms=[JWT_ALGORITHM])
    except jwt.ExpiredSignatureError:
        raise HTTPException(401, "Token scaduto")
    except jwt.InvalidTokenError:
        raise HTTPException(401, "Token non valido")


# ---------- Sanitization ----------

def public_user(doc: Dict[str, Any]) -> Dict[str, Any]:
    """Strip sensitive fields before exposing a user document via API."""
    if not doc:
        return {}
    return {
        "id": str(doc.get("_id")),
        "username": doc.get("username"),
        "first_name": doc.get("first_name"),
        "last_name": doc.get("last_name"),
        "full_name": f"{doc.get('first_name') or ''} {doc.get('last_name') or ''}".strip() or doc.get("username"),
        "role": doc.get("role"),
        "active": bool(doc.get("active", True)),
        "last_login": doc.get("last_login"),
        "created_at": doc.get("created_at"),
    }


# ---------- FastAPI dependencies ----------

def _extract_token(request: Request, authorization: Optional[str]) -> str:
    if authorization and authorization.lower().startswith("bearer "):
        return authorization[7:].strip()
    # Fallback to cookie (future-proof if we ever switch to cookie mode)
    tok = request.cookies.get("access_token")
    if tok:
        return tok
    raise HTTPException(401, "Autenticazione richiesta")


async def _load_user_from_db(db, user_id: str) -> Dict[str, Any]:
    try:
        oid = ObjectId(user_id)
    except Exception:
        raise HTTPException(401, "Token non valido")
    doc = await db.users.find_one({"_id": oid})
    if not doc:
        raise HTTPException(401, "Utente non trovato")
    return doc


class AuthDependencies:
    """Bound to the db handle from server.py. Exposes FastAPI dependencies
    that DON'T need `db` to be passed explicitly at call sites."""

    def __init__(self, db):
        self.db = db

    async def get_current_user(
        self,
        request: Request,
        authorization: Optional[str] = Header(default=None),
    ) -> Dict[str, Any]:
        token = _extract_token(request, authorization)
        payload = decode_token(token)
        if payload.get("type") != "access":
            raise HTTPException(401, "Tipo token non valido")
        user_id = payload.get("sub")
        if not user_id:
            raise HTTPException(401, "Token malformato")
        doc = await _load_user_from_db(self.db, user_id)
        # Invalidation: JWT pwv must match user's current password_version
        if int(payload.get("pwv", 0)) != int(doc.get("password_version", 1)):
            raise HTTPException(401, "Sessione scaduta — rieffettua il login")
        if not doc.get("active", True):
            raise HTTPException(403, "Utente disattivato")
        return doc

    async def require_admin(
        self,
        request: Request,
        authorization: Optional[str] = Header(default=None),
    ) -> Dict[str, Any]:
        user = await self.get_current_user(request, authorization)
        if user.get("role") != ROLE_ADMIN:
            raise HTTPException(403, "Solo gli amministratori possono accedere a questa risorsa")
        return user

    async def optional_user(
        self,
        request: Request,
        authorization: Optional[str] = Header(default=None),
    ) -> Optional[Dict[str, Any]]:
        """Return the current user if a valid token is present, else None.
        Never raises. Used to gracefully upgrade F6 endpoints during migration."""
        try:
            return await self.get_current_user(request, authorization)
        except HTTPException:
            return None
