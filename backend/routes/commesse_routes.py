"""F23 (26/02/2026) — Gestione Commesse.
Storage: MongoDB (workflow interno). Inventario/Spedizioni restano su Notion SSOT.
Non duplica lo stock: il prelievo registra solo cosa è stato preso; la spedizione
finale chiama /api/checklist/send che scala l'inventario Notion esistente.
"""
from __future__ import annotations
import os
import uuid
import logging
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

import httpx
from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import BaseModel, ConfigDict, Field

import auth as auth_mod
import event_logger

logger = logging.getLogger(__name__)

STATI = ("da_preparare", "in_preparazione", "parziale", "pronta", "spedita", "annullata")
PRIORITA = ("urgente", "alta", "normale", "bassa")


class RigaBody(BaseModel):
    model_config = ConfigDict(extra="ignore")
    product_page_id: str
    product_name: str
    product_code: Optional[str] = None
    tipo_gestione: str  # a_seriale | a_quantita
    qty_richiesta: float = Field(gt=0)


class CommessaCreate(BaseModel):
    model_config = ConfigDict(extra="ignore")
    number: str = Field(min_length=1, max_length=50)
    cliente: str = Field(min_length=1, max_length=200)
    data_ordine: Optional[str] = None
    data_prevista: Optional[str] = None
    priorita: str = "normale"
    note: Optional[str] = None
    righe: List[RigaBody] = Field(min_length=1)


class CommessaUpdate(BaseModel):
    model_config = ConfigDict(extra="ignore")
    cliente: Optional[str] = None
    data_ordine: Optional[str] = None
    data_prevista: Optional[str] = None
    priorita: Optional[str] = None
    note: Optional[str] = None
    righe: Optional[List[RigaBody]] = None


class PickBody(BaseModel):
    model_config = ConfigDict(extra="ignore")
    riga_index: int
    quantity: Optional[float] = None
    serial: Optional[str] = None


def _now():
    return datetime.now(timezone.utc)


def _serialize(doc: Dict[str, Any]) -> Dict[str, Any]:
    d = {**doc}
    d.pop("_id", None)
    for k in ("created_at", "updated_at", "presa_in_carico_at", "completed_at", "shipped_at", "cancelled_at"):
        if isinstance(d.get(k), datetime):
            d[k] = d[k].isoformat()
    return d


def _compute_stato(doc: Dict[str, Any]) -> str:
    """Ricalcola stato in base ai prelievi delle righe (esclude spedita/annullata)."""
    if doc.get("stato") in ("spedita", "annullata"):
        return doc["stato"]
    if not doc.get("operatore_carico"):
        return "da_preparare"
    righe = doc.get("righe") or []
    totals = 0
    prelevati = 0
    for r in righe:
        totals += float(r.get("qty_richiesta") or 0)
        prelevati += float(r.get("qty_prelevata") or 0)
    if totals > 0 and prelevati >= totals:
        return "pronta"
    if prelevati > 0:
        return "parziale"
    return "in_preparazione"


async def _get_feature(db) -> bool:
    doc = await db.settings.find_one({"_id": "features"}) or {}
    return bool(doc.get("commesse_enabled", False))


