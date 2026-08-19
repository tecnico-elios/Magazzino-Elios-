"""F14 — QR Code endpoints.

- GET  /api/qr/check?qr=XXX      → verifica se un QR è già associato
- GET  /api/qr/associations      → lista associazioni (admin/responsabile)
- POST /api/qr/detach             → rimuove associazione (retroattività — richiede permesso)

Regole:
- Un QR può essere associato ad un SOLO seriale (univocità globale, MongoDB).
- L'associazione avviene alla conferma della spedizione (server.py submit_checklist).
- La rimozione manuale è possibile solo da utenti con permesso `modifica_retroattiva`.
"""
from __future__ import annotations

import logging
from typing import Optional, Dict, Any, List
from fastapi import APIRouter, HTTPException, Depends, Query
from pydantic import BaseModel, ConfigDict

import auth as auth_mod

logger = logging.getLogger(__name__)


class QrDetachBody(BaseModel):
    model_config = ConfigDict(extra="ignore")
    qr_code: str
    reason: str


def build_router(db, deps) -> APIRouter:
    router = APIRouter(prefix="/qr", tags=["qr"])

    @router.get("/check")
    async def check_qr(qr: str = Query(..., min_length=1), current=Depends(deps.get_current_user)):
        """Verifica se un QR è già associato a un seriale. Ogni utente loggato può interrogare."""
        q = (qr or "").strip()
        if not q:
            raise HTTPException(400, "QR mancante")
        doc = await db.qr_associations.find_one({"qr_code_lower": q.lower(), "active": True})
        if not doc:
            return {"exists": False, "qr_code": q}
        return {
            "exists": True,
            "qr_code": doc.get("qr_code"),
            "serial": doc.get("serial"),
            "product_name": doc.get("product_name"),
            "structure": doc.get("structure"),
            "associated_at": doc.get("associated_at"),
            "associated_by": doc.get("associated_by"),
        }

    @router.get("/associations")
    async def list_associations(
        limit: int = Query(default=200, ge=1, le=2000),
        current=Depends(deps.get_current_user),
    ):
        """Elenco associazioni QR. Admin/Responsabile-con-permesso o master."""
        role = current.get("role")
        allowed = role == auth_mod.ROLE_ADMIN or auth_mod.is_master_user(current) or (
            role == auth_mod.ROLE_RESPONSABILE and auth_mod.has_permission(current, "modifica_retroattiva")
        )
        if not allowed:
            raise HTTPException(403, "Accesso non autorizzato")
        cursor = db.qr_associations.find({"active": True}).sort("associated_at", -1).limit(limit)
        out: List[Dict[str, Any]] = []
        async for d in cursor:
            d.pop("_id", None)
            out.append(d)
        return {"items": out, "count": len(out)}

    @router.post("/detach")
    async def detach_qr(body: QrDetachBody, current=Depends(deps.get_current_user)):
        """Rimuove un'associazione QR (retroattività). Serve permesso `modifica_retroattiva`."""
        if not auth_mod.has_permission(current, "modifica_retroattiva"):
            raise HTTPException(403, "Operazione retroattiva non autorizzata")
        q = (body.qr_code or "").strip()
        if not q or not (body.reason or "").strip():
            raise HTTPException(400, "QR code e motivazione obbligatori")
        doc = await db.qr_associations.find_one({"qr_code_lower": q.lower(), "active": True})
        if not doc:
            raise HTTPException(404, "QR non trovato")
        await db.qr_associations.update_one(
            {"_id": doc["_id"]},
            {"$set": {"active": False, "detached_reason": body.reason, "detached_by": current.get("username")}},
        )
        await db.audit_logs.insert_one({
            "at": __import__("datetime").datetime.now(__import__("datetime").timezone.utc).isoformat(),
            "actor_id": str(current.get("_id")),
            "actor_username": current.get("username"),
            "action": "qr.detach",
            "target": doc.get("qr_code"),
            "meta": {
                "serial": doc.get("serial"),
                "product": doc.get("product_name"),
                "structure": doc.get("structure"),
                "reason": body.reason,
            },
        })
        return {"ok": True}

    return router
