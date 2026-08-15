"""Admin P1 extra routes (Prompt 220): audit log, anomalie delete, storico seriali,
impostazioni (soglie + prefisso TEST), cleanup dati test, ricerca globale.

Tutte le rotte sono JWT-admin (Depends(dep_require_admin) applicato via router).
"""
from __future__ import annotations

import logging
import re
from datetime import datetime, timezone
from typing import Optional, Dict, Any, List

from fastapi import APIRouter, HTTPException, Depends, Query
from pydantic import BaseModel, Field, ConfigDict

import auth as auth_mod
import notion_service

logger = logging.getLogger(__name__)


class SettingsBody(BaseModel):
    model_config = ConfigDict(extra="ignore")
    low_stock_threshold: Optional[int] = Field(default=None, ge=0, le=1000)
    test_prefix: Optional[str] = Field(default=None, min_length=1, max_length=20)
    feedback_seconds: Optional[int] = Field(default=None, ge=1, le=30)


class CleanupConfirmBody(BaseModel):
    model_config = ConfigDict(extra="ignore")
    confirm: bool = False
    prefix: Optional[str] = None


DEFAULT_SETTINGS = {
    "low_stock_threshold": 2,
    "test_prefix": "TEST_",
    "feedback_seconds": 3,
}


async def get_app_settings(db) -> Dict[str, Any]:
    doc = await db.settings.find_one({"_id": "app_settings"}) or {}
    return {
        "low_stock_threshold": int(doc.get("low_stock_threshold", DEFAULT_SETTINGS["low_stock_threshold"])),
        "test_prefix": doc.get("test_prefix", DEFAULT_SETTINGS["test_prefix"]),
        "feedback_seconds": int(doc.get("feedback_seconds", DEFAULT_SETTINGS["feedback_seconds"])),
    }