def build_router(db, deps: auth_mod.AuthDependencies) -> APIRouter:
    router = APIRouter(prefix="/commesse", tags=["commesse"], dependencies=[Depends(deps.get_current_user)])

    async def _require_enabled():
        if not await _get_feature(db):
            raise HTTPException(403, "Gestione Commesse disabilitata")

    @router.get("")
    async def list_commesse(
        stato: Optional[str] = Query(None),
        priorita: Optional[str] = Query(None),
        cliente: Optional[str] = Query(None),
        limit: int = Query(100, ge=1, le=500),
    ):
        await _require_enabled()
        q: Dict[str, Any] = {}
        if stato: q["stato"] = stato
        if priorita: q["priorita"] = priorita
        if cliente: q["cliente"] = {"$regex": cliente, "$options": "i"}
        cursor = db.commesse.find(q).sort([("priorita", 1), ("data_prevista", 1), ("created_at", -1)]).limit(limit)
        # Ordine priorità: urgente, alta, normale, bassa
        priority_rank = {"urgente": 0, "alta": 1, "normale": 2, "bassa": 3}
        items = []
        async for d in cursor:
            items.append(_serialize(d))
        items.sort(key=lambda x: (priority_rank.get(x.get("priorita", "normale"), 2), x.get("data_prevista") or "9999", x.get("created_at") or ""))
        # KPI
        kpi = {s: await db.commesse.count_documents({"stato": s}) for s in STATI}
        return {"items": items, "kpi": kpi}

    @router.get("/kpi")
    async def kpi():
        await _require_enabled()
        return {s: await db.commesse.count_documents({"stato": s}) for s in STATI}

    @router.get("/{cid}")
    async def get_commessa(cid: str):
        await _require_enabled()
        doc = await db.commesse.find_one({"id": cid})
        if not doc: raise HTTPException(404, "Commessa non trovata")
        return _serialize(doc)

    @router.post("")
    async def create_commessa(body: CommessaCreate, current=Depends(deps.get_current_user)):
        await _require_enabled()
        if body.priorita not in PRIORITA:
            raise HTTPException(400, "Priorità non valida")
        exists = await db.commesse.find_one({"number": body.number, "stato": {"$ne": "annullata"}})
        if exists:
            raise HTTPException(409, f"Numero commessa '{body.number}' già in uso")
        op_id = event_logger.new_operation_id("CMM")
        doc = {
            "id": str(uuid.uuid4()),
            "number": body.number.strip(),
            "cliente": body.cliente.strip(),
            "data_ordine": body.data_ordine,
            "data_prevista": body.data_prevista,
            "priorita": body.priorita,
            "note": body.note,
            "stato": "da_preparare",
            "righe": [{**r.model_dump(), "qty_prelevata": 0.0, "seriali_prelevati": []} for r in body.righe],
            "operatore_carico": None,
            "presa_in_carico_at": None,
            "completed_at": None, "shipped_at": None, "cancelled_at": None,
            "created_by": current.get("username"),
            "created_at": _now(), "updated_at": _now(),
            "operation_id": op_id,
        }
        await db.commesse.insert_one(doc)
        await event_logger.log_event(
            db, category="COMMESSE", event_type="COMMESSA_CREATA",
            action="commesse.create", level="INFO", status="SUCCESS",
            user=current.get("username"), user_role=current.get("role"),
            operation_id=op_id, endpoint="POST /api/commesse",
            customer=body.cliente,
            message=f"Commessa #{body.number} creata per {body.cliente} ({len(body.righe)} righe)",
            details={"commessa_id": doc["id"], "number": body.number, "righe_count": len(body.righe), "priorita": body.priorita},
        )
        return _serialize(doc)

    @router.patch("/{cid}")
    async def update_commessa(cid: str, body: CommessaUpdate, current=Depends(deps.get_current_user)):
        await _require_enabled()
        doc = await db.commesse.find_one({"id": cid})
        if not doc: raise HTTPException(404, "Commessa non trovata")
        if doc.get("stato") in ("spedita", "annullata"):
            raise HTTPException(409, "Commessa non modificabile in questo stato")
        updates = {k: v for k, v in body.model_dump(exclude_unset=True).items() if v is not None}
        # Se già in preparazione o parziale, non si possono cambiare le righe
        if doc.get("stato") in ("in_preparazione", "parziale", "pronta") and "righe" in updates:
            raise HTTPException(409, "Righe non modificabili: preparazione già iniziata. Annulla e ricrea la commessa.")
        if "priorita" in updates and updates["priorita"] not in PRIORITA:
            raise HTTPException(400, "Priorità non valida")
        if "righe" in updates:
            new_righe = []
        for r in updates["righe"]:
            rr = r.model_dump() if hasattr(r, "model_dump") else dict(r)
            rr["qty_prelevata"] = 0.0
            rr["seriali_prelevati"] = []
            new_righe.append(rr)
        updates["righe"] = new_righe
        updates["updated_at"] = _now()
        await db.commesse.update_one({"id": cid}, {"$set": updates})
        await event_logger.log_event(
            db, category="COMMESSE", event_type="COMMESSA_MODIFICATA",
            action="commesse.update", level="INFO", status="SUCCESS",
            user=current.get("username"), operation_id=doc.get("operation_id"),
            endpoint=f"PATCH /api/commesse/{cid}",
            message=f"Commessa #{doc.get('number')} modificata ({list(updates.keys())})",
            details={"commessa_id": cid, "changed": list(updates.keys())},
        )
        fresh = await db.commesse.find_one({"id": cid})
        return _serialize(fresh)

    @router.post("/{cid}/take")
    async def take_commessa(cid: str, current=Depends(deps.get_current_user)):
        await _require_enabled()
        doc = await db.commesse.find_one({"id": cid})
        if not doc: raise HTTPException(404, "Commessa non trovata")
        if doc.get("stato") not in ("da_preparare",):
            if doc.get("operatore_carico") and doc.get("operatore_carico") != current.get("username"):
                raise HTTPException(409, f"Già in carico a {doc.get('operatore_carico')}")
            raise HTTPException(409, f"Presa in carico non consentita nello stato {doc.get('stato')}")
        await db.commesse.update_one({"id": cid}, {"$set": {
            "stato": "in_preparazione",
            "operatore_carico": current.get("username"),
            "presa_in_carico_at": _now(), "updated_at": _now(),
        }})
        await event_logger.log_event(
            db, category="COMMESSE", event_type="COMMESSA_PRESA_IN_CARICO",
            action="commesse.take", level="INFO", status="SUCCESS",
            user=current.get("username"), operation_id=doc.get("operation_id"),
            endpoint=f"POST /api/commesse/{cid}/take",
            customer=doc.get("cliente"),
            message=f"Commessa #{doc.get('number')} presa in carico da {current.get('username')}",
            details={"commessa_id": cid},
        )
        fresh = await db.commesse.find_one({"id": cid})
        return _serialize(fresh)

    @router.post("/{cid}/pick")
    async def pick_commessa(cid: str, body: PickBody, current=Depends(deps.get_current_user)):
        """Prelievo di una riga. Non scala inventario: registra solo cosa è stato preso.
        - A Quantità: body.quantity = incremento (o decremento se negativo)
        - A Seriale: body.serial = un singolo seriale
        """
        await _require_enabled()
        doc = await db.commesse.find_one({"id": cid})
        if not doc: raise HTTPException(404, "Commessa non trovata")
        if doc.get("stato") in ("spedita", "annullata", "da_preparare"):
            raise HTTPException(409, f"Prelievo non consentito. Stato: {doc.get('stato')}")
        if doc.get("operatore_carico") and doc.get("operatore_carico") != current.get("username"):
            raise HTTPException(409, f"Commessa in carico a {doc.get('operatore_carico')}")
        righe = doc.get("righe") or []
        idx = body.riga_index
        if idx < 0 or idx >= len(righe):
            raise HTTPException(400, "riga_index fuori range")
        riga = righe[idx]
        tg = riga.get("tipo_gestione")
        qty_req = float(riga.get("qty_richiesta") or 0)
        qty_prev = float(riga.get("qty_prelevata") or 0)

        if tg == "a_quantita":
            if body.quantity is None:
                raise HTTPException(400, "quantity richiesta per prodotti A Quantità")
            delta = float(body.quantity)
            new_prev = qty_prev + delta
            if new_prev < 0:
                raise HTTPException(400, "Quantità prelevata non può essere negativa")
            if new_prev > qty_req:
                raise HTTPException(400, f"Superata quantità richiesta ({qty_req})")
            riga["qty_prelevata"] = new_prev
            log_msg = f"Prelievo {delta:+g} × {riga.get('product_name')} (commessa #{doc.get('number')})"
            evt = "PRELIEVO_QUANTITA"
        elif tg == "a_seriale":
            if not (body.serial or "").strip():
                raise HTTPException(400, "serial richiesto per prodotti A Seriale")
            sn = body.serial.strip()
            existing = riga.get("seriali_prelevati") or []
            if any(s.lower() == sn.lower() for s in existing):
                raise HTTPException(409, "Seriale già prelevato per questa riga")
            # Verifica cross-righe (non prelevare due volte nella stessa commessa)
            for j, other in enumerate(righe):
                if j == idx: continue
                for s in (other.get("seriali_prelevati") or []):
                    if s.lower() == sn.lower():
                        raise HTTPException(409, f"Seriale già prelevato per '{other.get('product_name')}'")
            # Validazione contro inventario Notion
            try:
                from inventory_router import get_svc as _get_svc
                svc = await _get_svc(db)
                data = await svc.list_inventory()
                items = (data.get("items") if isinstance(data, dict) else data) or []
                product = next((it for it in items if (it.get("id") or it.get("page_id")) == riga.get("product_page_id")), None)
                if not product:
                    raise HTTPException(400, "Prodotto non trovato in inventario")
                available_sns = {str(s).strip().lower() for s in (product.get("serials") or [])}
                if sn.lower() not in available_sns:
                    # Verifica se è di un altro prodotto o già spedito
                    other_prod = None
                    for it in items:
                        if any(str(s).strip().lower() == sn.lower() for s in (it.get("serials") or [])):
                            other_prod = it.get("name"); break
                    if other_prod:
                        raise HTTPException(400, f"Il seriale appartiene a '{other_prod}', non a '{riga.get('product_name')}'")
                    raise HTTPException(400, f"Seriale non disponibile in inventario (già spedito o inesistente)")
                if qty_prev + 1 > qty_req:
                    raise HTTPException(400, f"Superata quantità richiesta ({qty_req})")
                riga["seriali_prelevati"] = existing + [sn]
                riga["qty_prelevata"] = qty_prev + 1
            except HTTPException:
                raise
            except Exception as e:
                logger.error(f"Validazione seriale fallita: {e}")
                raise HTTPException(502, "Errore validazione inventario")
            log_msg = f"Prelievo seriale {sn} × {riga.get('product_name')} (commessa #{doc.get('number')})"
            evt = "PRELIEVO_SERIALE"
        else:
            raise HTTPException(400, f"tipo_gestione non valido: {tg}")

        # Ricalcola stato
        doc["righe"] = righe
        new_stato = _compute_stato(doc)
        await db.commesse.update_one({"id": cid}, {"$set": {
            "righe": righe, "stato": new_stato, "updated_at": _now(),
        }})
        await event_logger.log_event(
            db, category="COMMESSE", event_type=evt,
            action="commesse.pick", level="INFO", status="SUCCESS",
            user=current.get("username"), operation_id=doc.get("operation_id"),
            endpoint=f"POST /api/commesse/{cid}/pick",
            product=riga.get("product_name"), product_code=riga.get("product_code"),
            serial=body.serial, customer=doc.get("cliente"),
            quantity_change=(float(body.quantity) if body.quantity is not None else 1.0),
            message=log_msg,
            details={"commessa_id": cid, "riga_index": idx, "new_stato": new_stato},
        )
        fresh = await db.commesse.find_one({"id": cid})
        return _serialize(fresh)

    @router.post("/{cid}/complete")
    async def complete_commessa(cid: str, current=Depends(deps.get_current_user)):
        await _require_enabled()
        doc = await db.commesse.find_one({"id": cid})
        if not doc: raise HTTPException(404, "Commessa non trovata")
        stato_calc = _compute_stato(doc)
        if stato_calc != "pronta":
            raise HTTPException(409, "Commessa non completa: non tutte le righe sono state prelevate integralmente")
        await db.commesse.update_one({"id": cid}, {"$set": {
            "stato": "pronta", "completed_at": _now(), "updated_at": _now(),
        }})
        await event_logger.log_event(
            db, category="COMMESSE", event_type="COMMESSA_COMPLETATA",
            action="commesse.complete", level="INFO", status="SUCCESS",
            user=current.get("username"), operation_id=doc.get("operation_id"),
            endpoint=f"POST /api/commesse/{cid}/complete",
            customer=doc.get("cliente"),
            message=f"Commessa #{doc.get('number')} completata → pronta per spedizione",
            details={"commessa_id": cid},
        )
        return _serialize(await db.commesse.find_one({"id": cid}))

    @router.post("/{cid}/ship")
    async def ship_commessa(cid: str, request: Request, current=Depends(deps.get_current_user)):
        """Genera una spedizione reale via /api/checklist/send. Scala l'inventario Notion."""
        await _require_enabled()
        doc = await db.commesse.find_one({"id": cid})
        if not doc: raise HTTPException(404, "Commessa non trovata")
        if doc.get("stato") != "pronta":
            raise HTTPException(409, "Solo commesse 'pronte' possono generare una spedizione")
        auth_header = request.headers.get("Authorization") or ""
        base = os.environ.get("INTERNAL_API_BASE") or "http://localhost:8001"
        items_payload = []
        for r in doc.get("righe") or []:
            items_payload.append({
                "page_id": r.get("product_page_id"),
                "name": r.get("product_name"),
                "serialized": (r.get("tipo_gestione") == "a_seriale"),
                "serials": r.get("seriali_prelevati") or [],
                "quantity": float(r.get("qty_prelevata") or 0),
                "unit": "pz",
            })
        payload = {
            "operator": current.get("username"),
            "structure": doc.get("cliente"),
            "taken_by": doc.get("operatore_carico") or current.get("username"),
            "items": items_payload,
            "commessa_ref": doc.get("number"),
        }
        try:
            async with httpx.AsyncClient(timeout=90.0, headers={"Authorization": auth_header}) as client:
                r = await client.post(f"{base}/api/checklist/send", json=payload)
            if r.status_code >= 400:
                await event_logger.log_event(
                    db, category="COMMESSE", event_type="COMMESSA_SPEDIZIONE_FALLITA",
                    action="commesse.ship", level="ERROR", status="FAILURE",
                    user=current.get("username"), operation_id=doc.get("operation_id"),
                    customer=doc.get("cliente"),
                    message=f"Spedizione commessa #{doc.get('number')} fallita: {r.status_code}",
                    details={"commessa_id": cid, "status": r.status_code, "error": r.text[:400]},
                )
                raise HTTPException(r.status_code, f"Spedizione fallita: {r.text[:200]}")
            ship_result = r.json()
        except HTTPException:
            raise
        except Exception as e:
            raise HTTPException(500, f"Errore chiamata spedizione: {e}")
        await db.commesse.update_one({"id": cid}, {"$set": {
            "stato": "spedita", "shipped_at": _now(), "updated_at": _now(),
            "shipment_ref": ship_result.get("checklist_id"),
        }})
        await event_logger.log_event(
            db, category="COMMESSE", event_type="COMMESSA_SPEDITA",
            action="commesse.ship", level="INFO", status="SUCCESS",
            user=current.get("username"), operation_id=doc.get("operation_id"),
            customer=doc.get("cliente"),
            message=f"Commessa #{doc.get('number')} → spedizione {ship_result.get('checklist_id')}",
            details={"commessa_id": cid, "shipment_id": ship_result.get("checklist_id"),
                     "inventory_warnings": ship_result.get("inventory_warnings") or []},
        )
        return {"ok": True, "shipment": ship_result, "commessa": _serialize(await db.commesse.find_one({"id": cid}))}

    @router.post("/{cid}/cancel")
    async def cancel_commessa(cid: str, current=Depends(deps.get_current_user)):
        await _require_enabled()
        doc = await db.commesse.find_one({"id": cid})
        if not doc: raise HTTPException(404, "Commessa non trovata")
        if doc.get("stato") in ("spedita", "annullata"):
            raise HTTPException(409, f"Non annullabile: stato {doc.get('stato')}")
        # Snapshot dei prelievi effettuati (per audit e futuro reversal manuale)
        picked_snapshot = [
            {"product": r.get("product_name"), "qty_prelevata": r.get("qty_prelevata"),
             "seriali_prelevati": r.get("seriali_prelevati")}
            for r in (doc.get("righe") or []) if (r.get("qty_prelevata") or 0) > 0
        ]
        await db.commesse.update_one({"id": cid}, {"$set": {
            "stato": "annullata", "cancelled_at": _now(), "updated_at": _now(),
        }})
        await event_logger.log_event(
            db, category="COMMESSE", event_type="COMMESSA_ANNULLATA",
            action="commesse.cancel", level="WARNING", status="SUCCESS",
            user=current.get("username"), operation_id=doc.get("operation_id"),
            customer=doc.get("cliente"),
            message=f"Commessa #{doc.get('number')} annullata (prelievi registrati: {len(picked_snapshot)})",
            details={"commessa_id": cid, "picked_snapshot": picked_snapshot},
        )
        return _serialize(await db.commesse.find_one({"id": cid}))

    @router.get("/{cid}/history")
    async def history_commessa(cid: str):
        await _require_enabled()
        doc = await db.commesse.find_one({"id": cid})
        if not doc: raise HTTPException(404, "Commessa non trovata")
        events = []
        cursor = db.app_events.find({
            "$or": [
                {"operation_id": doc.get("operation_id")},
                {"details.commessa_id": cid},
            ]
        }).sort("created_at", 1)
        async for e in cursor:
            e.pop("_id", None)
            if isinstance(e.get("created_at"), datetime):
                e["created_at"] = e["created_at"].isoformat()
            events.append(e)
        return {"events": events}

    return router
