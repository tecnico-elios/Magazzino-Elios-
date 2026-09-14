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

STATI = ("da_preparare", "in_preparazione", "parziale", "pronta", "bozza_spedizione", "spedita", "annullata")
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
    # F28.c — ID Notion dell'ordine "Eliostech Ordini" agganciato al cliente (autocomplete).
    # Salvato sulla commessa e propagato al payload spedizione per allineamento SSOT.
    order_page_id: Optional[str] = None
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
    remove: Optional[bool] = False  # F28 — se true su A Seriale rimuove il seriale specificato


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
    """Ricalcola stato in base ai prelievi delle righe (esclude stati terminali/bozza)."""
    # F25.b — bozza_spedizione è uno stato manuale: non lo ricalcoliamo dalle righe.
    if doc.get("stato") in ("spedita", "annullata", "bozza_spedizione"):
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
            # F28.c — Persisti order_page_id se selezionato via autocomplete Notion (SSOT clienti)
            "order_page_id": (body.order_page_id or "").strip() or None,
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
        """F27 — Modifica completa con regole per stato + audit diff dettagliato.
        - Da preparare: full edit
        - In preparazione/Parziale: qty_richiesta >= qty_prelevata, no rimozione righe con prelievi, no rimozione seriali già prelevati
        - Pronta: blocco righe (annulla completamento per modificare)
        - Bozza spedizione: blocco (annulla prima la bozza)
        - Spedita/Annullata: blocco (usa reopen)
        """
        await _require_enabled()
        doc = await db.commesse.find_one({"id": cid})
        if not doc: raise HTTPException(404, "Commessa non trovata")
        stato = doc.get("stato")
        if stato in ("spedita", "annullata"):
            raise HTTPException(409, f"Commessa {stato}: usa 'Riapri' per modificarla" if stato == "annullata" else "Commessa spedita: non modificabile")
        if stato == "bozza_spedizione":
            raise HTTPException(409, "Bozza spedizione attiva: annulla la bozza per modificare la commessa")
        updates = {k: v for k, v in body.model_dump(exclude_unset=True).items() if v is not None}
        if "priorita" in updates and updates["priorita"] not in PRIORITA:
            raise HTTPException(400, "Priorità non valida")

        if "righe" in updates:
            if stato == "pronta":
                raise HTTPException(409, "Commessa pronta: le righe non sono modificabili. Annulla il completamento per modificarle.")
            old_righe = doc.get("righe") or []
            old_by_pid = {r.get("product_page_id"): r for r in old_righe}
            new_input = updates["righe"]
            merged = []
            seen_pids = set()
            for r in new_input:
                rr = r.model_dump() if hasattr(r, "model_dump") else dict(r)
                pid = rr.get("product_page_id")
                seen_pids.add(pid)
                old = old_by_pid.get(pid)
                if old and (float(old.get("qty_prelevata") or 0) > 0 or (old.get("seriali_prelevati") or [])):
                    # Riga con prelievi: preservali + verifica compatibilità quantità
                    qp = float(old.get("qty_prelevata") or 0)
                    if float(rr.get("qty_richiesta") or 0) < qp:
                        raise HTTPException(400,
                            f"'{rr.get('product_name')}': quantità richiesta ({rr.get('qty_richiesta')}) inferiore alla già preparata ({qp:g}). Aumenta la quantità o rimuovi i prelievi.")
                    if rr.get("tipo_gestione") != old.get("tipo_gestione"):
                        raise HTTPException(400,
                            f"'{rr.get('product_name')}': impossibile cambiare tipo gestione con prelievi già effettuati.")
                    rr["qty_prelevata"] = qp
                    rr["seriali_prelevati"] = list(old.get("seriali_prelevati") or [])
                else:
                    # Nuova riga o riga senza prelievi
                    rr["qty_prelevata"] = 0.0
                    rr["seriali_prelevati"] = []
                merged.append(rr)
            # Verifica righe eliminate: quelle con prelievi non possono essere rimosse
            removed_with_picks = [r for pid, r in old_by_pid.items()
                                  if pid not in seen_pids and
                                  (float(r.get("qty_prelevata") or 0) > 0 or (r.get("seriali_prelevati") or []))]
            if removed_with_picks:
                names = ", ".join(r.get("product_name") or "?" for r in removed_with_picks)
                raise HTTPException(400, f"Non puoi rimuovere prodotti con prelievi effettuati: {names}. Prima rimuovi i prelievi.")
            updates["righe"] = merged

        # Calcola diff prima di applicare (per audit)
        diff = {}
        for k in ("cliente", "data_ordine", "data_prevista", "priorita", "note"):
            if k in updates and doc.get(k) != updates[k]:
                diff[k] = {"before": doc.get(k), "after": updates[k]}
        if "righe" in updates:
            old_pids = {r.get("product_page_id") for r in (doc.get("righe") or [])}
            new_pids = {r.get("product_page_id") for r in updates["righe"]}
            added = [r for r in updates["righe"] if r.get("product_page_id") not in old_pids]
            removed = [r for r in (doc.get("righe") or []) if r.get("product_page_id") not in new_pids]
            qty_changes = []
            for r in updates["righe"]:
                pid = r.get("product_page_id")
                if pid in old_pids:
                    old = next((o for o in (doc.get("righe") or []) if o.get("product_page_id") == pid), None)
                    if old and float(old.get("qty_richiesta") or 0) != float(r.get("qty_richiesta") or 0):
                        qty_changes.append({"product": r.get("product_name"),
                                            "before": old.get("qty_richiesta"), "after": r.get("qty_richiesta")})
            if added or removed or qty_changes:
                diff["righe"] = {
                    "added": [{"product": r.get("product_name"), "qty": r.get("qty_richiesta")} for r in added],
                    "removed": [{"product": r.get("product_name"), "qty": r.get("qty_richiesta")} for r in removed],
                    "qty_changes": qty_changes,
                }
        # Ricalcola stato se righe cambiate (in preparazione ↔ parziale, ecc.)
        if "righe" in updates:
            preview = {**doc, **updates}
            updates["stato"] = _compute_stato(preview)
            if updates["stato"] == stato:
                updates.pop("stato")

        updates["updated_at"] = _now()
        await db.commesse.update_one({"id": cid}, {"$set": updates})
        await event_logger.log_event(
            db, category="COMMESSE", event_type="COMMESSA_MODIFICATA",
            action="commesse.update", level="INFO", status="SUCCESS",
            user=current.get("username"), operation_id=doc.get("operation_id"),
            endpoint=f"PATCH /api/commesse/{cid}",
            customer=doc.get("cliente"),
            message=f"Commessa #{doc.get('number')} modificata ({len(diff)} campi)",
            details={"commessa_id": cid, "changed_fields": list(diff.keys()), "diff": diff},
        )
        fresh = await db.commesse.find_one({"id": cid})
        return _serialize(fresh)

    @router.post("/{cid}/reopen")
    async def reopen_commessa(cid: str, current=Depends(deps.get_current_user)):
        """F27 — Riapre una commessa annullata mantenendo storico e prelievi.
        Ricalcola lo stato in base ai prelievi effettivi (da_preparare / in_preparazione / parziale / pronta).
        Non crea nuova commessa: stesso id, stesso operation_id."""
        await _require_enabled()
        doc = await db.commesse.find_one({"id": cid})
        if not doc: raise HTTPException(404, "Commessa non trovata")
        if doc.get("stato") != "annullata":
            raise HTTPException(409, f"Riapri disponibile solo su commesse annullate (stato attuale: {doc.get('stato')})")
        # Ricalcola stato: se ci sono prelievi → in_preparazione/parziale/pronta; altrimenti da_preparare
        base = {**doc, "stato": "in_preparazione"}
        new_stato = _compute_stato(base)
        if new_stato == "spedita":  # safety
            new_stato = "pronta"
        updated = await db.commesse.find_one_and_update(
            {"id": cid, "stato": "annullata"},
            {"$set": {"stato": new_stato, "updated_at": _now()},
             "$unset": {"cancelled_at": ""}},
            return_document=True,
        )
        if not updated:
            raise HTTPException(409, "Riapertura non riuscita (stato cambiato in concorrenza)")
        await event_logger.log_event(
            db, category="COMMESSE", event_type="COMMESSA_RIAPERTA",
            action="commesse.reopen", level="INFO", status="SUCCESS",
            user=current.get("username"), operation_id=doc.get("operation_id"),
            endpoint=f"POST /api/commesse/{cid}/reopen",
            customer=doc.get("cliente"),
            message=f"Commessa #{doc.get('number')} riaperta (nuovo stato: {new_stato})",
            details={"commessa_id": cid, "previous_stato": "annullata", "new_stato": new_stato},
        )
        return _serialize(updated)

    @router.delete("/{cid}", dependencies=[Depends(deps.require_admin)])
    async def delete_commessa(cid: str, current=Depends(deps.get_current_user)):
        """F27 — Cancellazione DEFINITIVA (solo Admin). Impedita se collegata a spedizione."""
        await _require_enabled()
        doc = await db.commesse.find_one({"id": cid})
        if not doc: raise HTTPException(404, "Commessa non trovata")
        if doc.get("shipment_ref") or doc.get("stato") == "spedita":
            raise HTTPException(409, "Commessa collegata a una spedizione già effettuata. Non eliminabile.")
        # Log PRIMA della cancellazione (retention audit)
        await event_logger.log_event(
            db, category="COMMESSE", event_type="COMMESSA_ELIMINATA",
            action="commesse.delete", level="WARNING", status="SUCCESS",
            user=current.get("username"), user_role=current.get("role"),
            operation_id=doc.get("operation_id"),
            endpoint=f"DELETE /api/commesse/{cid}",
            customer=doc.get("cliente"),
            message=f"Commessa #{doc.get('number')} ELIMINATA DEFINITIVAMENTE da Admin {current.get('username')}",
            details={"commessa_id": cid, "number": doc.get("number"), "cliente": doc.get("cliente"),
                     "stato": doc.get("stato"), "righe_snapshot": doc.get("righe") or []},
        )
        await db.commesse.delete_one({"id": cid})
        return {"ok": True, "deleted": cid}

    @router.post("/{cid}/take")
    async def take_commessa(cid: str, current=Depends(deps.get_current_user)):
        await _require_enabled()
        # F23.b — Presa in carico ATOMICA per prevenire race condition tra operatori.
        # find_one_and_update accetta la mutazione SOLO se lo stato è ancora 'da_preparare'
        # e non c'è già un operatore_carico. Il secondo operatore che tenta in parallelo
        # riceve doc=None → 409 (nessun falso successo, log corretto).
        updated = await db.commesse.find_one_and_update(
            {"id": cid, "stato": "da_preparare", "$or": [
                {"operatore_carico": None}, {"operatore_carico": {"$exists": False}}
            ]},
            {"$set": {
                "stato": "in_preparazione",
                "operatore_carico": current.get("username"),
                "presa_in_carico_at": _now(), "updated_at": _now(),
            }},
            return_document=True,
        )
        if not updated:
            # Verifica motivo del fallimento per messaggio chiaro
            doc = await db.commesse.find_one({"id": cid})
            if not doc: raise HTTPException(404, "Commessa non trovata")
            if doc.get("operatore_carico") and doc.get("operatore_carico") != current.get("username"):
                raise HTTPException(409, f"Commessa già presa in carico da {doc.get('operatore_carico')}")
            if doc.get("operatore_carico") == current.get("username"):
                # Idempotente: se sono io stesso, restituisco lo stato attuale
                return _serialize(doc)
            raise HTTPException(409, f"Presa in carico non consentita nello stato {doc.get('stato')}")
        doc = updated
        await event_logger.log_event(
            db, category="COMMESSE", event_type="COMMESSA_PRESA_IN_CARICO",
            action="commesse.take", level="INFO", status="SUCCESS",
            user=current.get("username"), operation_id=doc.get("operation_id"),
            endpoint=f"POST /api/commesse/{cid}/take",
            customer=doc.get("cliente"),
            message=f"Commessa #{doc.get('number')} presa in carico da {current.get('username')}",
            details={"commessa_id": cid},
        )
        return _serialize(doc)

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
            # F28 — Rimozione seriale (decremento controllato)
            if body.remove:
                match_idx = next((i for i, s in enumerate(existing) if s.lower() == sn.lower()), None)
                if match_idx is None:
                    raise HTTPException(404, f"Seriale '{sn}' non presente tra i prelievi di questa riga")
                new_serials = existing[:match_idx] + existing[match_idx+1:]
                riga["seriali_prelevati"] = new_serials
                riga["qty_prelevata"] = max(0.0, qty_prev - 1)
                log_msg = f"Rimozione seriale {sn} × {riga.get('product_name')} (commessa #{doc.get('number')})"
                evt = "PRELIEVO_SERIALE_RIMOSSO"
            else:
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

    async def _build_draft_payload(doc: Dict[str, Any], operator: str) -> Dict[str, Any]:
        """Costruisce lo snapshot bozza dai dati correnti della commessa.
        F28.b/c — payload IDENTICO a quello inviato da /ChecklistPage (spedizione normale):
        include shipping_date, order_page_id, notes, e qr_codes allineati ai seriali."""
        items_payload = []
        for r in doc.get("righe") or []:
            serials = list(r.get("seriali_prelevati") or [])
            # F28.c — Recupera i QR code associati ai seriali (SSOT: db.qr_associations)
            # Stessa collection usata da /checklist/send. Ogni seriale può avere 0 o 1 QR attivo.
            qr_codes: List[str] = []
            if serials:
                sn_lows = [s.strip().lower() for s in serials if s]
                if sn_lows:
                    cursor = db.qr_associations.find({"serial_lower": {"$in": sn_lows}, "active": True})
                    qr_map: Dict[str, str] = {}
                    async for d in cursor:
                        qr_map[d.get("serial_lower")] = d.get("qr_code") or ""
                    qr_codes = [qr_map.get(s.strip().lower(), "") for s in serials]
            items_payload.append({
                "page_id": r.get("product_page_id"),
                "name": r.get("product_name"),
                "product_code": r.get("product_code"),
                "serialized": (r.get("tipo_gestione") == "a_seriale"),
                "serials": serials,
                "qr_codes": qr_codes,  # F28.c — allineati per index ai seriali (stringa vuota se assente)
                "quantity": float(r.get("qty_prelevata") or 0),
                "unit": "pz",
            })
        # Data spedizione: usa data_prevista della commessa se presente, altrimenti oggi
        ship_date = doc.get("data_prevista") or datetime.now(timezone.utc).strftime("%Y-%m-%d")
        # F28.c — Note: prefisso automatico con riferimento commessa per tracciabilità Notion.
        # Se il campo "notes" del ChecklistPayload non è mappato su Notion, questa stringa
        # rimane comunque nel Registro Log/audit come parte del payload.
        base_notes = (doc.get("note") or "").strip()
        combined_notes = f"Commessa #{doc.get('number')}" + (f" — {base_notes}" if base_notes else "")
        return {
            "shipping_date": ship_date,
            "operator": operator,
            "structure": doc.get("cliente"),
            "taken_by": doc.get("operatore_carico") or operator,
            # F28.c — order_page_id: identico al flusso ChecklistPage (evita ambiguità ricerca)
            "order_page_id": doc.get("order_page_id"),
            "notes": combined_notes,
            "items": items_payload,
            "commessa_ref": doc.get("number"),
        }

    @router.post("/{cid}/draft")
    async def create_draft(cid: str, current=Depends(deps.get_current_user)):
        """F25.b — Crea/recupera una BOZZA DI SPEDIZIONE persistente sul server.
        - Idempotente: se esiste già una bozza per la commessa, ritorna quella.
        - Atomico: transizione stato pronta → bozza_spedizione via find_one_and_update.
        - NON tocca l'inventario Notion.
        """
        await _require_enabled()
        # Ripresa idempotente: se già in bozza_spedizione, restituisci lo snapshot corrente
        existing = await db.commesse.find_one({"id": cid})
        if not existing: raise HTTPException(404, "Commessa non trovata")
        if existing.get("stato") == "bozza_spedizione":
            return {"ok": True, "resumed": True, "draft": existing.get("shipment_draft"),
                    "commessa": _serialize(existing)}
        # Transizione atomica da 'pronta' a 'bozza_spedizione'
        draft_payload = await _build_draft_payload(existing, current.get("username"))
        draft_meta = {
            "created_by": current.get("username"), "created_at": _now(),
            "updated_at": _now(), "operation_id": existing.get("operation_id"),
            "payload": draft_payload,
        }
        updated = await db.commesse.find_one_and_update(
            {"id": cid, "stato": "pronta"},
            {"$set": {"stato": "bozza_spedizione", "shipment_draft": draft_meta, "updated_at": _now()}},
            return_document=True,
        )
        if not updated:
            fresh = await db.commesse.find_one({"id": cid})
            raise HTTPException(409, f"Bozza non creabile: stato attuale {fresh.get('stato')}")
        await event_logger.log_event(
            db, category="COMMESSE", event_type="BOZZA_CREATA",
            action="commesse.draft.create", level="INFO", status="SUCCESS",
            user=current.get("username"), operation_id=existing.get("operation_id"),
            endpoint=f"POST /api/commesse/{cid}/draft",
            customer=existing.get("cliente"),
            message=f"Bozza spedizione creata per commessa #{existing.get('number')}",
            details={"commessa_id": cid, "righe_count": len(draft_payload["items"])},
        )
        return {"ok": True, "resumed": False, "draft": draft_meta, "commessa": _serialize(updated)}

    @router.post("/{cid}/draft/cancel")
    async def cancel_draft(cid: str, current=Depends(deps.get_current_user)):
        """Annulla la bozza persistente e riporta la commessa a 'pronta'. Nessun tocco inventario."""
        await _require_enabled()
        updated = await db.commesse.find_one_and_update(
            {"id": cid, "stato": "bozza_spedizione"},
            {"$set": {"stato": "pronta", "updated_at": _now()}, "$unset": {"shipment_draft": ""}},
            return_document=True,
        )
        if not updated:
            fresh = await db.commesse.find_one({"id": cid})
            if not fresh: raise HTTPException(404, "Commessa non trovata")
            raise HTTPException(409, f"Nessuna bozza attiva: stato {fresh.get('stato')}")
        await event_logger.log_event(
            db, category="COMMESSE", event_type="BOZZA_ANNULLATA",
            action="commesse.draft.cancel", level="INFO", status="SUCCESS",
            user=current.get("username"), operation_id=updated.get("operation_id"),
            endpoint=f"POST /api/commesse/{cid}/draft/cancel",
            customer=updated.get("cliente"),
            message=f"Bozza spedizione annullata per commessa #{updated.get('number')}",
            details={"commessa_id": cid},
        )
        return {"ok": True, "commessa": _serialize(updated)}

    @router.post("/{cid}/ship")
    async def ship_commessa(cid: str, request: Request, current=Depends(deps.get_current_user)):
        """F25.b/F28.b — CONFERMA la spedizione (partendo da bozza persistente).
        - Body opzionale {shipping_date: "YYYY-MM-DD"} per override.
        - Idempotente: se già spedita ritorna 200 con `already_shipped: true` (no doppia spedizione).
        - Esegue /api/checklist/send solo una volta (transizione atomica → spedita)."""
        await _require_enabled()
        doc = await db.commesse.find_one({"id": cid})
        if not doc: raise HTTPException(404, "Commessa non trovata")
        # F28.b — Idempotenza: se già spedita, ritorna il risultato precedente
        if doc.get("stato") == "spedita" and doc.get("shipment_ref"):
            return {"ok": True, "already_shipped": True,
                    "shipment": {"checklist_id": doc.get("shipment_ref"),
                                 "message": f"Commessa già spedita (id {doc.get('shipment_ref')})"},
                    "commessa": _serialize(doc)}
        # Body opzionale con override shipping_date/taken_by
        override: Dict[str, Any] = {}
        try:
            body = await request.json()
            if isinstance(body, dict):
                if body.get("shipping_date"): override["shipping_date"] = str(body["shipping_date"]).strip()
                if body.get("taken_by"): override["taken_by"] = str(body["taken_by"]).strip()
        except Exception:
            pass
        # Se la commessa è ancora 'pronta', creiamo prima la bozza (retro-compat client)
        if doc.get("stato") == "pronta":
            draft_meta = {
                "created_by": current.get("username"), "created_at": _now(),
                "updated_at": _now(), "operation_id": doc.get("operation_id"),
                "payload": await _build_draft_payload(doc, current.get("username")),
            }
            promoted = await db.commesse.find_one_and_update(
                {"id": cid, "stato": "pronta"},
                {"$set": {"stato": "bozza_spedizione", "shipment_draft": draft_meta, "updated_at": _now()}},
                return_document=True,
            )
            if not promoted:
                fresh = await db.commesse.find_one({"id": cid})
                # Race: se un altro operatore l'ha appena spedita, ritorna idempotente
                if fresh and fresh.get("stato") == "spedita":
                    return {"ok": True, "already_shipped": True,
                            "shipment": {"checklist_id": fresh.get("shipment_ref"), "message": "Commessa già spedita"},
                            "commessa": _serialize(fresh)}
                raise HTTPException(409, f"Impossibile confermare: stato {fresh.get('stato')}")
            doc = promoted
        if doc.get("stato") != "bozza_spedizione":
            raise HTTPException(409, "Confermabile solo da bozza_spedizione o pronta")
        auth_header = request.headers.get("Authorization") or ""
        base = os.environ.get("INTERNAL_API_BASE") or "http://localhost:8001"
        # Usa il payload persistito (se presente) altrimenti ricostruisci dai dati correnti
        draft = doc.get("shipment_draft") or {}
        payload = draft.get("payload") or await _build_draft_payload(doc, current.get("username"))
        # F28.b — Assicura shipping_date SEMPRE presente (retro-compat con bozze pre-fix)
        if not payload.get("shipping_date"):
            payload["shipping_date"] = doc.get("data_prevista") or datetime.now(timezone.utc).strftime("%Y-%m-%d")
        # Applica override utente (data / preso da)
        payload = {**payload, **override}
        # Ricostruisci items nel formato atteso da /checklist/send (senza product_code)
        items_payload = [{k: v for k, v in it.items() if k != "product_code"} for it in payload.get("items", [])]
        payload = {**payload, "items": items_payload}
        # F28.c — Rimuovi eventuali campi extra non riconosciuti da ChecklistPayload (extra="ignore" li ignora,
        # ma per pulizia log/curl li omettiamo). commessa_ref viene silenziosamente ignorato dal backend
        # (ChecklistPayload ha extra="ignore") ma lo lasciamo perché serve al log della commessa.
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
        await db.commesse.update_one({"id": cid}, {
            "$set": {
                "stato": "spedita", "shipped_at": _now(), "updated_at": _now(),
                "shipment_ref": ship_result.get("checklist_id"),
            },
            "$unset": {"shipment_draft": ""},
        })
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
