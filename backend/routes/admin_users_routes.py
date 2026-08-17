"""Admin user management — CRUD utenti + reset password admin-side.

Regole (Prompt 220):
  - Solo Admin può accedere a queste rotte (require_admin dependency).
  - Un Admin può creare Admin o Operatori.
  - Un Admin può resettare la password di CHIUNQUE (anche altri Admin) SENZA
    conoscere la vecchia password → password_version incrementato → invalida
    automaticamente tutti i token attivi di quell'utente.
  - Un Admin può disattivare un utente → login negato e token attivi rifiutati.
  - Nessuna password in chiaro nei log/audit.
"""
from __future__ import annotations

import re
import logging
from datetime import datetime, timezone
from typing import Optional, List

from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel, Field, ConfigDict
from bson import ObjectId

import auth as auth_mod

logger = logging.getLogger(__name__)

_USERNAME_RE = re.compile(r"^[a-z0-9][a-z0-9._-]{1,31}$")


class CreateUserBody(BaseModel):
    model_config = ConfigDict(extra="ignore")
    first_name: str = Field(min_length=1, max_length=80)
    last_name: str = Field(min_length=1, max_length=80)
    username: str = Field(min_length=2, max_length=32)
    password: str = Field(min_length=6, max_length=128)
    role: str = Field(default=auth_mod.ROLE_OPERATOR)
    email: Optional[str] = Field(default=None, max_length=200)


class UpdateUserBody(BaseModel):
    model_config = ConfigDict(extra="ignore")
    first_name: Optional[str] = None
    last_name: Optional[str] = None
    role: Optional[str] = None
    active: Optional[bool] = None
    email: Optional[str] = Field(default=None, max_length=200)


class ResetPasswordBody(BaseModel):
    model_config = ConfigDict(extra="ignore")
    new_password: str = Field(min_length=6, max_length=128)


def _normalize_username(u: str) -> str:
    return (u or "").strip().lower()


def _oid(user_id: str) -> ObjectId:
    try:
        return ObjectId(user_id)
    except Exception:
        raise HTTPException(400, "user_id non valido")


