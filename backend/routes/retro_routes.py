"""F14 — Operazione Retroattiva (rettifica controllata).

Regole ferree:
- RETTIFICA il record ESISTENTE, MAI creare nuove righe (né in Uscite/Entrate né in Ordini).
- Motivazione obbligatoria + audit before/after per ogni modifica.
- Permessi: Admin (sempre) o Responsabile con permesso `modifica_retroattiva`.
- Operator MAI autorizzato.

Endpoints:
- POST  /api/retro/find                             → trova operazioni (filtro base)
- PATCH /api/retro/shipment/{tracker_page_id}       → modifica riga Uscite + Ordine
- PATCH /api/retro/arrivo/{receipt_page_id}         → modifica riga Entrate
- POST  /api/retro/cancel/{tipo}/{page_id}          → annullamento (archive + audit, no cancellazione fisica dello storico)
"""
from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Optional, Dict, Any, List

from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel, ConfigDict

import auth as auth_mod
import notion_service
from routes import admin_extra_routes as _adm

logger = logging.getLogger(__name__)


async def _send_retro_email_if_enabled(db, send_email_fn, tipo: str, before: Dict[str, Any],
                                         after: Dict[str, Any], reason: str, actor: str) -> bool:
    """F14 §9-10 — Invio email retroattività SOLO se settings.retroattivita.email_enabled=True.
    Riusa `send_email` esistente + destinatari già configurati. Returns True se inviata."""
    try:
        settings = await _adm.get_app_settings(db)
        enabled = bool(((settings.get("retroattivita") or {}).get("email_enabled")))
        if not enabled:
            return False
        # Riusa i destinatari già configurati per gli eventi shipment/arrivi
        recips_doc = await db.settings.find_one({"_id": "app_settings"}) or {}
        raw_recips = recips_doc.get("recipients") or []
        emails: List[str] = []
        for r in raw_recips:
            if isinstance(r, str):
                emails.append(r)
            elif isinstance(r, dict) and r.get("email"):
                if r.get("enabled") is False:
                    continue
                ev_key = "spedizioni" if tipo == "spedizione" else "arrivi"
                if (r.get("events") or {}).get(ev_key, True):
                    emails.append(r["email"])
        if not emails:
            return False
        subject = f"[Retroattività] {tipo.capitalize()} modificata — {after.get('sn') or before.get('sn') or ''}"
        rows_html = ""
        for k in ("sn", "quantity", "date", "cliente", "taken_by", "qr_code"):
            b = before.get(k); a = after.get(k)
            if b is None and a is None:
                continue
            if str(b) == str(a):
                continue
            rows_html += (
                f"<tr>"
                f"<td style='padding:6px 10px;border:1px solid #e2e8f0;font-weight:600'>{k}</td>"
                f"<td style='padding:6px 10px;border:1px solid #e2e8f0;color:#dc2626'>{b if b is not None else '—'}</td>"
                f"<td style='padding:6px 10px;border:1px solid #e2e8f0;color:#16a34a;font-weight:700'>{a if a is not None else '—'}</td>"
                f"</tr>"
            )
        html = (
            f"<div style='font-family:Arial,sans-serif;padding:16px'>"
            f"<h2 style='color:#b45309'>⚠️ Operazione retroattiva applicata</h2>"
            f"<p><b>Tipo:</b> {tipo}<br/>"
            f"<b>Operatore:</b> {actor}<br/>"
            f"<b>Motivazione:</b> {reason}<br/>"
            f"<b>Data registrazione:</b> {datetime.now(timezone.utc).isoformat()}</p>"
            f"<table style='border-collapse:collapse;font-size:13px'>"
            f"<thead><tr><th style='padding:6px 10px;border:1px solid #e2e8f0'>Campo</th>"
            f"<th style='padding:6px 10px;border:1px solid #e2e8f0'>Prima</th>"
            f"<th style='padding:6px 10px;border:1px solid #e2e8f0'>Dopo</th></tr></thead>"
            f"<tbody>{rows_html or '<tr><td colspan=3>Nessun campo modificato</td></tr>'}</tbody>"
            f"</table></div>"
        )
        for e in emails:
            try:
                await send_email_fn(e, subject, html)
            except Exception as ex:
                logger.warning(f"retro email to {e} failed: {ex}")
        return True
    except Exception as e:
        logger.warning(f"retro email skipped: {e}")
        return False