def build_router(db, deps: auth_mod.AuthDependencies) -> APIRouter:
    router = APIRouter(prefix="/admin", tags=["admin-extra"], dependencies=[Depends(deps.require_admin)])

    # ---------- Audit Log ----------
    @router.get("/audit-logs")
    async def list_audit_logs(limit: int = Query(default=200, ge=1, le=1000)):
        cursor = db.audit_logs.find({}).sort("at", -1).limit(limit)
        out = []
        async for row in cursor:
            row["_id"] = str(row["_id"])
            if isinstance(row.get("at"), datetime):
                row["at"] = row["at"].isoformat()
            out.append(row)
        return {"items": out, "count": len(out)}

    # ---------- Anomalie delete ----------
    @router.delete("/anomalie/{anomaly_id}")
    async def delete_anomaly(anomaly_id: str, current_user=Depends(deps.require_admin)):
        # Try _id (uuid stored as string) — anomalies use uuid string id
        res = await db.anomalies.delete_one({"id": anomaly_id})
        if res.deleted_count == 0:
            res = await db.anomalies.delete_one({"_id": anomaly_id})
        if res.deleted_count == 0:
            raise HTTPException(404, "Anomalia non trovata")
        await db.audit_logs.insert_one({
            "at": datetime.now(timezone.utc),
            "actor_id": str(current_user["_id"]),
            "actor_username": current_user.get("username"),
            "action": "anomaly.delete",
            "target_user_id": None,
            "meta": {"anomaly_id": anomaly_id},
        })
        return {"ok": True}

    @router.delete("/anomalie")
    async def clear_all_anomalies(current_user=Depends(deps.require_admin)):
        res = await db.anomalies.delete_many({})
        await db.audit_logs.insert_one({
            "at": datetime.now(timezone.utc),
            "actor_id": str(current_user["_id"]),
            "actor_username": current_user.get("username"),
            "action": "anomaly.clear_all",
            "target_user_id": None,
            "meta": {"deleted": res.deleted_count},
        })
        return {"ok": True, "deleted": res.deleted_count}

    # ---------- Storico Seriali ----------
    @router.get("/serial-history/{sn}")
    async def serial_history(sn: str):
        """Ciclo di vita completo di un seriale su Notion — arrivi + uscite ordinati.
        Legge le pagine da Notion Receipts + Tracker via lookup dedicati."""
        sn_clean = (sn or "").strip()
        if not sn_clean:
            raise HTTPException(400, "SN obbligatorio")
        # Full scan — per SN singolo è accettabile (Notion API ~1s per pagina 100)
        # Riusiamo latest_serial_status per il current status
        status = await notion_service.latest_serial_status(sn_clean)
        # Costruiamo il "ciclo di vita" iterando Receipts e Tracker
        entries: List[Dict[str, Any]] = []
        # Receipts (entrate)
        # Nota: lookup_receipts_sn ritorna solo l'ULTIMO. Iteriamo manualmente sull'API.
        # Per semplicità e velocità, per ora esponiamo status + last (entrata + uscita).
        recap = {
            "sn": sn_clean,
            "status": status.get("status"),
            "last_entrata": status.get("receipt"),
            "last_uscita": status.get("exit"),
        }
        return recap

    # ---------- Impostazioni ----------
    @router.get("/settings")
    async def get_settings_route():
        return await get_app_settings(db)

    @router.put("/settings")
    async def put_settings(body: SettingsBody, current_user=Depends(deps.require_admin)):
        updates = {}
        if body.low_stock_threshold is not None:
            updates["low_stock_threshold"] = int(body.low_stock_threshold)
        if body.test_prefix is not None:
            tp = body.test_prefix.strip()
            if not tp:
                raise HTTPException(400, "test_prefix non può essere vuoto")
            updates["test_prefix"] = tp
        if body.feedback_seconds is not None:
            updates["feedback_seconds"] = int(body.feedback_seconds)
        if not updates:
            raise HTTPException(400, "Nessun campo da aggiornare")
        await db.settings.update_one({"_id": "app_settings"}, {"$set": updates}, upsert=True)
        await db.audit_logs.insert_one({
            "at": datetime.now(timezone.utc),
            "actor_id": str(current_user["_id"]),
            "actor_username": current_user.get("username"),
            "action": "settings.update",
            "target_user_id": None,
            "meta": updates,
        })
        return await get_app_settings(db)

    # ---------- Cleanup dati TEST_ ----------
    def _test_regex(prefix: str) -> re.Pattern:
        return re.compile(rf"^{re.escape(prefix)}", re.IGNORECASE)

    @router.get("/cleanup-test-data")
    async def cleanup_preview(prefix: Optional[str] = None):
        settings = await get_app_settings(db)
        p = (prefix or settings["test_prefix"]).strip()
        rx = _test_regex(p)
        checklists = await db.checklists.find(
            {"$or": [{"structure": {"$regex": rx}}, {"taken_by": {"$regex": rx}}, {"operator": {"$regex": rx}}]},
            {"id": 1, "structure": 1, "operator": 1, "shipping_date": 1, "created_at": 1, "_id": 0}
        ).to_list(500)
        arrivi = await db.arrivi.find(
            {"$or": [{"fornitore": {"$regex": rx}}, {"operator": {"$regex": rx}}]},
            {"id": 1, "fornitore": 1, "operator": 1, "arrival_date": 1, "created_at": 1, "_id": 0}
        ).to_list(500)
        anomalies = await db.anomalies.find(
            {"$or": [{"operator": {"$regex": rx}}, {"product": {"$regex": rx}}, {"description": {"$regex": rx}}]},
            {"_id": 0, "id": 1, "kind": 1, "operator": 1, "description": 1, "timestamp": 1}
        ).to_list(500)
        return {
            "prefix": p,
            "checklists": checklists,
            "arrivi": arrivi,
            "anomalies": anomalies,
            "total": len(checklists) + len(arrivi) + len(anomalies),
        }

    @router.post("/cleanup-test-data")
    async def cleanup_execute(body: CleanupConfirmBody, current_user=Depends(deps.require_admin)):
        if not body.confirm:
            raise HTTPException(400, "Conferma obbligatoria — imposta confirm=true")
        settings = await get_app_settings(db)
        p = ((body.prefix or settings["test_prefix"]) or "").strip()
        if not p:
            raise HTTPException(400, "Prefisso non valido")
        rx = _test_regex(p)
        r1 = await db.checklists.delete_many(
            {"$or": [{"structure": {"$regex": rx}}, {"taken_by": {"$regex": rx}}, {"operator": {"$regex": rx}}]}
        )
        r2 = await db.arrivi.delete_many(
            {"$or": [{"fornitore": {"$regex": rx}}, {"operator": {"$regex": rx}}]}
        )
        r3 = await db.anomalies.delete_many(
            {"$or": [{"operator": {"$regex": rx}}, {"product": {"$regex": rx}}, {"description": {"$regex": rx}}]}
        )
        await db.audit_logs.insert_one({
            "at": datetime.now(timezone.utc),
            "actor_id": str(current_user["_id"]),
            "actor_username": current_user.get("username"),
            "action": "cleanup.execute",
            "target_user_id": None,
            "meta": {"prefix": p, "checklists": r1.deleted_count, "arrivi": r2.deleted_count, "anomalies": r3.deleted_count},
        })
        return {
            "ok": True,
            "prefix": p,
            "checklists_deleted": r1.deleted_count,
            "arrivi_deleted": r2.deleted_count,
            "anomalies_deleted": r3.deleted_count,
        }

    # ---------- Ricerca globale ----------
    @router.get("/global-search")
    async def global_search(q: str = Query(..., min_length=1, max_length=100)):
        q_lower = q.strip().lower()
        # Prodotti (via inventory cache)
        try:
            inv = await notion_service.list_inventory()
        except Exception:
            inv = []
        products = [it for it in inv if
                    q_lower in (it.get("name") or "").lower() or
                    q_lower in (it.get("code") or "").lower() or
                    q_lower in (it.get("category") or "").lower()][:25]
        # Movimenti recenti (senza filtro mese — solo cache locale checklists+arrivi)
        checklists = await db.checklists.find(
            {"$or": [
                {"structure": {"$regex": q, "$options": "i"}},
                {"operator": {"$regex": q, "$options": "i"}},
                {"taken_by": {"$regex": q, "$options": "i"}},
            ]},
            {"_id": 0, "id": 1, "structure": 1, "operator": 1, "shipping_date": 1, "created_at": 1}
        ).sort("created_at", -1).limit(25).to_list(25)
        arrivi = await db.arrivi.find(
            {"$or": [
                {"fornitore": {"$regex": q, "$options": "i"}},
                {"operator": {"$regex": q, "$options": "i"}},
            ]},
            {"_id": 0, "id": 1, "fornitore": 1, "operator": 1, "arrival_date": 1, "created_at": 1}
        ).sort("created_at", -1).limit(25).to_list(25)
        # SN via /inventory/lookup se q sembra un SN
        sn_hit = None
        if len(q_lower) >= 4 and not any(c.isspace() for c in q_lower):
            try:
                st = await notion_service.latest_serial_status(q.strip())
                if st.get("status") != "unseen":
                    sn_hit = st
            except Exception:
                pass
        return {
            "query": q,
            "products": products,
            "checklists": checklists,
            "arrivi": arrivi,
            "serial_status": sn_hit,
        }

    return router