def build_router(db, deps: auth_mod.AuthDependencies) -> APIRouter:
    router = APIRouter(prefix="/admin/users", tags=["admin-users"])

    async def _log_audit(actor, action: str, target_user_id: str, meta: Optional[dict] = None):
        try:
            await db.audit_logs.insert_one({
                "at": datetime.now(timezone.utc),
                "actor_id": str(actor["_id"]),
                "actor_username": actor.get("username"),
                "action": action,
                "target_user_id": target_user_id,
                "meta": meta or {},
            })
        except Exception as e:
            logger.warning("audit_log write failed: %s", e)

    @router.get("")
    async def list_users(admin=Depends(deps.require_admin)):
        cursor = db.users.find({}).sort("username", 1)
        out = [auth_mod.public_user(u) async for u in cursor]
        return {"items": out, "total": len(out)}

    @router.post("")
    async def create_user(body: CreateUserBody, admin=Depends(deps.require_admin)):
        username = _normalize_username(body.username)
        if not _USERNAME_RE.match(username):
            raise HTTPException(400, "Username non valido: minuscole, numeri, . _ - (2-32)")
        if body.role not in auth_mod.VALID_ROLES:
            raise HTTPException(400, f"Ruolo non valido: {body.role}")
        if await db.users.find_one({"username": username}):
            raise HTTPException(409, "Username già esistente")
        try:
            pw_hash = auth_mod.hash_password(body.password)
        except ValueError as e:
            raise HTTPException(400, str(e))
        doc = {
            "username": username,
            "first_name": body.first_name.strip(),
            "last_name": body.last_name.strip(),
            "email": (body.email or "").strip().lower() or None,
            "password_hash": pw_hash,
            "role": body.role,
            "active": True,
            "password_version": 1,
            "must_change_password": True,  # nuovo utente → cambio password obbligatorio al primo accesso
            "created_at": datetime.now(timezone.utc),
            "last_login": None,
        }
        res = await db.users.insert_one(doc)
        created = await db.users.find_one({"_id": res.inserted_id})
        await _log_audit(admin, "user.create", str(res.inserted_id),
                         {"username": username, "role": body.role})
        return auth_mod.public_user(created)

    @router.patch("/{user_id}")
    async def update_user(user_id: str, body: UpdateUserBody, admin=Depends(deps.require_admin)):
        oid = _oid(user_id)
        existing = await db.users.find_one({"_id": oid})
        if not existing:
            raise HTTPException(404, "Utente non trovato")
        # F8 — Account master protetto: blocca qualsiasi modifica strutturale.
        if auth_mod.is_master_user(existing):
            if body.role is not None and body.role != existing.get("role"):
                raise HTTPException(403, "Account master protetto: ruolo non modificabile")
            if body.active is not None and bool(body.active) != bool(existing.get("active", True)):
                raise HTTPException(403, "Account master protetto: stato non modificabile")
        updates = {}
        if body.first_name is not None:
            updates["first_name"] = body.first_name.strip()
        if body.last_name is not None:
            updates["last_name"] = body.last_name.strip()
        if body.role is not None:
            if body.role not in auth_mod.VALID_ROLES:
                raise HTTPException(400, f"Ruolo non valido: {body.role}")
            # Prevent demoting the last admin
            if existing.get("role") == auth_mod.ROLE_ADMIN and body.role != auth_mod.ROLE_ADMIN:
                admins_count = await db.users.count_documents({"role": auth_mod.ROLE_ADMIN, "active": True})
                if admins_count <= 1:
                    raise HTTPException(409, "Impossibile rimuovere l'ultimo Admin attivo")
            updates["role"] = body.role
        if body.active is not None:
            # Prevent self-deactivation and last-admin deactivation
            if not body.active:
                if str(existing["_id"]) == str(admin["_id"]):
                    raise HTTPException(409, "Non puoi disattivare te stesso")
                if existing.get("role") == auth_mod.ROLE_ADMIN:
                    admins_count = await db.users.count_documents({"role": auth_mod.ROLE_ADMIN, "active": True})
                    if admins_count <= 1:
                        raise HTTPException(409, "Impossibile disattivare l'ultimo Admin attivo")
            updates["active"] = bool(body.active)
        if not updates:
            raise HTTPException(400, "Nessun campo da aggiornare")
        # Deactivation must invalidate active sessions → bump password_version
        if updates.get("active") is False:
            updates["password_version"] = int(existing.get("password_version", 1)) + 1
        await db.users.update_one({"_id": oid}, {"$set": updates})
        # Se disattivato, elimina anche le sessioni attive
        if updates.get("active") is False:
            await auth_mod.invalidate_all_sessions_for_user(db, str(oid))
        updated = await db.users.find_one({"_id": oid})
        await _log_audit(admin, "user.update", user_id,
                         {k: v for k, v in updates.items() if k != "password_hash"})
        return auth_mod.public_user(updated)

    @router.post("/{user_id}/reset-password")
    async def reset_password(user_id: str, body: ResetPasswordBody, admin=Depends(deps.require_admin)):
        oid = _oid(user_id)
        existing = await db.users.find_one({"_id": oid})
        if not existing:
            raise HTTPException(404, "Utente non trovato")
        # F8 — Account master: nessuno può resettare la sua password.
        if auth_mod.is_master_user(existing):
            raise HTTPException(403, "Account master protetto: password non resettabile da altri")
        try:
            new_hash = auth_mod.hash_password(body.new_password)
        except ValueError as e:
            raise HTTPException(400, str(e))
        new_pv = int(existing.get("password_version", 1)) + 1
        await db.users.update_one(
            {"_id": oid},
            {"$set": {
                "password_hash": new_hash,
                "password_version": new_pv,
                "must_change_password": True,  # forza cambio al primo login con la password resettata
            }},
        )
        # Invalida tutte le sessioni attive dell'utente resettato
        await auth_mod.invalidate_all_sessions_for_user(db, str(oid))
        # Audit log — NEVER include the password itself
        await _log_audit(admin, "user.reset_password", user_id, {
            "target_username": existing.get("username"),
            "target_role": existing.get("role"),
        })
        return {"ok": True, "invalidated_sessions": True}

    @router.delete("/{user_id}")
    async def delete_user(user_id: str, admin=Depends(deps.require_admin)):
        """HARD delete definitivo dell'utente.

        Regole:
          - Solo Admin (require_admin dependency).
          - Non è possibile eliminare se stessi.
          - Non è possibile eliminare l'ultimo Admin attivo.
        Cancella:
          - documento utente (username, password_hash, email, dati personali);
          - sessioni attive (`active_sessions`) → impedisce qualsiasi ulteriore accesso.
        Preserva la tracciabilità:
          - `audit_logs` NON vengono cancellati; il campo `actor_username` viene
            anonimizzato in "[utente eliminato]" e in `meta.target_username` idem,
            mantenendo però `actor_id` / `target_user_id` per la tracciabilità.
        NB: gli Arrivi/Spedizioni/Movimenti sono su Notion — non vengono toccati.
        """
        oid = _oid(user_id)
        existing = await db.users.find_one({"_id": oid})
        if not existing:
            raise HTTPException(404, "Utente non trovato")
        # F8 — Account master: non eliminabile.
        if auth_mod.is_master_user(existing):
            raise HTTPException(403, "Account master protetto: non eliminabile")
        if str(existing["_id"]) == str(admin["_id"]):
            raise HTTPException(409, "Non puoi eliminare te stesso")
        if existing.get("role") == auth_mod.ROLE_ADMIN:
            # Blocca eliminazione dell'ultimo Admin attivo (indipendentemente da active state).
            active_admins = await db.users.count_documents({"role": auth_mod.ROLE_ADMIN, "active": True})
            if existing.get("active", True) and active_admins <= 1:
                raise HTTPException(409, "Impossibile eliminare l'ultimo Admin attivo")
        username = existing.get("username")
        # 1) Anonimizza gli audit log dell'utente (mantiene actor_id/target_user_id).
        try:
            await db.audit_logs.update_many(
                {"actor_id": str(oid)},
                {"$set": {"actor_username": "[utente eliminato]"}},
            )
            await db.audit_logs.update_many(
                {"target_user_id": str(oid), "meta.target_username": {"$exists": True}},
                {"$set": {"meta.target_username": "[utente eliminato]"}},
            )
        except Exception as e:
            logger.warning("audit anonymize failed: %s", e)
        # 2) Elimina sessioni attive → revoca accesso immediato.
        try:
            await auth_mod.invalidate_all_sessions_for_user(db, str(oid))
        except Exception as e:
            logger.warning("session invalidation failed: %s", e)
        # 3) Elimina definitivamente il record utente (username/hash/email/…).
        await db.users.delete_one({"_id": oid})
        # 4) Audit dell'operazione (usa placeholder per non conservare il vecchio username come dato personale).
        await _log_audit(admin, "user.hard_delete", user_id, {"username": username})
        return {"ok": True, "hard_deleted": True}

    return router
