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
                # F14 (20/02) — priorità evento specifico `retroattivita`. Se non definito
                # dal destinatario, fallback su `spedizioni`/`arrivi` (retro-compat).
                events = r.get("events") or {}
                if "retroattivita" in events:
                    if not events.get("retroattivita"):
                        continue
                else:
                    ev_key = "spedizioni" if tipo == "spedizione" else "arrivi"
                    if not events.get(ev_key, True):
                        continue
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


class AddItemBody(BaseModel):
    """F14 §2-4 — Aggiungi wallbox dimenticata a un tracker/receipt esistente.
    Non crea una nuova riga: aggiorna in-place SN (title) + Quantità del record esistente."""
    model_config = ConfigDict(extra="ignore")
    reason: str
    new_sn: str
    new_qr_code: Optional[str] = None


class AddAccessoryBody(BaseModel):
    """F15 — Aggiungi ACCESSORIO dimenticato alla stessa operazione (spedizione/arrivo).
    Crea una nuova riga tracker/receipt per il prodotto accessorio con lo stesso contesto
    (data, cliente/fornitore, operatore) — riutilizza le funzioni di create già esistenti.
    Rispetta il tipo_gestione: 'a_seriale' richiede `serial`, 'a_quantita' richiede `quantity`."""
    model_config = ConfigDict(extra="ignore")
    reason: str
    product_page_id: str
    quantity: float = 1
    serial: Optional[str] = None
    qr_code: Optional[str] = None


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
        """Annullamento: RIPRISTINA effetti su magazzino + archivia pagina Notion (soft-delete) + audit.
        Riuso funzioni esistenti (update/remove_inventory_serials, remove_shipment_from_order, archive_page)."""
        _require_retro(current)
        if not (body.reason or "").strip():
            raise HTTPException(400, "Motivazione obbligatoria")
        if tipo not in ("spedizione", "arrivo"):
            raise HTTPException(400, "tipo non valido")

        # 1) Carica il record esistente per estrarre gli effetti da annullare
        try:
            rows = await (notion_service.list_exits() if tipo == "spedizione" else notion_service.list_receipts_all())
        except Exception as e:
            raise HTTPException(502, f"Errore lettura record: {e}")
        row = next((r for r in rows if r.get("id") == page_id), None)
        if not row:
            raise HTTPException(404, "Record non trovato")

        sn_list = notion_service._parse_serials(row.get("sn") or "")
        product_page_id = (row.get("item_ids") or [None])[0]
        cliente = row.get("cliente") or ""
        qty = row.get("quantity")

        # 2) Ripristino magazzino (riuso funzioni esistenti)
        try:
            if tipo == "spedizione":
                # Rimetti i SN nell'Inventario col.16 (non-op se già presenti)
                if product_page_id and sn_list:
                    await notion_service.update_inventory_serials(product_page_id, sn_list)
                # Rimuovi SN+QR dall'ordine Eliostech (se collegato)
                order_page_id = None
                qr_codes: List[str] = []
                if cliente and sn_list:
                    try:
                        # Recupera QR associati per rimozione dall'ordine
                        for sn in sn_list:
                            qr_doc = await db.qr_associations.find_one({"serial_lower": sn.lower(), "active": True})
                            if qr_doc and qr_doc.get("qr_code"):
                                qr_codes.append(qr_doc["qr_code"])
                        order_info = await notion_service.find_order_by_structure(cliente)
                        if order_info.get("status") == "found":
                            order_page_id = order_info.get("id")
                            await notion_service.remove_shipment_from_order(order_page_id, sn_list, qr_codes)
                    except Exception as e:
                        logger.warning(f"remove_shipment_from_order fallito (non blocca cancel): {e}")
                # Disattiva QR associations
                if sn_list:
                    for sn in sn_list:
                        await db.qr_associations.update_many(
                            {"serial_lower": sn.lower(), "active": True},
                            {"$set": {"active": False, "deactivated_at": datetime.now(timezone.utc).isoformat(), "deactivated_by": current.get("username"), "deactivated_reason": "retro.cancel"}},
                        )
            else:  # arrivo
                # Rimuovi SN dalla col.16 Inventario (annulla l'ingresso)
                if product_page_id and sn_list:
                    await notion_service.remove_inventory_serials(product_page_id, sn_list)
        except HTTPException:
            raise
        except Exception as e:
            raise HTTPException(502, f"Ripristino inventario fallito: {e}")

        # 3) Archivia la pagina Notion (storico preservato, non elimina dati)
        try:
            await notion_service.archive_page(page_id)
        except Exception as e:
            raise HTTPException(502, f"Archiviazione fallita: {e}")

        # 4) Audit completo (riuso collection esistente)
        await db.audit_logs.insert_one({
            "at": datetime.now(timezone.utc).isoformat(),
            "actor_id": str(current.get("_id")),
            "actor_username": current.get("username"),
            "action": f"retro.{tipo}.cancel",
            "target": page_id,
            "meta": {
                "reason": body.reason,
                "date": row.get("date"),
                "cliente": cliente,
                "fornitore": row.get("fornitore"),
                "product_name": row.get("item_name") or (row.get("item_names") or [None])[0],
                "product_page_id": product_page_id,
                "quantity": qty,
                "serials": sn_list,
                "sn_title": row.get("sn"),
                "date_registrazione": datetime.now(timezone.utc).isoformat(),
            },
        })

        notion_service.invalidate_inventory_cache()

        email_sent = False
        if send_email_fn:
            email_sent = await _send_retro_email_if_enabled(
                db, send_email_fn, tipo,
                {"sn": row.get("sn"), "quantity": qty, "cliente": cliente},
                {"cancelled": True, "sn": row.get("sn"), "quantity": qty},
                body.reason, current.get("username") or "",
            )
        return {"ok": True, "cancelled": True, "restored_serials": sn_list, "email_sent": email_sent}

    @router.post("/shipment/{tracker_page_id}/add-item")
    async def add_forgotten_shipment(tracker_page_id: str, body: AddItemBody, current=Depends(deps.get_current_user)):
        """F14 §2-11 — Aggiungi Wallbox dimenticata a una Spedizione esistente.
        Aggiorna in-place: SN title (concatenato), Quantità. Aggiorna Eliostech Ordini (SN WB + CODICI QR)."""
        _require_retro(current)
        if not (body.reason or "").strip():
            raise HTTPException(400, "Motivazione obbligatoria")
        new_sn = (body.new_sn or "").strip()
        if not new_sn:
            raise HTTPException(400, "Nuovo seriale mancante")
        new_qr = (body.new_qr_code or "").strip()

        # 1) Carica il tracker row esistente
        try:
            exits = await notion_service.list_exits()
        except Exception as e:
            raise HTTPException(502, f"Errore lettura uscite: {e}")
        row = next((r for r in exits if r.get("id") == tracker_page_id), None)
        if not row:
            raise HTTPException(404, "Riga uscita non trovata")

        # 2) §16 — Validazioni COMPLETE identiche a spedizione normale
        current_sns = notion_service._parse_serials(row.get("sn") or "")
        current_sns_low = {s.lower() for s in current_sns}
        if new_sn.lower() in current_sns_low:
            raise HTTPException(409, f"SN {new_sn} già presente in questa spedizione")
        match = await notion_service.find_serial_in_inventory(new_sn)
        if not match:
            raise HTTPException(409, f"SN {new_sn} non disponibile in magazzino")
        # QR uniqueness
        if new_qr:
            existing_qr = await db.qr_associations.find_one({"qr_code_lower": new_qr.lower(), "active": True})
            if existing_qr and existing_qr.get("serial_lower") != new_sn.lower():
                raise HTTPException(409, f"QR {new_qr} già associato ad altro seriale ({existing_qr.get('serial')})")

        # 3) Aggiorna in-place il tracker Notion (SN title + Quantità = len(SN))
        new_sns = current_sns + [new_sn]
        new_title = "\n".join(new_sns)[:1990]
        new_qty = float(len(new_sns))
        before = {"sn": row.get("sn"), "quantity": row.get("quantity")}
        try:
            await notion_service.update_tracker_row(tracker_page_id, new_sn=new_title, new_qty=new_qty)
        except Exception as e:
            raise HTTPException(502, f"Aggiornamento tracker fallito: {e}")

        # 4) Rimuovi il nuovo SN dalla colonna 16 Inventario (best-effort)
        try:
            item_ids = row.get("item_ids") or []
            if item_ids:
                await notion_service.remove_inventory_serials(item_ids[0], [new_sn])
        except Exception as e:
            logger.warning(f"remove_inventory_serials fallito: {e}")

        # 5) Aggiorna Eliostech Ordini (append SN WB + CODICI QR + QTY WB=len(SN WB))
        structure = row.get("cliente") or ""
        order_updated_id: Optional[str] = None
        try:
            order = await notion_service.find_order_by_structure(structure)
            if order.get("status") == "found":
                order_updated_id = order.get("id")
                await notion_service.append_shipment_to_order(
                    order_updated_id, [new_sn], [new_qr] if new_qr else [],
                )
        except Exception as e:
            logger.warning(f"append order fallito: {e}")

        # 6) Persisti QR association
        if new_qr:
            await db.qr_associations.update_one(
                {"qr_code_lower": new_qr.lower()},
                {"$set": {
                    "qr_code": new_qr, "qr_code_lower": new_qr.lower(),
                    "serial": new_sn, "serial_lower": new_sn.lower(),
                    "structure": structure, "order_page_id": order_updated_id,
                    "associated_at": datetime.now(timezone.utc).isoformat(),
                    "associated_by": current.get("username"), "active": True,
                    "note": "retro-add-item",
                }},
                upsert=True,
            )

        # 7) Audit
        after = {"sn": new_title, "quantity": new_qty}
        await db.audit_logs.insert_one({
            "at": datetime.now(timezone.utc).isoformat(),
            "actor_id": str(current.get("_id")),
            "actor_username": current.get("username"),
            "action": "retro.shipment.add-item",
            "target": tracker_page_id,
            "meta": {
                "reason": body.reason, "before": before, "after": after,
                "added_sn": new_sn, "added_qr": new_qr or None,
                "order_page_id": order_updated_id,
                "date_registrazione": datetime.now(timezone.utc).isoformat(),
            },
        })
        notion_service.invalidate_inventory_cache()

        email_sent = False
        if send_email_fn:
            email_sent = await _send_retro_email_if_enabled(
                db, send_email_fn, "spedizione", before, {**after, "added_sn": new_sn, "added_qr": new_qr},
                body.reason, current.get("username") or "",
            )
        return {"ok": True, "new_qty": new_qty, "sn_list": new_sns, "email_sent": email_sent}

    @router.post("/arrivo/{receipt_page_id}/add-item")
    async def add_forgotten_arrivo(receipt_page_id: str, body: AddItemBody, current=Depends(deps.get_current_user)):
        """F14 §12-14 — Aggiungi Wallbox dimenticata a un Arrivo esistente.
        Aggiorna in-place il receipt Notion (Item title + Quantità) + colonna 16 Inventario."""
        _require_retro(current)
        if not (body.reason or "").strip():
            raise HTTPException(400, "Motivazione obbligatoria")
        new_sn = (body.new_sn or "").strip()
        if not new_sn:
            raise HTTPException(400, "Nuovo seriale mancante")

        try:
            recs = await notion_service.list_receipts_all()
        except Exception as e:
            raise HTTPException(502, f"Errore lettura entrate: {e}")
        row = next((r for r in recs if r.get("id") == receipt_page_id), None)
        if not row:
            raise HTTPException(404, "Riga arrivo non trovata")

        current_sns = notion_service._parse_serials(row.get("sn") or row.get("item_name") or "")
        current_sns_low = {s.lower() for s in current_sns}
        if new_sn.lower() in current_sns_low:
            raise HTTPException(409, f"SN {new_sn} già presente in questo arrivo")
        # Arrivo: seriale non deve essere già in magazzino
        match = await notion_service.find_serial_in_inventory(new_sn)
        if match is not None:
            raise HTTPException(409, f"SN {new_sn} già presente in magazzino")

        new_sns = current_sns + [new_sn]
        new_title = "\n".join(new_sns)[:1990]
        new_qty = float(len(new_sns))
        before = {"sn": row.get("sn"), "quantity": row.get("quantity")}
        try:
            await notion_service.update_receipt_row(receipt_page_id, new_sn=new_title, new_qty=new_qty)
        except Exception as e:
            raise HTTPException(502, f"Aggiornamento arrivo fallito: {e}")

        # Aggiorna Inventario colonna 16
        try:
            item_ids = row.get("item_ids") or []
            if item_ids:
                await notion_service.update_inventory_serials(item_ids[0], [new_sn])
        except Exception as e:
            logger.warning(f"update_inventory_serials fallito: {e}")

        after = {"sn": new_title, "quantity": new_qty}
        await db.audit_logs.insert_one({
            "at": datetime.now(timezone.utc).isoformat(),
            "actor_id": str(current.get("_id")),
            "actor_username": current.get("username"),
            "action": "retro.arrivo.add-item",
            "target": receipt_page_id,
            "meta": {
                "reason": body.reason, "before": before, "after": after,
                "added_sn": new_sn,
                "date_registrazione": datetime.now(timezone.utc).isoformat(),
            },
        })
        notion_service.invalidate_inventory_cache()
        return {"ok": True, "new_qty": new_qty, "sn_list": new_sns}

    # ─────────────────────────────────────────────────────────────────
    # F15 — Aggiungi Accessorio dimenticato (spedizione / arrivo)
    # ─────────────────────────────────────────────────────────────────

    async def _load_product_for_accessory(product_page_id: str):
        """Fetch product from Inventario Notion. Enforces tipo_gestione configurato."""
        from inventory_router import get_svc as _get_inv_svc
        svc = await _get_inv_svc(db)
        try:
            item = await svc.get_item(product_page_id)
        except Exception as e:
            raise HTTPException(502, f"Impossibile leggere il prodotto: {e}")
        if not item:
            raise HTTPException(404, "Prodotto non trovato in Inventario")
        tg = item.get("tipo_gestione")
        if tg not in ("a_seriale", "a_quantita"):
            raise HTTPException(400, f"Prodotto '{item.get('name')}' senza Tipo Gestione configurato")
        return svc, item

    @router.post("/shipment/{tracker_page_id}/add-accessory")
    async def add_forgotten_accessory_shipment(tracker_page_id: str, body: AddAccessoryBody, current=Depends(deps.get_current_user)):
        """F15 — Aggiungi ACCESSORIO dimenticato a una Spedizione esistente.
        Crea una NUOVA riga tracker con stesso contesto (cliente, data, taken_by) dell'operazione.
        Riuso di `create_pick` (stesso identico flusso del submit_checklist). Nessuna nuova spedizione."""
        _require_retro(current)
        if not (body.reason or "").strip():
            raise HTTPException(400, "Motivazione obbligatoria")

        # 1) Trova la spedizione originale per ereditare il contesto
        try:
            exits = await notion_service.list_exits()
        except Exception as e:
            raise HTTPException(502, f"Errore lettura uscite: {e}")
        row = next((r for r in exits if r.get("id") == tracker_page_id), None)
        if not row:
            raise HTTPException(404, "Riga uscita non trovata")

        structure = row.get("cliente") or ""
        data_uscita = row.get("date") or datetime.now(timezone.utc).date().isoformat()
        taken_by = row.get("taken_by") or (current.get("username") or "")

        # 2) Prodotto + validazione tipo_gestione
        svc, product = await _load_product_for_accessory(body.product_page_id)
        tg = product.get("tipo_gestione")
        product_name = product.get("name") or "—"

        serial = (body.serial or "").strip()
        qr = (body.qr_code or "").strip()
        qty = float(body.quantity or 0)

        if tg == "a_seriale":
            if not serial:
                raise HTTPException(400, "Seriale obbligatorio per prodotto A Seriale")
            # SN deve essere in Inventario (disponibile)
            match = await notion_service.find_serial_in_inventory(serial)
            if not match:
                raise HTTPException(409, f"SN {serial} non disponibile in magazzino")
            # QR univoco
            if qr:
                existing_qr = await db.qr_associations.find_one({"qr_code_lower": qr.lower(), "active": True})
                if existing_qr and existing_qr.get("serial_lower") != serial.lower():
                    raise HTTPException(409, f"QR {qr} già associato ad altro seriale")
            sn_title = serial
            qty_final = 1.0
        else:  # a_quantita
            if qty <= 0:
                raise HTTPException(400, "Quantità obbligatoria per prodotto A Quantità")
            sn_title = product_name
            qty_final = qty

        # 3) Crea NUOVA riga tracker (stesso identico flusso di submit_checklist)
        try:
            new_pid = await svc.create_pick(
                item_page_id=body.product_page_id,
                sn_title=sn_title,
                quantity=qty_final,
                cliente=structure,
                data_uscita=data_uscita,
                taken_by=taken_by,
            )
        except Exception as e:
            raise HTTPException(502, f"Creazione riga uscita fallita: {e}")

        # 4) Se A Seriale → rimuovi dalla colonna 16 Inventario
        if tg == "a_seriale":
            try:
                await svc.remove_inventory_serials(body.product_page_id, [serial])
            except Exception as e:
                logger.warning(f"remove_inventory_serials (accessory) fallito: {e}")

        # 5) Update Eliostech Ordini (solo se A Seriale e ordine trovato — coerente con submit_checklist)
        order_page_id_used: Optional[str] = None
        if tg == "a_seriale":
            try:
                order = await notion_service.find_order_by_structure(structure)
                if order.get("status") == "found":
                    order_page_id_used = order.get("id")
                    await notion_service.append_shipment_to_order(
                        order_page_id_used, [serial], [qr] if qr else [],
                    )
            except Exception as e:
                logger.warning(f"append order (accessory) fallito: {e}")

        # 6) QR association
        if qr and tg == "a_seriale":
            await db.qr_associations.update_one(
                {"qr_code_lower": qr.lower()},
                {"$set": {
                    "qr_code": qr, "qr_code_lower": qr.lower(),
                    "serial": serial, "serial_lower": serial.lower(),
                    "product_page_id": body.product_page_id,
                    "product_name": product_name,
                    "structure": structure,
                    "order_page_id": order_page_id_used,
                    "associated_at": datetime.now(timezone.utc).isoformat(),
                    "associated_by": current.get("username"),
                    "active": True,
                    "note": "retro-add-accessory",
                }},
                upsert=True,
            )

        # 7) Audit
        await db.audit_logs.insert_one({
            "at": datetime.now(timezone.utc).isoformat(),
            "actor_id": str(current.get("_id")),
            "actor_username": current.get("username"),
            "action": "retro.shipment.add-accessory",
            "target": tracker_page_id,
            "meta": {
                "reason": body.reason,
                "product_page_id": body.product_page_id,
                "product_name": product_name,
                "tipo_gestione": tg,
                "quantity": qty_final,
                "serial": serial or None,
                "qr_code": qr or None,
                "new_tracker_page_id": new_pid,
                "cliente": structure,
                "date": data_uscita,
                "order_page_id": order_page_id_used,
                "date_registrazione": datetime.now(timezone.utc).isoformat(),
            },
        })
        notion_service.invalidate_inventory_cache()

        email_sent = False
        if send_email_fn:
            email_sent = await _send_retro_email_if_enabled(
                db, send_email_fn, "spedizione",
                {"sn": row.get("sn"), "cliente": structure},
                {"sn": sn_title, "quantity": qty_final, "cliente": structure, "added_accessory": product_name, "added_qr": qr or None},
                body.reason, current.get("username") or "",
            )
        return {
            "ok": True,
            "new_tracker_page_id": new_pid,
            "product": product_name,
            "tipo_gestione": tg,
            "quantity": qty_final,
            "serial": serial or None,
            "qr_code": qr or None,
            "email_sent": email_sent,
        }

    @router.post("/arrivo/{receipt_page_id}/add-accessory")
    async def add_forgotten_accessory_arrivo(receipt_page_id: str, body: AddAccessoryBody, current=Depends(deps.get_current_user)):
        """F15 — Aggiungi ACCESSORIO dimenticato a un Arrivo esistente.
        Crea una NUOVA riga receipt con stesso contesto (data). Nessun nuovo arrivo."""
        _require_retro(current)
        if not (body.reason or "").strip():
            raise HTTPException(400, "Motivazione obbligatoria")

        try:
            recs = await notion_service.list_receipts_all()
        except Exception as e:
            raise HTTPException(502, f"Errore lettura entrate: {e}")
        row = next((r for r in recs if r.get("id") == receipt_page_id), None)
        if not row:
            raise HTTPException(404, "Riga arrivo non trovata")

        data_consegna = row.get("date") or datetime.now(timezone.utc).date().isoformat()

        svc, product = await _load_product_for_accessory(body.product_page_id)
        tg = product.get("tipo_gestione")
        product_name = product.get("name") or "—"

        serial = (body.serial or "").strip()
        qty = float(body.quantity or 0)

        if tg == "a_seriale":
            if not serial:
                raise HTTPException(400, "Seriale obbligatorio per prodotto A Seriale")
            match = await notion_service.find_serial_in_inventory(serial)
            if match is not None:
                raise HTTPException(409, f"SN {serial} già presente in magazzino")
            sn_title = serial
            qty_final = 1.0
        else:
            if qty <= 0:
                raise HTTPException(400, "Quantità obbligatoria per prodotto A Quantità")
            sn_title = product_name
            qty_final = qty

        try:
            new_pid = await svc.create_receipt(
                item_page_id=body.product_page_id,
                sn_title=sn_title,
                quantity=qty_final,
                data_consegna=data_consegna,
            )
        except Exception as e:
            raise HTTPException(502, f"Creazione riga arrivo fallita: {e}")

        # A Seriale → aggiungi alla colonna 16 Inventario
        if tg == "a_seriale":
            try:
                await svc.update_inventory_serials(body.product_page_id, [serial])
            except Exception as e:
                logger.warning(f"update_inventory_serials (accessory) fallito: {e}")

        await db.audit_logs.insert_one({
            "at": datetime.now(timezone.utc).isoformat(),
            "actor_id": str(current.get("_id")),
            "actor_username": current.get("username"),
            "action": "retro.arrivo.add-accessory",
            "target": receipt_page_id,
            "meta": {
                "reason": body.reason,
                "product_page_id": body.product_page_id,
                "product_name": product_name,
                "tipo_gestione": tg,
                "quantity": qty_final,
                "serial": serial or None,
                "new_receipt_page_id": new_pid,
                "date": data_consegna,
                "date_registrazione": datetime.now(timezone.utc).isoformat(),
            },
        })
        notion_service.invalidate_inventory_cache()

        email_sent = False
        if send_email_fn:
            email_sent = await _send_retro_email_if_enabled(
                db, send_email_fn, "arrivo",
                {"sn": row.get("sn")},
                {"sn": sn_title, "quantity": qty_final, "added_accessory": product_name},
                body.reason, current.get("username") or "",
            )
        return {
            "ok": True,
            "new_receipt_page_id": new_pid,
            "product": product_name,
            "tipo_gestione": tg,
            "quantity": qty_final,
            "serial": serial or None,
            "email_sent": email_sent,
        }

    return router
