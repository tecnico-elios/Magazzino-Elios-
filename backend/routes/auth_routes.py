"""Auth routes — login, me, bootstrap primo admin, cambio password personale.

Bootstrap flow (Prompt 220):
  - NON creare automaticamente admin/admin123.
  - GET /api/auth/bootstrap-status ritorna needs_bootstrap=True se db.users è vuoto.
  - POST /api/auth/bootstrap accetta il primo admin SOLO se nessun utente esiste.
    Idempotency: se un utente qualsiasi esiste già → 409 Conflict.
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
            "created_at": datetime.now(timezone.utc),
            "last_login": None,
        }
        res = await db.users.insert_one(doc)
        user = await db.users.find_one({"_id": res.inserted_id})
        token = auth_mod.create_access_token(
            user_id=str(user["_id"]),
            username=user["username"],
            role=user["role"],
            password_version=user["password_version"],
        )
        logger.info("Bootstrap admin created: username=%s", username)
        return {"token": token, "user": auth_mod.public_user(user)}

    @router.post("/login")
    async def login(body: LoginBody):
        username = _normalize_username(body.username)
        if not username or not body.password:
            raise HTTPException(400, "Username e password obbligatori")
        user = await db.users.find_one({"username": username})
        # Deliberately generic message to avoid enumeration
        if not user:
            raise HTTPException(401, "Credenziali non valide")
        if not user.get("active", True):
            raise HTTPException(403, "Utente disattivato — contattare l'amministratore")
        if not auth_mod.verify_password(body.password, user.get("password_hash", "")):
            raise HTTPException(401, "Credenziali non valide")
        await db.users.update_one(
            {"_id": user["_id"]},
            {"$set": {"last_login": datetime.now(timezone.utc)}},
        )
        user["last_login"] = datetime.now(timezone.utc)
        token = auth_mod.create_access_token(
            user_id=str(user["_id"]),
            username=user["username"],
            role=user["role"],
            password_version=int(user.get("password_version", 1)),
            remember=bool(body.remember_me),
        )
        return {"token": token, "user": auth_mod.public_user(user), "remember_me": bool(body.remember_me)}

    @router.get("/me")
    async def me(current=Depends(deps.get_current_user)):
        return auth_mod.public_user(current)

    @router.post("/change-my-password")
    async def change_my_password(body: ChangeMyPasswordBody, current=Depends(deps.get_current_user)):
        if not auth_mod.verify_password(body.old_password, current.get("password_hash", "")):
            raise HTTPException(400, "Vecchia password errata")
        try:
            new_hash = auth_mod.hash_password(body.new_password)
        except ValueError as e:
            raise HTTPException(400, str(e))
        new_pv = int(current.get("password_version", 1)) + 1
        await db.users.update_one(
            {"_id": current["_id"]},
            {"$set": {"password_hash": new_hash, "password_version": new_pv}},
        )
        # Return a fresh token so the client stays logged in with the new pwv
        token = auth_mod.create_access_token(
            user_id=str(current["_id"]),
            username=current["username"],
            role=current["role"],
            password_version=new_pv,
        )
        return {"ok": True, "token": token}

    @router.post("/forgot-password")
    async def forgot_password(body: ForgotPasswordBody):
        """Flusso "Password dimenticata".
        - Se lo username corrisponde a un utente ATTIVO con email registrata → invia
          email con link one-time (token 1h, uso singolo). Il flusso è ammesso per
          qualsiasi ruolo, ma richiede che l'admin abbia inserito un'email valida.
        - Risposta generica identica in tutti i casi per prevenire enumeration.
        """
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
        # Generate one-time token
        token = secrets.token_urlsafe(32)
        expires_at = datetime.now(timezone.utc) + timedelta(hours=1)
        await db.password_reset_tokens.insert_one({
            "token": token,
            "user_id": str(user["_id"]),
            "created_at": datetime.now(timezone.utc),
            "expires_at": expires_at,
            "used": False,
        })
        # Build link
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
        await db.users.update_one({"_id": uid}, {"$set": {"password_hash": new_hash, "password_version": new_pv}})
        await db.password_reset_tokens.update_one({"token": body.token}, {"$set": {"used": True, "used_at": datetime.now(timezone.utc)}})
        # Audit log (NEVER include password)
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
