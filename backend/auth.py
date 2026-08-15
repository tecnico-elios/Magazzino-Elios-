"""Auth core — bcrypt hashing, JWT tokens, FastAPI dependencies.

Design (Prompt 220 §Auth) + F7 estensioni:
  - Users stored in MongoDB `users` collection. NEVER in Notion.
  - Passwords: bcrypt hash only. NEVER plaintext (DB/logs/Notion/frontend/source).
  - Roles: "operator" | "admin".
  - Session invalidation after password reset via `password_version` — the JWT
    embeds `pwv`, and `get_current_user` rejects tokens whose `pwv` no longer
    matches the user's current `password_version`.
  - `active_sessions` MongoDB collection tracks per-JWT session:
      {sid, user_id, username, created_at, last_activity, last_login}
    Ogni JWT contiene `sid` (session id). `get_current_user` verifica che la
    sessione esista ancora (l'admin può disconnetterla via DELETE /admin/sessions/{sid}).
    Ad ogni chiamata autenticata `last_activity` viene aggiornata.
    NON viene mai salvata informazione sul dispositivo (IP/UA) — solo tempo.
  - `must_change_password`: se True l'utente può usare SOLO /auth/me e
    /auth/change-my-password. Ogni altra rotta ritorna 403 con codice specifico.
  - Bootstrap: NO auto-seeded admin. Endpoint `POST /api/auth/bootstrap`
    works ONLY when `db.users` is empty (see routes/auth_routes.py).
"""
from __future__ import annotations

import os
import uuid
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


def _remember_ttl_minutes() -> int:
    """Durata token quando l'utente ha spuntato 'Rimani collegato'."""
    try:
        return int(os.environ.get("JWT_REMEMBER_TTL_MINUTES", str(60 * 24 * 30)))  # 30 giorni
    except ValueError:
        return 60 * 24 * 30


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

def create_access_token(
    user_id: str,
    username: str,
    role: str,
    password_version: int,
    remember: bool = False,
    sid: Optional[str] = None,
) -> str:
    now = datetime.now(timezone.utc)
    ttl_min = _remember_ttl_minutes() if remember else _access_ttl_minutes()
    payload = {
        "sub": user_id,
        "username": username,
        "role": role,
        "pwv": password_version,
        "rem": bool(remember),
        "iat": int(now.timestamp()),
        "exp": now + timedelta(minutes=ttl_min),
        "type": "access",
    }
    if sid:
        payload["sid"] = sid
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
        "email": doc.get("email"),
        "role": doc.get("role"),
        "active": bool(doc.get("active", True)),
        "must_change_password": bool(doc.get("must_change_password", False)),
        "last_login": doc.get("last_login"),
        "created_at": doc.get("created_at"),
    }


# ---------- Session helpers ----------

async def create_session(db, user_id: str, username: str) -> str:
    """Crea una nuova sessione in `active_sessions` e ritorna il session id."""
    sid = uuid.uuid4().hex
    now = datetime.now(timezone.utc)
    await db.active_sessions.insert_one({
        "sid": sid,
        "user_id": user_id,
        "username": username,
        "created_at": now,
        "last_login": now,
        "last_activity": now,
    })
    return sid


async def touch_session(db, sid: str) -> None:
    """Aggiorna last_activity — best-effort, non blocca la request se fallisce."""
    if not sid:
        return
    try:
        await db.active_sessions.update_one(
            {"sid": sid},
            {"$set": {"last_activity": datetime.now(timezone.utc)}},
        )
    except Exception as e:
        logger.warning("touch_session failed for sid=%s: %s", sid, e)


async def invalidate_all_sessions_for_user(db, user_id: str) -> int:
    """Elimina tutte le sessioni di un utente (usato dopo reset password / disattivazione)."""
    try:
        res = await db.active_sessions.delete_many({"user_id": str(user_id)})
        return int(res.deleted_count or 0)
    except Exception:
        return 0


# ---------- FastAPI dependencies ----------

def _extract_token(request: Request, authorization: Optional[str]) -> str:
    if authorization and authorization.lower().startswith("bearer "):
        return authorization[7:].strip()
    # NO cookie fallback: i cookie possono essere sincronizzati tra dispositivi
    # via Chrome Sync o iCloud Keychain. Solo Bearer header è per-device.
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
        # Session check — se il JWT ha un sid, deve esistere in active_sessions
        sid = payload.get("sid")
        if sid:
            sess = await self.db.active_sessions.find_one({"sid": sid})
            if not sess:
                raise HTTPException(401, "Sessione disconnessa")
            # Touch last_activity (best-effort, non blocca)
            await touch_session(self.db, sid)
            doc["_sid"] = sid
        # must_change_password: guard applied by require_password_current below
        return doc

    async def require_password_current(
        self,
        request: Request,
        authorization: Optional[str] = Header(default=None),
    ) -> Dict[str, Any]:
        """Come get_current_user ma blocca l'accesso se must_change_password=True.
        Usa questa in tutte le rotte NON coinvolte nel cambio password."""
        user = await self.get_current_user(request, authorization)
        if user.get("must_change_password"):
            raise HTTPException(
                status_code=403,
                detail={
                    "code": "password_change_required",
                    "message": "Devi impostare una nuova password al primo accesso.",
                },
            )
        return user

    async def require_admin(
        self,
        request: Request,
        authorization: Optional[str] = Header(default=None),
    ) -> Dict[str, Any]:
        user = await self.require_password_current(request, authorization)
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
