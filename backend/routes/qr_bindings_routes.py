"""F30 (14/09/2026) — QR multi-slot bindings.

Modello generico: un seriale può avere N QR, uno per "slot" (single/right/left/...).
La configurazione degli slot per prodotto vive in `product_qr_config`.
Solo i prodotti con `enabled=True` mostreranno il prompt di associazione.

Collezioni:
- `product_qr_config` — { product_page_id (PK), product_code, product_name,
                           slots: [str], enabled: bool, updated_at, updated_by }
- `qr_bindings`       — { id, serial, serial_lower, slot, qr_code, qr_code_lower,
                           product_page_id, product_name, active,
                           created_at, created_by, structure?, order_page_id? }

Indici:
- qr_bindings.qr_code_lower unique (partial: active=True)
- qr_bindings (serial_lower, slot) unique (partial: active=True)
"""
from __future__ import annotations

import uuid
import logging
from datetime import datetime, timezone
from typing import Optional, List, Dict, Any

from fastapi import APIRouter, HTTPException, Depends, Query
from pydantic import BaseModel, ConfigDict, Field

import auth as auth_mod

logger = logging.getLogger(__name__)

VALID_SLOT_RE = r"^[a-z0-9_-]{1,32}$"


class ProductQrConfigBody(BaseModel):
    model_config = ConfigDict(extra="ignore")
    enabled: bool = True
    slots: List[str] = Field(default_factory=lambda: ["single"])
    product_code: Optional[str] = None
    product_name: Optional[str] = None


class QrBindingCreate(BaseModel):
    model_config = ConfigDict(extra="ignore")
    serial: str = Field(min_length=1)
    slot: str = Field(min_length=1, max_length=32)
    qr_code: str = Field(min_length=1)
    product_page_id: Optional[str] = None
    product_name: Optional[str] = None


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _normalize_qr(raw: str) -> str:
    """Normalizzazione centralizzata backend — allineata a frontend/src/lib/qr.js:normalizeQrCode.
    Accetta URL 'https://qr.eliostech.it/webapp?qrCodeId=QRCODE_1119' → 'QRCODE_1119'.
    """
    if not raw:
        return ""
    s = str(raw).strip()
    if not s:
        return ""
    # Se contiene qrCodeId= → estrai il valore
    lo = s.lower()
    key = "qrcodeid="
    idx = lo.find(key)
    if idx >= 0:
        rest = s[idx + len(key):]
        # Termina alla prima & o whitespace
        for sep in ("&", " ", "#"):
            if sep in rest:
                rest = rest.split(sep, 1)[0]
        return rest.strip()
    return s


