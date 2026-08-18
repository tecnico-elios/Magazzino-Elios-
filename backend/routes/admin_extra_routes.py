"""Admin P1 extra routes (Prompt 220) + F7 extensions.

Include:
  - Audit log
  - Anomalie delete/clear
  - Storico Seriali
  - Impostazioni estese (scanner/dashboard/magazzino/ricerca/movimenti/sicurezza)
  - Cleanup dati TEST_ (mai tocca Notion)
  - Ricerca globale
  - Sessioni attive: GET / DELETE (F7)

Tutte le rotte sono JWT-admin.
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


# ---------- Settings model (F7: sezioni annidate) ----------

class ScannerSettings(BaseModel):
    model_config = ConfigDict(extra="ignore")
    autofocus: Optional[bool] = None
    feedback_green_ms: Optional[int] = Field(default=None, ge=200, le=10000)
    feedback_red_ms: Optional[int] = Field(default=None, ge=200, le=10000)
    autoselect_single_result: Optional[bool] = None
    sound_enabled: Optional[bool] = None


class DashboardSettings(BaseModel):
    model_config = ConfigDict(extra="ignore")
    autorefresh_seconds: Optional[int] = Field(default=None, ge=0, le=3600)
    recent_movements_limit: Optional[int] = Field(default=None, ge=1, le=100)


class MagazzinoSettings(BaseModel):
    model_config = ConfigDict(extra="ignore")
    low_stock_threshold: Optional[int] = Field(default=None, ge=0, le=1000)
    warn_low_stock: Optional[bool] = None
    warn_out_of_stock: Optional[bool] = None


class RicercaSettings(BaseModel):
    model_config = ConfigDict(extra="ignore")
    search_on_type: Optional[bool] = None
    max_results: Optional[int] = Field(default=None, ge=1, le=200)
    partial_match: Optional[bool] = None


class MovimentiSettings(BaseModel):
    model_config = ConfigDict(extra="ignore")
    max_shown: Optional[int] = Field(default=None, ge=10, le=1000)
    auto_open_current_month: Optional[bool] = None


class SicurezzaSettings(BaseModel):
    model_config = ConfigDict(extra="ignore")
    session_ttl_minutes: Optional[int] = Field(default=None, ge=15, le=60 * 24 * 30)
    idle_logout_minutes: Optional[int] = Field(default=None, ge=1, le=1440)
    max_login_attempts: Optional[int] = Field(default=None, ge=3, le=20)
    lockout_minutes: Optional[int] = Field(default=None, ge=1, le=1440)


class ArriviSettings(BaseModel):
    """F10 §10 — Impostazioni Arrivi realmente configurabili.
    Le protezioni fondamentali (product_required_serial, verify_on_notion) sono
    accettate solo se True — non è possibile disattivarle."""
    model_config = ConfigDict(extra="ignore")
    allow_new_serials: Optional[bool] = None          # consenti seriali mai visti
    continuous_scan: Optional[bool] = None            # focus al prossimo campo dopo INVIO
    enter_equals_add: Optional[bool] = None           # INVIO = aggiungi (no bottone CERCA)
    final_confirmation: Optional[bool] = None         # richiedi dialog di conferma prima di scrivere
    require_code_for_qty: Optional[bool] = None       # codice obbligatorio per Ricevi Quantità
    require_quantity: Optional[bool] = None           # quantità obbligatoria


class SpedizioniSettings(BaseModel):
    """F10 §10 — Impostazioni Spedizioni realmente configurabili.
    Le protezioni fondamentali (verify_serial_in_inventory, block_duplicates,
    block_already_shipped, block_insufficient_qty) NON sono disattivabili."""
    model_config = ConfigDict(extra="ignore")
    continuous_scan: Optional[bool] = None            # focus al prossimo dopo scan/INVIO
    final_check: Optional[bool] = None                # ricontrollo completo prima di CONFERMA
    allow_partial_shipment: Optional[bool] = None     # permetti spedizioni parziali


# Lista IANA supportata (fusi principali internazionali). L'ora legale/solare è gestita
# automaticamente da ZoneInfo. Sono i tz mostrati nella UI Admin.
SUPPORTED_TIMEZONES = [
    "Europe/Rome", "Europe/London", "Europe/Paris", "Europe/Berlin",
    "Europe/Madrid", "Europe/Lisbon",
    "America/New_York", "America/Chicago", "America/Denver", "America/Los_Angeles",
    "Asia/Dubai", "Asia/Tokyo", "Australia/Sydney", "UTC",
]


class GeneralSettings(BaseModel):
    model_config = ConfigDict(extra="ignore")
    timezone: Optional[str] = Field(default=None, min_length=2, max_length=64)
    inventory_source: Optional[str] = Field(default=None, pattern="^(notion|gestionale)$")


class SettingsBody(BaseModel):
    model_config = ConfigDict(extra="ignore")
    # Retro-compat flat fields (usati dal frontend F6)
    low_stock_threshold: Optional[int] = Field(default=None, ge=0, le=1000)
    test_prefix: Optional[str] = Field(default=None, min_length=1, max_length=20)
    feedback_seconds: Optional[int] = Field(default=None, ge=1, le=30)
    # F7 nested sections
    scanner: Optional[ScannerSettings] = None
    dashboard: Optional[DashboardSettings] = None
    magazzino: Optional[MagazzinoSettings] = None
    ricerca: Optional[RicercaSettings] = None
    movimenti: Optional[MovimentiSettings] = None
    sicurezza: Optional[SicurezzaSettings] = None
    # F10 Arrivi/Spedizioni configurabili
    arrivi: Optional[ArriviSettings] = None
    spedizioni: Optional[SpedizioniSettings] = None
    # F8 general (timezone)
    general: Optional[GeneralSettings] = None


class CleanupConfirmBody(BaseModel):
    model_config = ConfigDict(extra="ignore")
    confirm: bool = False
    prefix: Optional[str] = None


# ---------- Default settings ----------

DEFAULT_SETTINGS: Dict[str, Any] = {
    # Retro-compat flat (usati da F6)
    "low_stock_threshold": 2,
    "test_prefix": "TEST_",
    "feedback_seconds": 3,
    # F7 nested
    "scanner": {
        "autofocus": True,
        "feedback_green_ms": 3000,
        "feedback_red_ms": 3000,
        "autoselect_single_result": True,
        "sound_enabled": False,
    },
    "dashboard": {
        "autorefresh_seconds": 0,          # 0 = disattivato
        "recent_movements_limit": 10,
    },
    "magazzino": {
        "low_stock_threshold": 2,
        "warn_low_stock": True,
        "warn_out_of_stock": True,
    },
    "ricerca": {
        "search_on_type": True,
        "max_results": 50,
        "partial_match": True,
    },
    "movimenti": {
        "max_shown": 200,
        "auto_open_current_month": True,
    },
    "sicurezza": {
        "session_ttl_minutes": 480,        # 8h default (allineato JWT_ACCESS_TTL_MINUTES)
        "idle_logout_minutes": 30,
        "max_login_attempts": 5,
        "lockout_minutes": 5,
    },
    "arrivi": {
        "allow_new_serials": True,
        "continuous_scan": True,
        "enter_equals_add": True,
        "final_confirmation": True,
        "require_code_for_qty": True,
        "require_quantity": True,
    },
    "spedizioni": {
        "continuous_scan": True,
        "final_check": True,
        "allow_partial_shipment": False,
    },
    "general": {
        "timezone": "Europe/Rome",         # IANA — gestisce auto ora legale/solare
        "inventory_source": "notion",       # 'notion' | 'gestionale' — switch fonte inventario
    },
}


def _merge_section(base: Dict[str, Any], override: Optional[Dict[str, Any]]) -> Dict[str, Any]:
    """Merge override sopra base, ignorando chiavi None."""
    out = dict(base)
    if isinstance(override, dict):
        for k, v in override.items():
            if v is not None:
                out[k] = v
    return out


async def get_app_settings(db) -> Dict[str, Any]:
    doc = await db.settings.find_one({"_id": "app_settings"}) or {}
    result: Dict[str, Any] = {
        # Retro-compat flat
        "low_stock_threshold": int(doc.get("low_stock_threshold", DEFAULT_SETTINGS["low_stock_threshold"])),
        "test_prefix": doc.get("test_prefix", DEFAULT_SETTINGS["test_prefix"]),
        "feedback_seconds": int(doc.get("feedback_seconds", DEFAULT_SETTINGS["feedback_seconds"])),
    }
    # Nested — merge default con quanto salvato
    for section in ("scanner", "dashboard", "magazzino", "ricerca", "movimenti", "sicurezza", "arrivi", "spedizioni", "general"):
        result[section] = _merge_section(DEFAULT_SETTINGS[section], doc.get(section))
    # Coerenza: mantieni magazzino.low_stock_threshold allineato al flat top-level
    result["magazzino"]["low_stock_threshold"] = result["low_stock_threshold"]
    return result


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
        sn_clean = (sn or "").strip()
        if not sn_clean:
            raise HTTPException(400, "SN obbligatorio")
        status = await notion_service.latest_serial_status(sn_clean)
        return {
            "sn": sn_clean,
            "status": status.get("status"),
            "last_entrata": status.get("receipt"),
            "last_uscita": status.get("exit"),
        }

    # ---------- Impostazioni (estese F7) ----------
    @router.get("/settings")
    async def get_settings_route():
        return await get_app_settings(db)

    @router.put("/settings")
    async def put_settings(body: SettingsBody, current_user=Depends(deps.require_admin)):
        updates: Dict[str, Any] = {}
        # Retro-compat flat
        if body.low_stock_threshold is not None:
            updates["low_stock_threshold"] = int(body.low_stock_threshold)
        if body.test_prefix is not None:
            tp = body.test_prefix.strip()
            if not tp:
                raise HTTPException(400, "test_prefix non può essere vuoto")
            updates["test_prefix"] = tp
        if body.feedback_seconds is not None:
            updates["feedback_seconds"] = int(body.feedback_seconds)
        # F7 nested — merge sezione per sezione
        for section_name, section_body in [
            ("scanner", body.scanner),
            ("dashboard", body.dashboard),
            ("magazzino", body.magazzino),
            ("ricerca", body.ricerca),
            ("movimenti", body.movimenti),
            ("sicurezza", body.sicurezza),
            ("general", body.general),
        ]:
            if section_body is None:
                continue
            section_dict = section_body.model_dump(exclude_none=True)
            if not section_dict:
                continue
            # F8: valida timezone IANA
            if section_name == "general" and "timezone" in section_dict:
                tz_name = section_dict["timezone"]
                try:
                    from zoneinfo import ZoneInfo
                    ZoneInfo(tz_name)
                except Exception:
                    raise HTTPException(400, f"Fuso orario non valido: {tz_name}")
            current_doc = await db.settings.find_one({"_id": "app_settings"}) or {}
            merged = _merge_section(current_doc.get(section_name) or DEFAULT_SETTINGS[section_name], section_dict)
            updates[section_name] = merged
        # Se magazzino.low_stock_threshold è stato aggiornato, propaga al flat
        if isinstance(updates.get("magazzino"), dict) and "low_stock_threshold" in updates["magazzino"]:
            updates["low_stock_threshold"] = int(updates["magazzino"]["low_stock_threshold"])
        if not updates:
            raise HTTPException(400, "Nessun campo da aggiornare")
        await db.settings.update_one({"_id": "app_settings"}, {"$set": updates}, upsert=True)
        # Audit — senza payload sensibili
        await db.audit_logs.insert_one({
            "at": datetime.now(timezone.utc),
            "actor_id": str(current_user["_id"]),
            "actor_username": current_user.get("username"),
            "action": "settings.update",
            "target_user_id": None,
            "meta": {"sections": list(updates.keys())},
        })
        return await get_app_settings(db)

    # ---------- Sessioni attive (F7) ----------
    def _to_utc(dt):
        if not isinstance(dt, datetime):
            return None
        return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)

    @router.get("/sessions")
    async def list_sessions():
        """Elenca tutte le sessioni attive. NON include informazioni sul dispositivo.

        Return: {items: [{sid, username, full_name, role, last_login, last_activity, online}]}
        online = last_activity nelle ultime 2 minuti.
        """
        settings = await get_app_settings(db)
        idle_min = int(settings["sicurezza"].get("idle_logout_minutes", 30))
        now = datetime.now(timezone.utc)
        cursor = db.active_sessions.find({}).sort("last_activity", -1)
        items = []
        users_by_id: Dict[str, Dict[str, Any]] = {}
        async for s in cursor:
            uid = s.get("user_id")
            user = users_by_id.get(uid)
            if user is None:
                from bson import ObjectId
                try:
                    user = await db.users.find_one({"_id": ObjectId(uid)}) or {}
                except Exception:
                    user = {}
                users_by_id[uid] = user
            la = _to_utc(s.get("last_activity"))
            ll = _to_utc(s.get("last_login"))
            online = False
            if la is not None:
                delta_min = (now - la).total_seconds() / 60.0
                online = delta_min < 2
                if delta_min > idle_min:
                    await db.active_sessions.delete_one({"sid": s.get("sid")})
                    continue
            items.append({
                "sid": s.get("sid"),
                "user_id": uid,
                "username": s.get("username") or user.get("username"),
                "full_name": f"{(user.get('first_name') or '').strip()} {(user.get('last_name') or '').strip()}".strip() or (user.get("username") or "—"),
                "email": user.get("email"),
                "role": user.get("role"),
                "last_login": ll.isoformat() if ll else None,
                "last_activity": la.isoformat() if la else None,
                "online": online,
            })
        return {"items": items, "count": len(items)}

    @router.delete("/sessions/{sid}")
    async def delete_session(sid: str, current_user=Depends(deps.require_admin)):
        # F8 — Account master: nessuno può forzare il logout delle sue sessioni.
        session = await db.active_sessions.find_one({"sid": sid})
        if session:
            user_id = session.get("user_id")
            if user_id:
                try:
                    from bson import ObjectId as _OID
                    user_doc = await db.users.find_one({"_id": _OID(user_id)})
                    if auth_mod.is_master_user(user_doc):
                        raise HTTPException(403, "Account master protetto: sessione non revocabile")
                except HTTPException:
                    raise
                except Exception:
                    pass
        res = await db.active_sessions.delete_one({"sid": sid})
        if res.deleted_count == 0:
            raise HTTPException(404, "Sessione non trovata")
        await db.audit_logs.insert_one({
            "at": datetime.now(timezone.utc),
            "actor_id": str(current_user["_id"]),
            "actor_username": current_user.get("username"),
            "action": "session.revoke",
            "target_user_id": None,
            "meta": {"sid": sid},
        })
        return {"ok": True}

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
        try:
            inv = await notion_service.list_inventory()
        except Exception:
            inv = []
        products = [it for it in inv if
                    q_lower in (it.get("name") or "").lower() or
                    q_lower in (it.get("code") or "").lower() or
                    q_lower in (it.get("category") or "").lower()][:25]
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

    # ---------- Sistema / Manutenzione (F9) ----------
    @router.post("/maintenance/refresh-cache")
    async def refresh_cache():
        """Svuota la cache Inventario e forza un reload da Notion.
        Non modifica dati né su Notion né in MongoDB.
        """
        try:
            notion_service.invalidate_inventory_cache()
            items = await notion_service.list_inventory(force_refresh=True)
            return {
                "ok": True,
                "items_count": len(items),
                "at": datetime.now(timezone.utc).isoformat(),
            }
        except Exception as e:
            logger.error("refresh-cache failed: %s", e)
            raise HTTPException(502, f"Errore rinfresco cache: {e}")

    @router.get("/maintenance/status")
    async def maintenance_status():
        """Stato integrazione Notion + cache. Read-only, safe."""
        try:
            configured = notion_service.is_configured()
            items = await notion_service.list_inventory() if configured else []
            return {
                "notion_configured": configured,
                "inventory_items": len(items),
                "checked_at": datetime.now(timezone.utc).isoformat(),
                "ok": configured,
            }
        except Exception as e:
            logger.warning("maintenance-status error: %s", e)
            return {
                "notion_configured": notion_service.is_configured(),
                "inventory_items": 0,
                "checked_at": datetime.now(timezone.utc).isoformat(),
                "ok": False,
                "error": str(e),
            }

    # ---------- Inventario Gestionale: prodotti locali (F8/§16) ----------
    import uuid as _uuid
    import inventory_local

    class ProductCreate(BaseModel):
        model_config = ConfigDict(extra="ignore")
        name: str = Field(min_length=1, max_length=200)
        code: str = Field(min_length=1, max_length=100)
        category: Optional[str] = None
        tipo_gestione: str = Field(pattern="^(a_seriale|a_quantita)$")
        quantity: Optional[float] = 0
        unit: Optional[str] = "pz"
        threshold: Optional[int] = 0
        notes: Optional[str] = None
        active: Optional[bool] = True

    class ProductUpdate(BaseModel):
        model_config = ConfigDict(extra="ignore")
        name: Optional[str] = Field(default=None, min_length=1, max_length=200)
        code: Optional[str] = Field(default=None, min_length=1, max_length=100)
        category: Optional[str] = None
        tipo_gestione: Optional[str] = Field(default=None, pattern="^(a_seriale|a_quantita)$")
        quantity: Optional[float] = None
        unit: Optional[str] = None
        threshold: Optional[int] = None
        notes: Optional[str] = None
        active: Optional[bool] = None

    class SerialInput(BaseModel):
        model_config = ConfigDict(extra="ignore")
        serial: str = Field(min_length=1, max_length=200)

    def _now_iso() -> str:
        return datetime.now(timezone.utc).isoformat()

    @router.get("/products")
    async def list_products():
        out: List[Dict[str, Any]] = []
        async for doc in db.products.find({}):
            doc.pop("_id", None)
            if doc.get("tipo_gestione") == "a_seriale":
                avail = await db.product_serials.count_documents({"product_id": doc["id"], "status": "available"})
                shipped = await db.product_serials.count_documents({"product_id": doc["id"], "status": "shipped"})
                doc["available"] = avail
                doc["shipped"] = shipped
            out.append(doc)
        out.sort(key=lambda p: (p.get("name") or "").lower())
        return {"items": out, "count": len(out)}

    @router.post("/products")
    async def create_product(body: ProductCreate, current_user=Depends(deps.require_admin)):
        exists = await db.products.find_one({"code": body.code})
        if exists:
            raise HTTPException(409, f"Codice '{body.code}' già in uso")
        doc = {
            "id": str(_uuid.uuid4()),
            "name": body.name,
            "code": body.code,
            "category": body.category,
            "tipo_gestione": body.tipo_gestione,
            "quantity": float(body.quantity or 0) if body.tipo_gestione == "a_quantita" else 0,
            "unit": body.unit or "pz",
            "threshold": int(body.threshold or 0),
            "notes": body.notes,
            "active": body.active if body.active is not None else True,
            "created_at": _now_iso(),
            "updated_at": _now_iso(),
        }
        await db.products.insert_one(doc)
        await db.audit_logs.insert_one({
            "at": datetime.now(timezone.utc),
            "actor_id": str(current_user["_id"]),
            "actor_username": current_user.get("username"),
            "action": "product.create",
            "meta": {"product_id": doc["id"], "code": doc["code"]},
        })
        doc.pop("_id", None)
        return doc

    @router.patch("/products/{product_id}")
    async def update_product(product_id: str, body: ProductUpdate, current_user=Depends(deps.require_admin)):
        updates = {k: v for k, v in body.model_dump(exclude_unset=True).items() if v is not None}
        if not updates:
            raise HTTPException(400, "Nessun campo da aggiornare")
        updates["updated_at"] = _now_iso()
        if "code" in updates:
            other = await db.products.find_one({"code": updates["code"], "id": {"$ne": product_id}})
            if other:
                raise HTTPException(409, f"Codice '{updates['code']}' già in uso")
        r = await db.products.update_one({"id": product_id}, {"$set": updates})
        if r.matched_count == 0:
            raise HTTPException(404, "Prodotto non trovato")
        await db.audit_logs.insert_one({
            "at": datetime.now(timezone.utc),
            "actor_id": str(current_user["_id"]),
            "actor_username": current_user.get("username"),
            "action": "product.update",
            "meta": {"product_id": product_id, "changes": list(updates.keys())},
        })
        doc = await db.products.find_one({"id": product_id})
        doc.pop("_id", None)
        return doc

    @router.delete("/products/{product_id}")
    async def delete_product(product_id: str, current_user=Depends(deps.require_admin)):
        r = await db.products.delete_one({"id": product_id})
        if r.deleted_count == 0:
            raise HTTPException(404, "Prodotto non trovato")
        await db.product_serials.delete_many({"product_id": product_id})
        await db.audit_logs.insert_one({
            "at": datetime.now(timezone.utc),
            "actor_id": str(current_user["_id"]),
            "actor_username": current_user.get("username"),
            "action": "product.delete",
            "meta": {"product_id": product_id},
        })
        return {"ok": True}

    @router.get("/products/{product_id}/serials")
    async def list_product_serials(product_id: str):
        prod = await db.products.find_one({"id": product_id})
        if not prod:
            raise HTTPException(404, "Prodotto non trovato")
        out: List[Dict[str, Any]] = []
        async for row in db.product_serials.find({"product_id": product_id}).sort("created_at", -1):
            row.pop("_id", None)
            out.append(row)
        return {"items": out, "count": len(out)}

    @router.post("/products/{product_id}/serials")
    async def add_product_serial(product_id: str, body: SerialInput, current_user=Depends(deps.require_admin)):
        prod = await db.products.find_one({"id": product_id})
        if not prod:
            raise HTTPException(404, "Prodotto non trovato")
        if prod.get("tipo_gestione") != "a_seriale":
            raise HTTPException(400, "Prodotto non a seriale")
        sn = body.serial.strip()
        exists = await db.product_serials.find_one({"serial_lower": sn.lower(), "product_id": product_id})
        if exists:
            raise HTTPException(409, f"Seriale '{sn}' già registrato")
        await db.product_serials.insert_one({
            "product_id": product_id,
            "serial": sn,
            "serial_lower": sn.lower(),
            "status": "available",
            "created_at": _now_iso(),
            "updated_at": _now_iso(),
        })
        return {"ok": True, "serial": sn}

    @router.delete("/products/{product_id}/serials/{serial}")
    async def delete_product_serial(product_id: str, serial: str, current_user=Depends(deps.require_admin)):
        r = await db.product_serials.delete_one({
            "product_id": product_id,
            "serial_lower": serial.strip().lower(),
        })
        if r.deleted_count == 0:
            raise HTTPException(404, "Seriale non trovato")
        return {"ok": True}

    # ---------- Fonte Inventario: switch + import da Notion (F8/§19-20) ----------
    class SourceSwitch(BaseModel):
        model_config = ConfigDict(extra="ignore")
        source: str = Field(pattern="^(notion|gestionale)$")
        confirm: bool = False

    @router.post("/inventory/source")
    async def switch_inventory_source(body: SourceSwitch, current_user=Depends(deps.require_admin)):
        """Cambio fonte inventario (Notion ↔ Gestionale). Richiede `confirm=true`."""
        if not body.confirm:
            raise HTTPException(400, "Conferma esplicita mancante (confirm=true)")
        # Aggiorna solo general.inventory_source, preserva timezone
        doc = await db.settings.find_one({"_id": "app_settings"}) or {}
        gen = doc.get("general") or {}
        gen["inventory_source"] = body.source
        await db.settings.update_one(
            {"_id": "app_settings"},
            {"$set": {"general": gen}},
            upsert=True,
        )
        # Invalida cache Notion se stiamo passando a gestionale (evita risultati stantii)
        try:
            notion_service.invalidate_inventory_cache()
        except Exception:
            pass
        await db.audit_logs.insert_one({
            "at": datetime.now(timezone.utc),
            "actor_id": str(current_user["_id"]),
            "actor_username": current_user.get("username"),
            "action": "inventory.source.switch",
            "meta": {"source": body.source},
        })
        return {"ok": True, "source": body.source}

    @router.post("/inventory/import-from-notion")
    async def import_from_notion(current_user=Depends(deps.require_admin)):
        """Importa prodotti+quantità+seriali da Notion nell'Inventario Gestionale locale.
        Non modifica Notion. I prodotti locali esistenti (stesso codice) NON vengono duplicati.
        """
        if not notion_service.is_configured():
            raise HTTPException(503, "Notion non configurato")
        try:
            notion_service.invalidate_inventory_cache()
            items = await notion_service.list_inventory(force_refresh=True)
        except Exception as e:
            raise HTTPException(502, f"Impossibile leggere Notion: {e}")
        created = 0
        updated = 0
        for it in items:
            code = (it.get("code") or "").strip()
            if not code:
                continue
            tipo = it.get("tipo_gestione")
            if tipo not in ("a_seriale", "a_quantita"):
                # Skip prodotti senza tipo gestione
                continue
            existing = await db.products.find_one({"code": code})
            payload = {
                "name": it.get("name") or code,
                "code": code,
                "category": it.get("category"),
                "tipo_gestione": tipo,
                "unit": it.get("unit") or "pz",
                "updated_at": _now_iso(),
            }
            if tipo == "a_quantita":
                payload["quantity"] = float(it.get("quantity") or 0)
            if existing:
                await db.products.update_one({"id": existing["id"]}, {"$set": payload})
                updated += 1
            else:
                payload["id"] = str(_uuid.uuid4())
                payload["created_at"] = _now_iso()
                payload["active"] = True
                payload["threshold"] = 0
                if tipo == "a_seriale":
                    payload["quantity"] = 0
                await db.products.insert_one(payload)
                created += 1
        await db.audit_logs.insert_one({
            "at": datetime.now(timezone.utc),
            "actor_id": str(current_user["_id"]),
            "actor_username": current_user.get("username"),
            "action": "inventory.import.notion",
            "meta": {"created": created, "updated": updated},
        })
        return {"ok": True, "created": created, "updated": updated, "total": created + updated}

    return router
