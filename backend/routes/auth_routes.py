"""Auth routes — login, me, bootstrap primo admin, cambio password personale.

Bootstrap flow (Prompt 220):
  - NON creare automaticamente admin/admin123.
  - GET /api/auth/bootstrap-status ritorna needs_bootstrap=True se db.users è vuoto.
  - POST /api/auth/bootstrap accetta il primo admin SOLO se nessun utente esiste.
    Idempotency: se un utente qualsiasi esiste già → 409 Conflict.
"""
from __future__ import annotations

import re
import logging
from datetime import datetime, timezone
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


def build_router(db, deps: auth_mod.AuthDependencies) -> APIRouter:
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
        """Flusso "Password dimenticata" ADMIN-ONLY (per il ruolo, non richiesto un token esistente).
        Non rivela mai se l'username esiste o meno per evitare enumeration.
        - Se lo username corrisponde a un ADMIN attivo → risposta informativa
          (nessuna infrastruttura email attualmente disponibile).
        - Altrimenti restituisce identica risposta generica.
        """
        username = _normalize_username(body.username)
        user = await db.users.find_one({"username": username})
        # Log solo lato server, mai nel body della risposta
        if user and user.get("active") and user.get("role") == auth_mod.ROLE_ADMIN:
            logger.info(
                "forgot-password requested for admin username=%s — invita un altro admin a effettuare il reset via Gestione Utenti",
                username,
            )
        # Risposta generica identica per evitare enumeration
        return {
            "ok": True,
            "message": (
                "Se lo username corrisponde a un account amministratore attivo, un altro amministratore "
                "può reimpostare la password dalla sezione Admin → Gestione Utenti. "
                "L'infrastruttura di recupero email non è ancora configurata."
            ),
        }

    return router