def _require_retro(current) -> None:
    """Guardia backend §18: Admin sempre, Responsabile solo con permesso, Operator mai."""
    role = current.get("role")
    if role == auth_mod.ROLE_ADMIN or auth_mod.is_master_user(current):
        return
    if role == auth_mod.ROLE_RESPONSABILE and auth_mod.has_permission(current, "modifica_retroattiva"):
        return
    raise HTTPException(403, "Operazione retroattiva non autorizzata")


class RetroFindBody(BaseModel):
    model_config = ConfigDict(extra="ignore")
    tipo: str  # "spedizione" | "arrivo"
    date_from: Optional[str] = None
    date_to: Optional[str] = None
    serial: Optional[str] = None
    structure: Optional[str] = None
    fornitore: Optional[str] = None  # F14 fix: usato SOLO per tipo=arrivo


class ShipmentPatchBody(BaseModel):
    model_config = ConfigDict(extra="ignore")
    reason: str
    new_sn: Optional[str] = None
    new_quantity: Optional[float] = None
    new_structure: Optional[str] = None  # → riscrive "Preso per" e ri-sincronizza Ordini
    new_taken_by: Optional[str] = None
    new_qr_code: Optional[str] = None    # aggiungi/aggiorna QR sull'ordine


class ArrivoPatchBody(BaseModel):
    model_config = ConfigDict(extra="ignore")
    reason: str
    new_sn: Optional[str] = None
    new_quantity: Optional[float] = None


class CancelBody(BaseModel):
    model_config = ConfigDict(extra="ignore")
    reason: str