def build_router(db, deps) -> APIRouter:
    router = APIRouter(prefix="/qr", tags=["qr-bindings"])

    # ---------- Product QR Config ----------

    @router.get("/product-config/{page_id}")
    async def get_product_config(page_id: str, current=Depends(deps.get_current_user)):
        """Ritorna la configurazione QR di un prodotto (o default disabled)."""
        cfg = await db.product_qr_config.find_one({"product_page_id": page_id})
        if not cfg:
            return {"product_page_id": page_id, "enabled": False, "slots": []}
        cfg.pop("_id", None)
        return cfg

    @router.get("/product-configs")
    async def list_product_configs(current=Depends(deps.get_current_user)):
        """Lista tutte le configurazioni QR (per admin UI)."""
        out: List[Dict[str, Any]] = []
        async for d in db.product_qr_config.find({}).sort("product_name", 1):
            d.pop("_id", None); out.append(d)
        return {"items": out, "count": len(out)}

    @router.put("/product-config/{page_id}")
    async def put_product_config(page_id: str, body: ProductQrConfigBody,
                                  current=Depends(deps.require_admin)):
        """Configura gli slot QR per un prodotto (SOLO Admin)."""
        # Validazione slot
        import re
        slots = [s.strip().lower() for s in (body.slots or []) if s and s.strip()]
        for s in slots:
            if not re.match(VALID_SLOT_RE, s):
                raise HTTPException(400, f"Slot '{s}' non valido (usa a-z, 0-9, _, -, max 32)")
        if len(set(slots)) != len(slots):
            raise HTTPException(400, "Slot duplicati non ammessi")
        if body.enabled and not slots:
            raise HTTPException(400, "Con enabled=True devi indicare almeno uno slot")
        doc = {
            "product_page_id": page_id,
            "product_code": (body.product_code or "").strip() or None,
            "product_name": (body.product_name or "").strip() or None,
            "enabled": bool(body.enabled),
            "slots": slots,
            "updated_at": _now_iso(),
            "updated_by": current.get("username"),
        }
        await db.product_qr_config.update_one(
            {"product_page_id": page_id}, {"$set": doc}, upsert=True,
        )
        await db.audit_logs.insert_one({
            "at": _now_iso(),
            "actor_username": current.get("username"),
            "action": "qr.product_config.set",
            "target": page_id,
            "meta": {"enabled": body.enabled, "slots": slots, "product_name": body.product_name},
        })
        return {"ok": True, "config": doc}

    # ---------- QR Bindings ----------

    @router.get("/bindings")
    async def bindings_for_serial(sn: str = Query(..., min_length=1),
                                    current=Depends(deps.get_current_user)):
        """Ritorna la lista degli slot con QR associati per un seriale."""
        s = sn.strip()
        cursor = db.qr_bindings.find({"serial_lower": s.lower(), "active": True})
        items: List[Dict[str, Any]] = []
        async for d in cursor:
            d.pop("_id", None); items.append(d)
        return {"serial": s, "items": items, "count": len(items)}

    @router.post("/bindings")
    async def create_binding(body: QrBindingCreate, current=Depends(deps.get_current_user)):
        """Crea un binding QR ↔ (serial, slot). Rifiuta se QR o slot già utilizzati."""
        serial = body.serial.strip()
        slot = body.slot.strip().lower()
        qr_raw = body.qr_code.strip()
        qr = _normalize_qr(qr_raw)
        if not serial or not slot or not qr:
            raise HTTPException(400, "serial, slot e qr_code sono obbligatori")
        # Config del prodotto: se disponibile, valida che lo slot sia ammesso
        if body.product_page_id:
            cfg = await db.product_qr_config.find_one({"product_page_id": body.product_page_id})
            if cfg and cfg.get("enabled") and slot not in (cfg.get("slots") or []):
                raise HTTPException(400, f"Slot '{slot}' non ammesso per questo prodotto (ammessi: {', '.join(cfg.get('slots') or [])})")
        # Unicità globale QR
        conflict_qr = await db.qr_bindings.find_one({"qr_code_lower": qr.lower(), "active": True})
        if conflict_qr:
            raise HTTPException(409, {
                "message": f"QR '{qr}' già associato",
                "conflict": {
                    "serial": conflict_qr.get("serial"),
                    "slot": conflict_qr.get("slot"),
                    "product_name": conflict_qr.get("product_name"),
                },
            })
        # Unicità (serial, slot)
        conflict_slot = await db.qr_bindings.find_one({
            "serial_lower": serial.lower(), "slot": slot, "active": True,
        })
        if conflict_slot:
            raise HTTPException(409, f"Slot '{slot}' già associato per il seriale '{serial}' (QR: {conflict_slot.get('qr_code')})")
        doc = {
            "id": str(uuid.uuid4()),
            "serial": serial,
            "serial_lower": serial.lower(),
            "slot": slot,
            "qr_code": qr,
            "qr_code_lower": qr.lower(),
            "product_page_id": (body.product_page_id or "").strip() or None,
            "product_name": (body.product_name or "").strip() or None,
            "active": True,
            "created_at": _now_iso(),
            "created_by": current.get("username"),
        }
        await db.qr_bindings.insert_one(doc)
        # Log audit
        await db.audit_logs.insert_one({
            "at": _now_iso(),
            "actor_username": current.get("username"),
            "action": "qr.binding.create",
            "target": qr,
            "meta": {"serial": serial, "slot": slot, "product_name": body.product_name},
        })
        doc.pop("_id", None)
        return {"ok": True, "binding": doc}

    @router.delete("/bindings/{binding_id}")
    async def delete_binding(binding_id: str, reason: Optional[str] = Query(None),
                              current=Depends(deps.get_current_user)):
        """Disattiva un binding (Admin o Responsabile con permesso `modifica_retroattiva`)."""
        if not (current.get("role") == auth_mod.ROLE_ADMIN
                or auth_mod.is_master_user(current)
                or auth_mod.has_permission(current, "modifica_retroattiva")):
            raise HTTPException(403, "Operazione retroattiva non autorizzata")
        doc = await db.qr_bindings.find_one({"id": binding_id, "active": True})
        if not doc:
            raise HTTPException(404, "Binding non trovato")
        await db.qr_bindings.update_one(
            {"_id": doc["_id"]},
            {"$set": {"active": False, "detached_reason": reason,
                      "detached_by": current.get("username"),
                      "detached_at": _now_iso()}},
        )
        await db.audit_logs.insert_one({
            "at": _now_iso(),
            "actor_username": current.get("username"),
            "action": "qr.binding.detach",
            "target": doc.get("qr_code"),
            "meta": {"serial": doc.get("serial"), "slot": doc.get("slot"), "reason": reason},
        })
        return {"ok": True}

    @router.get("/check-multi")
    async def check_qr_multi(qr: str = Query(..., min_length=1),
                              current=Depends(deps.get_current_user)):
        """Verifica se un QR è già utilizzato in qr_bindings (nuovo modello multi-slot)."""
        q = _normalize_qr(qr).strip()
        if not q:
            raise HTTPException(400, "QR mancante o non valido")
        doc = await db.qr_bindings.find_one({"qr_code_lower": q.lower(), "active": True})
        if not doc:
            return {"exists": False, "qr_code": q}
        return {
            "exists": True,
            "qr_code": doc.get("qr_code"),
            "serial": doc.get("serial"),
            "slot": doc.get("slot"),
            "product_name": doc.get("product_name"),
            "created_at": doc.get("created_at"),
            "created_by": doc.get("created_by"),
        }

    return router


