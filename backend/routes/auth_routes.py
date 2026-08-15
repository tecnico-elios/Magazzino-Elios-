"""Auth routes — login, me, bootstrap primo admin, cambio password personale.

F7 additions:
  - Login crea una entry in `active_sessions` (sid) e la include nel JWT.
  - Tracciamento tentativi di login falliti con lockout temporaneo (settings).
  - Nuovi utenti creati dall'admin ricevono must_change_password=True e devono
    cambiare password al primo login prima di poter usare l'app.
"""
from __future__ import annotations

import re
import secrets
import logging
from datetime import datetime, timezone, timedelta
from typing import Optional

from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel, Field, ConfigDict

import auth as auth_mod

logger = logging.getLogger(__name__)

_USERNAME_RE = re.compile(r"^[a-z0-9][a-z0-9._-]{1,31}$")


class LoginBody(BaseModel):
    model_config = ConfigDict(extra="ignore")
    username: str
    password: str
    remember_me: bool = False


class ForgotPasswordBody(BaseModel):
    model_config = ConfigDict(extra="ignore")
    username: str


class ResetPasswordTokenBody(BaseModel):
    model_config = ConfigDict(extra="ignore")
    token: str = Field(min_length=10, max_length=128)
    new_password: str = Field(min_length=6, max_length=128)


class BootstrapBody(BaseModel):
    model_config = ConfigDict(extra="ignore")
    first_name: str = Field(min_length=1, max_length=80)
    last_name: str = Field(min_length=1, max_length=80)
    username: str = Field(min_length=2, max_length=32)
    password: str = Field(min_length=6, max_length=128)


class ChangeMyPasswordBody(BaseModel):
    model_config = ConfigDict(extra="ignore")
    old_password: str = Field(min_length=1, max_length=128)
    new_password: str = Field(min_length=6, max_length=128)


def _normalize_username(u: str) -> str:
    return (u or "").strip().lower()


async def _get_sicurezza_settings(db) -> dict:
    """Legge le impostazioni sicurezza (max_login_attempts, lockout_minutes) dal store."""
    doc = await db.settings.find_one({"_id": "app_settings"}) or {}
    sec = (doc.get("sicurezza") or {}) if isinstance(doc.get("sicurezza"), dict) else {}
    return {
        "max_login_attempts": int(sec.get("max_login_attempts", 5)),
        "lockout_minutes": int(sec.get("lockout_minutes", 5)),
    }