def build_router(db, deps, send_email_fn=None) -> APIRouter:
    router = APIRouter(prefix="/retro", tags=["retro"])

    @router.get("/authorized")
    async def check_authorized(current=Depends(deps.get_current_user)):
        """Il frontend usa questo per decidere se mostrare la card Dashboard."""
        role = current.get("role")
        authorized = (
            role == auth_mod.ROLE_ADMIN
            or auth_mod.is_master_user(current)
            or (role == auth_mod.ROLE_RESPONSABILE and auth_mod.has_permission(current, "modifica_retroattiva"))
        )
        return {"authorized": authorized, "role": role}

    @router.post("/find")
    async def find_ops(body: RetroFindBody, current=Depends(deps.get_current_user)):
        """Trova operazioni esistenti. LIVE da Notion (o gestionale se attivo)."""
        _require_retro(current)
        from inventory_router import get_svc as _get_inv_svc
        svc = await _get_inv_svc(db)
        if body.tipo == "spedizione":
            rows = await svc.list_exits(date_from=body.date_from, date_to=body.date_to)
        elif body.tipo == "arrivo":
            rows = await svc.list_receipts_all(date_from=body.date_from, date_to=body.date_to)
            # F14 fix: arricchisci ogni receipt col fornitore da Mongo `arrivi` (best-effort match per SN + data)
            try:
                mongo_arrivi = await db.arrivi.find({}).to_list(2000)
            except Exception:
                mongo_arrivi = []
            def _find_fornitore(sn: str, date: str) -> str:
                sn_low = (sn or "").strip().lower()
                for a in mongo_arrivi:
                    if a.get("arrival_date") != date:
                        continue
                    for it in (a.get("items") or []):
                        if sn_low and sn_low in [(s or "").strip().lower() for s in (it.get("serials") or [])]:
                            return a.get("fornitore") or ""
                        if not sn_low and (it.get("name") or "").strip().lower() == (sn or "").strip().lower():
                            return a.get("fornitore") or ""
                return ""
            for r in rows:
                r["fornitore"] = _find_fornitore(r.get("sn") or "", r.get("date") or "")
        else:
            raise HTTPException(400, "tipo deve essere 'spedizione' o 'arrivo'")

        q_sn = (body.serial or "").strip().lower()
        q_st = (body.structure or "").strip().lower()
        q_fn = (body.fornitore or "").strip().lower()

        def _match(r: Dict[str, Any]) -> bool:
            if q_sn and q_sn not in (r.get("sn") or "").lower():
                return False
            if body.tipo == "spedizione" and q_st and q_st not in (r.get("cliente") or "").lower():
                return False
            if body.tipo == "arrivo" and q_fn and q_fn not in (r.get("fornitore") or "").lower():
                return False
            return True

        out = [r for r in rows if _match(r)]
        return {"items": out[:200], "count": len(out)}

    @router.patch("/shipment/{tracker_page_id}")
    async def patch_shipment(tracker_page_id: str, body: ShipmentPatchBody, current=Depends(deps.get_current_user)):
        _require_retro(current)
        if not (body.reason or "").strip():
            raise HTTPException(400, "Motivazione obbligatoria")

        # 1) Leggi lo stato PRIMA (per audit before/after) dalle Uscite Notion
        try:
            exits = await notion_service.list_exits()
        except Exception as e:
            raise HTTPException(502, f"Errore lettura uscite: {e}")
        current_row = next((r for r in exits if r.get("id") == tracker_page_id), None)
        if not current_row:
            raise HTTPException(404, "Riga uscita non trovata su Notion")

        before = {
            "sn": current_row.get("sn"),
            "quantity": current_row.get("quantity"),
            "cliente": current_row.get("cliente"),
            "date": current_row.get("date"),
            "taken_by": current_row.get("taken_by"),
        }
        after = dict(before)

        # 2) Se cambia la struttura → verifica ordine esistente PRIMA di modificare
        new_order_id: Optional[str] = None
        if body.new_structure and body.new_structure.strip() and body.new_structure.strip() != (before["cliente"] or "").strip():
            order = await notion_service.find_order_by_structure(body.new_structure.strip())
            if order.get("status") == "not_found":
                raise HTTPException(409, f"Ordine non trovato per la nuova struttura: '{body.new_structure}'")
            if order.get("status") == "multiple":
                raise HTTPException(409, f"Più ordini per '{body.new_structure}'. Verificare l'ordine.")
            if order.get("status") == "found":
                new_order_id = order.get("id")
            after["cliente"] = body.new_structure.strip()

        # 3) Aggiorna SOLO i campi passati sulla riga Uscite (§20 — modifica in-place)
        try:
            await notion_service.update_tracker_row(
                tracker_page_id,
                new_sn=(body.new_sn.strip() if body.new_sn else None),
                new_qty=body.new_quantity,
                new_cliente=(body.new_structure.strip() if body.new_structure else None),
                new_date=None,  # F14 §3: la data operazione non è modificabile via UI
                new_taken_by=body.new_taken_by,
            )
        except Exception as e:
            raise HTTPException(502, f"Aggiornamento riga uscita fallito: {e}")
        if body.new_sn: after["sn"] = body.new_sn.strip()
        if body.new_quantity is not None: after["quantity"] = body.new_quantity
        if body.new_taken_by is not None: after["taken_by"] = body.new_taken_by

        # 4) Se cambio struttura → rimuovi SN/QR dal vecchio ordine e append al nuovo
        old_qr: Optional[str] = None
        if before["sn"]:
            existing_qr = await db.qr_associations.find_one({"serial_lower": (before["sn"] or "").lower(), "active": True})
            if existing_qr:
                old_qr = existing_qr.get("qr_code")

        if body.new_structure and body.new_structure.strip() and body.new_structure.strip() != (before["cliente"] or "").strip():
            # Trova il vecchio ordine (ignora errori — magari non esiste più) e rimuovi
            try:
                old_order = await notion_service.find_order_by_structure(before["cliente"] or "")
                if old_order.get("status") == "found":
                    await notion_service.remove_shipment_from_order(
                        old_order["id"], [before["sn"]] if before["sn"] else [], [old_qr] if old_qr else [],
                    )
            except Exception as e:
                logger.warning(f"remove from old order fallito: {e}")
            # Append al nuovo ordine
            if new_order_id:
                sn_add = [after["sn"]] if after["sn"] else []
                qr_add = [old_qr] if old_qr else []
                if body.new_qr_code: qr_add = [body.new_qr_code.strip()]
                try:
                    await notion_service.append_shipment_to_order(new_order_id, sn_add, qr_add)
                except Exception as e:
                    logger.warning(f"append new order fallito: {e}")

        # 5) Gestione QR: aggiungi/aggiorna QR sull'ordine attuale
        if body.new_qr_code:
            new_qr = body.new_qr_code.strip()
            # Verifica univocità
            existing = await db.qr_associations.find_one({"qr_code_lower": new_qr.lower(), "active": True})
            sn_for_qr = after["sn"] or before["sn"] or ""
            if existing and existing.get("serial_lower") != sn_for_qr.lower():
                raise HTTPException(409, f"QR {new_qr} già associato a un altro seriale")
            structure_for_qr = after["cliente"] or before["cliente"] or ""
            # Trova ordine attuale
            order_current = await notion_service.find_order_by_structure(structure_for_qr)
            if order_current.get("status") == "found":
                try:
                    await notion_service.append_shipment_to_order(
                        order_current["id"], [sn_for_qr] if sn_for_qr else [], [new_qr],
                    )
                except Exception as e:
                    logger.warning(f"add QR to order fallito: {e}")
            # Persisti associazione (upsert)
            await db.qr_associations.update_one(
                {"qr_code_lower": new_qr.lower()},
                {"$set": {
                    "qr_code": new_qr,
                    "qr_code_lower": new_qr.lower(),
                    "serial": sn_for_qr,
                    "serial_lower": sn_for_qr.lower(),
                    "structure": structure_for_qr,
                    "associated_at": datetime.now(timezone.utc).isoformat(),
                    "associated_by": current.get("username"),
                    "active": True,
                    "note": "retro-attach",
                }},
                upsert=True,
            )
            after["qr_code"] = new_qr

        # 6) Se cambia il seriale → aggiorna anche la colonna 16 dell'Inventario Notion (best-effort)
        if body.new_sn and body.new_sn.strip() and body.new_sn.strip().lower() != (before["sn"] or "").lower():
            try:
                item_ids = current_row.get("item_ids") or []
                if item_ids:
                    await notion_service.remove_inventory_serials(item_ids[0], [before["sn"]] if before["sn"] else [])
                    # Il nuovo seriale rimane FUORI inventario (è uscito) — quindi non lo aggiungiamo indietro.
            except Exception as e:
                logger.warning(f"inventario colonna16 aggiornamento fallito: {e}")

        # 7) Audit
        await db.audit_logs.insert_one({
            "at": datetime.now(timezone.utc).isoformat(),
            "actor_id": str(current.get("_id")),
            "actor_username": current.get("username"),
            "action": "retro.shipment.update",
            "target": tracker_page_id,
            "meta": {
                "reason": body.reason,
                "before": before,
                "after": after,
                "date_operazione": after.get("date"),
                "date_registrazione": datetime.now(timezone.utc).isoformat(),
            },
        })
        notion_service.invalidate_inventory_cache()
        email_sent = False
        if send_email_fn:
            email_sent = await _send_retro_email_if_enabled(db, send_email_fn, "spedizione", before, after, body.reason, current.get("username") or "")
        return {"ok": True, "before": before, "after": after, "email_sent": email_sent}

    @router.patch("/arrivo/{receipt_page_id}")
    async def patch_arrivo(receipt_page_id: str, body: ArrivoPatchBody, current=Depends(deps.get_current_user)):
        _require_retro(current)
        if not (body.reason or "").strip():
            raise HTTPException(400, "Motivazione obbligatoria")

        try:
            recs = await notion_service.list_receipts_all()
        except Exception as e:
            raise HTTPException(502, f"Errore lettura entrate: {e}")
        current_row = next((r for r in recs if r.get("id") == receipt_page_id), None)
        if not current_row:
            raise HTTPException(404, "Riga arrivo non trovata su Notion")

        before = {"sn": current_row.get("sn") or current_row.get("item_name"),
                  "quantity": current_row.get("quantity"),
                  "date": current_row.get("date")}
        after = dict(before)

        try:
            await notion_service.update_receipt_row(
                receipt_page_id,
                new_sn=(body.new_sn.strip() if body.new_sn else None),
                new_qty=body.new_quantity,
                new_date=None,  # F14 §3
            )
        except Exception as e:
            raise HTTPException(502, f"Aggiornamento arrivo fallito: {e}")

        if body.new_sn: after["sn"] = body.new_sn.strip()
        if body.new_quantity is not None: after["quantity"] = body.new_quantity

        # Se cambia il seriale sul receipt → aggiorna colonna 16 Inventario
        if body.new_sn and (before["sn"] or "").lower() != body.new_sn.strip().lower():
            try:
                item_ids = current_row.get("item_ids") or []
                if item_ids:
                    if before["sn"]:
                        await notion_service.remove_inventory_serials(item_ids[0], [before["sn"]])
                    await notion_service.update_inventory_serials(item_ids[0], [body.new_sn.strip()])
            except Exception as e:
                logger.warning(f"inventario col16 update fallito: {e}")

        await db.audit_logs.insert_one({
            "at": datetime.now(timezone.utc).isoformat(),
            "actor_id": str(current.get("_id")),
            "actor_username": current.get("username"),
            "action": "retro.arrivo.update",
            "target": receipt_page_id,
            "meta": {
                "reason": body.reason,
                "before": before,
                "after": after,
                "date_registrazione": datetime.now(timezone.utc).isoformat(),
            },
        })
        notion_service.invalidate_inventory_cache()
        email_sent = False
        if send_email_fn:
            email_sent = await _send_retro_email_if_enabled(db, send_email_fn, "arrivo", before, after, body.reason, current.get("username") or "")
        return {"ok": True, "before": before, "after": after, "email_sent": email_sent}

    @router.post("/cancel/{tipo}/{page_id}")
    async def cancel_op(tipo: str, page_id: str, body: CancelBody, current=Depends(deps.get_current_user)):
        """Annullamento: archivia la pagina Notion (soft-delete) + audit. Storico preservato."""
        _require_retro(current)
        if not (body.reason or "").strip():
            raise HTTPException(400, "Motivazione obbligatoria")
        if tipo not in ("spedizione", "arrivo"):
            raise HTTPException(400, "tipo non valido")
        try:
            await notion_service.archive_page(page_id)
        except Exception as e:
            raise HTTPException(502, f"Archiviazione fallita: {e}")
        await db.audit_logs.insert_one({
            "at": datetime.now(timezone.utc).isoformat(),
            "actor_id": str(current.get("_id")),
            "actor_username": current.get("username"),
            "action": f"retro.{tipo}.cancel",
            "target": page_id,
            "meta": {
                "reason": body.reason,
                "date_registrazione": datetime.now(timezone.utc).isoformat(),
            },
        })
        notion_service.invalidate_inventory_cache()
        return {"ok": True}

    return router