async def seed_default_configs(db) -> None:
    """Seed una tantum delle config QR di default (idempotente).
    Attualmente: Daze Duo (product_code=OS01IT64TCP) → slots=["right","left"]."""
    try:
        # Trova il product_page_id via inventario Notion (se disponibile)
        # In alternativa, usiamo il product_code come chiave di ricerca in commesse esistenti.
        default_seeds = [
            {"product_code": "OS01IT64TCP", "product_name": "Daze duo trifase 22 kw+ 22 64A",
             "slots": ["right", "left"], "enabled": True},
        ]
        for seed in default_seeds:
            # Cerca un page_id tramite le commesse esistenti (rileva l'ID Notion reale)
            sample = await db.commesse.find_one({"righe.product_code": seed["product_code"]})
            page_id = None
            if sample:
                for r in sample.get("righe") or []:
                    if r.get("product_code") == seed["product_code"]:
                        page_id = r.get("product_page_id"); break
            if not page_id:
                # Nessuna commessa lo referenzia ancora → salta (verrà creato al primo uso via admin UI)
                continue
            existing = await db.product_qr_config.find_one({"product_page_id": page_id})
            if existing:
                continue  # Non sovrascrive: rispetta modifiche admin
            await db.product_qr_config.insert_one({
                "product_page_id": page_id,
                "product_code": seed["product_code"],
                "product_name": seed["product_name"],
                "enabled": seed["enabled"],
                "slots": seed["slots"],
                "updated_at": _now_iso(),
                "updated_by": "system_seed",
            })
            logger.info(f"[qr_bindings] Seed default config: {seed['product_name']} → {seed['slots']}")
    except Exception as e:
        logger.warning(f"[qr_bindings] seed_default_configs failed: {e}")


async def ensure_indexes(db) -> None:
    """Crea gli indici richiesti dal modello. Idempotente."""
    try:
        # Unicità QR globale (solo attivi) — partial index
        await db.qr_bindings.create_index(
            "qr_code_lower", unique=True,
            partialFilterExpression={"active": True},
        )
        # Unicità (serial, slot) — partial index
        await db.qr_bindings.create_index(
            [("serial_lower", 1), ("slot", 1)], unique=True,
            partialFilterExpression={"active": True},
        )
        # Ricerca per seriale
        await db.qr_bindings.create_index("serial_lower")
        # Ricerca config
        await db.product_qr_config.create_index("product_page_id", unique=True)
    except Exception as e:
        logger.warning(f"[qr_bindings] ensure_indexes: {e}")