async def _check_lockout(db, username: str) -> None:
    rec = await db.login_attempts.find_one({"username": username})
    if not rec:
        return
    locked_until = rec.get("locked_until")
    if isinstance(locked_until, datetime):
        lu = locked_until if locked_until.tzinfo else locked_until.replace(tzinfo=timezone.utc)
        now = datetime.now(timezone.utc)
        if lu > now:
            remaining = int((lu - now).total_seconds() // 60) + 1
            raise HTTPException(
                status_code=429,
                detail=f"Troppi tentativi falliti. Riprova tra {remaining} minut{'o' if remaining == 1 else 'i'}.",
            )


async def _record_login_failure(db, username: str) -> None:
    sec = await _get_sicurezza_settings(db)
    now = datetime.now(timezone.utc)
    rec = await db.login_attempts.find_one({"username": username}) or {}
    count = int(rec.get("count", 0)) + 1
    update = {"count": count, "last_failed_at": now}
    if count >= sec["max_login_attempts"]:
        update["locked_until"] = now + timedelta(minutes=sec["lockout_minutes"])
        update["count"] = 0  # reset counter after locking
    await db.login_attempts.update_one(
        {"username": username},
        {"$set": update},
        upsert=True,
    )


async def _record_login_success(db, username: str) -> None:
    await db.login_attempts.delete_one({"username": username})


def build_router(db, deps: auth_mod.AuthDependencies, send_email_fn=None, frontend_base_url: str = "") -> APIRouter:
    router = APIRouter(prefix="/auth", tags=["auth"])

    @router.get("/bootstrap-status")
    async def bootstrap_status():
        count = await db.users.count_documents({})
        return {"needs_bootstrap": count == 0, "users_count": count}

    @router.post("/bootstrap")
    async def bootstrap_first_admin(body: BootstrapBody):
        existing_count = await db.users.count_documents({})
        if existing_count > 0:
            raise HTTPException(409, "Bootstrap non consentito: esistono già utenti nel sistema")
        username = _normalize_username(body.username)
        if not _USERNAME_RE.match(username):
            raise HTTPException(400, "Username non valido: lettere minuscole, numeri, . _ - (2-32 caratteri)")
        try:
            pw_hash = auth_mod.hash_password(body.password)
        except ValueError as e:
            raise HTTPException(400, str(e))
        doc = {
            "username": username,
            "first_name": body.first_name.strip(),
            "last_name": body.last_name.strip(),
            "password_hash": pw_hash,
            "role": auth_mod.ROLE_ADMIN,
            "active": True,
            "password_version": 1,
            "must_change_password": False,  # bootstrap admin sceglie subito la sua password
            "created_at": datetime.now(timezone.utc),
            "last_login": None,
        }
        res = await db.users.insert_one(doc)
        user = await db.users.find_one({"_id": res.inserted_id})
        sid = await auth_mod.create_session(db, str(user["_id"]), user["username"])
        token = auth_mod.create_access_token(
            user_id=str(user["_id"]),
            username=user["username"],
            role=user["role"],
            password_version=user["password_version"],
            sid=sid,
        )
        logger.info("Bootstrap admin created: username=%s", username)
        return {"token": token, "user": auth_mod.public_user(user)}

    @router.post("/login")
    async def login(body: LoginBody):
        username = _normalize_username(body.username)
        if not username or not body.password:
            raise HTTPException(400, "Username e password obbligatori")
        # Lockout check BEFORE any DB lookup (evita side-channel)
        await _check_lockout(db, username)
        user = await db.users.find_one({"username": username})
        if not user:
            await _record_login_failure(db, username)
            raise HTTPException(401, "Credenziali non valide")
        if not user.get("active", True):
            raise HTTPException(403, "Utente disattivato — contattare l'amministratore")
        if not auth_mod.verify_password(body.password, user.get("password_hash", "")):
            await _record_login_failure(db, username)
            raise HTTPException(401, "Credenziali non valide")
        await _record_login_success(db, username)
        await db.users.update_one(
            {"_id": user["_id"]},
            {"$set": {"last_login": datetime.now(timezone.utc)}},
        )
        user["last_login"] = datetime.now(timezone.utc)
        sid = await auth_mod.create_session(db, str(user["_id"]), user["username"])
        token = auth_mod.create_access_token(
            user_id=str(user["_id"]),
            username=user["username"],
            role=user["role"],
            password_version=int(user.get("password_version", 1)),
            remember=bool(body.remember_me),
            sid=sid,
        )
        return {
            "token": token,
            "user": auth_mod.public_user(user),
            "remember_me": bool(body.remember_me),
            "must_change_password": bool(user.get("must_change_password", False)),
        }

    @router.post("/logout")
    async def logout(current=Depends(deps.get_current_user)):
        """Elimina la sessione lato server (invalida il JWT corrente).
        Nota: non usa require_password_current perché anche un utente in stato
        must_change_password deve poter fare logout."""
        sid = current.get("_sid")
        if sid:
            await db.active_sessions.delete_one({"sid": sid})
        return {"ok": True}

    @router.get("/me")
    async def me(current=Depends(deps.get_current_user)):
        return auth_mod.public_user(current)

    @router.post("/change-my-password")
    async def change_my_password(body: ChangeMyPasswordBody, current=Depends(deps.get_current_user)):
        # Nota: usa get_current_user (NON require_password_current) perché
        # un utente con must_change_password=True DEVE poter usare questa rotta.
        if not auth_mod.verify_password(body.old_password, current.get("password_hash", "")):
            raise HTTPException(400, "Vecchia password errata")
        try:
            new_hash = auth_mod.hash_password(body.new_password)
        except ValueError as e:
            raise HTTPException(400, str(e))
        new_pv = int(current.get("password_version", 1)) + 1
        await db.users.update_one(
            {"_id": current["_id"]},
            {"$set": {
                "password_hash": new_hash,
                "password_version": new_pv,
                "must_change_password": False,
            }},
        )
        # Invalida TUTTE le sessioni esistenti (incluso quella corrente)
        await auth_mod.invalidate_all_sessions_for_user(db, str(current["_id"]))
        # Crea una nuova sessione per il device che ha appena cambiato password
        new_sid = await auth_mod.create_session(db, str(current["_id"]), current["username"])
        token = auth_mod.create_access_token(
            user_id=str(current["_id"]),
            username=current["username"],
            role=current["role"],
            password_version=new_pv,
            sid=new_sid,
        )
        return {"ok": True, "token": token}

    @router.post("/forgot-password")
    async def forgot_password(body: ForgotPasswordBody):
        """Flusso 'Password dimenticata' via email one-time token (1h)."""
        username = _normalize_username(body.username)
        user = await db.users.find_one({"username": username})
        generic = {
            "ok": True,
            "message": (
                "Se lo username corrisponde a un account con email registrata, "
                "riceverai a breve un'email con il link per reimpostare la password. "
                "Se non hai un'email registrata, contatta un altro amministratore "
                "che potrà resettare la password dalla sezione Admin → Gestione Utenti."
            ),
        }
        if not user or not user.get("active"):
            return generic
        email = (user.get("email") or "").strip().lower()
        if not email or not send_email_fn:
            return generic
        token = secrets.token_urlsafe(32)
        expires_at = datetime.now(timezone.utc) + timedelta(hours=1)
        await db.password_reset_tokens.insert_one({
            "token": token,
            "user_id": str(user["_id"]),
            "created_at": datetime.now(timezone.utc),
            "expires_at": expires_at,
            "used": False,
        })
        base = (frontend_base_url or "").rstrip("/")
        link = f"{base}/reset-password?token={token}"
        html = f"""
        <div style="font-family:system-ui,sans-serif;max-width:520px;margin:auto;padding:24px;color:#0f172a">
          <div style="text-align:center;margin-bottom:24px">
            <div style="display:inline-block;padding:6px 12px;background:#0f172a;color:#f59e0b;letter-spacing:0.3em;font-size:12px;font-weight:600">ELIOS TECH</div>
          </div>
          <h1 style="font-size:20px;font-weight:700;margin:0 0 12px">Reimposta la tua password</h1>
          <p style="color:#475569;font-size:14px;line-height:1.5">
            Ciao {user.get('first_name') or user.get('username')},<br/>
            hai richiesto di reimpostare la password del tuo account
            <code style="background:#f1f5f9;padding:2px 6px;border-radius:3px">@{user.get('username')}</code>.
          </p>
          <p style="text-align:center;margin:24px 0">
            <a href="{link}" style="display:inline-block;padding:12px 24px;background:#0f172a;color:#fff;text-decoration:none;border-radius:6px;font-weight:600">Reimposta password</a>
          </p>
          <p style="color:#64748b;font-size:12px">Il link è valido per <strong>1 ora</strong> e può essere usato una sola volta.
          Se non hai richiesto tu il reset, ignora questa email.</p>
          <hr style="border:none;border-top:1px solid #e2e8f0;margin:24px 0"/>
          <p style="color:#94a3b8;font-size:11px">Magazzino Elios Tech · Notion SSOT · bcrypt · JWT</p>
        </div>
        """
        try:
            await send_email_fn(email, "Reimposta la password di Magazzino Elios Tech", html)
            logger.info("password reset email sent to username=%s", username)
        except Exception as e:
            logger.warning("failed to send reset email for %s: %s", username, e)
        return generic

    @router.post("/reset-password")
    async def reset_password_token(body: ResetPasswordTokenBody):
        rec = await db.password_reset_tokens.find_one({"token": body.token})
        if not rec:
            raise HTTPException(400, "Token non valido")
        if rec.get("used"):
            raise HTTPException(400, "Token già utilizzato")
        expires = rec.get("expires_at")
        if isinstance(expires, datetime) and expires < datetime.now(timezone.utc):
            raise HTTPException(400, "Token scaduto")
        from bson import ObjectId
        try:
            uid = ObjectId(rec["user_id"])
        except Exception:
            raise HTTPException(400, "Token corrotto")
        user = await db.users.find_one({"_id": uid})
        if not user or not user.get("active"):
            raise HTTPException(400, "Utente non valido o disattivato")
        try:
            new_hash = auth_mod.hash_password(body.new_password)
        except ValueError as e:
            raise HTTPException(400, str(e))
        new_pv = int(user.get("password_version", 1)) + 1
        await db.users.update_one({"_id": uid}, {"$set": {
            "password_hash": new_hash,
            "password_version": new_pv,
            "must_change_password": False,
        }})
        await auth_mod.invalidate_all_sessions_for_user(db, str(uid))
        await db.password_reset_tokens.update_one({"token": body.token}, {"$set": {"used": True, "used_at": datetime.now(timezone.utc)}})
        await db.audit_logs.insert_one({
            "at": datetime.now(timezone.utc),
            "actor_id": None,
            "actor_username": user.get("username"),
            "action": "user.self_reset_password_via_token",
            "target_user_id": str(uid),
            "meta": {"via": "email_token"},
        })
        return {"ok": True, "invalidated_sessions": True}

    return router
