"""F20 (26/02/2026) — Tool AI: schema JSON + dispatcher che chiama le funzioni REALI dell'app.

Regole:
- L'AI NON accede mai al DB direttamente. Chiama solo questi tool.
- I tool riutilizzano i servizi già presenti (notion_service, inventory_router, db.audit_logs, db.app_events).
- Tool operativi (execute_*) NON esistono qui: le operazioni modificative passano SEMPRE
  attraverso `ai_routes.execute_pending_operation` che invoca gli endpoint HTTP interni
  esistenti (submit_checklist, submit_arrivo, retro/*) con l'auth del user chiamante.
"""
from __future__ import annotations

import re
import logging
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

logger = logging.getLogger(__name__)


# ─── Schema OpenAI-compatible ────────────────────────────────────────────────
TOOLS_SCHEMA: List[Dict[str, Any]] = [
    {"type": "function", "function": {
        "name": "search_products",
        "description": "Cerca prodotti nell'inventario per nome, codice o categoria. Ritorna lista con name, code, quantity, tipo_gestione (a_seriale|a_quantita), unit, category.",
        "parameters": {"type": "object", "properties": {
            "query": {"type": "string", "description": "Testo di ricerca (nome/codice/categoria). Vuoto = tutti."},
            "low_stock_only": {"type": "boolean", "description": "Solo prodotti sotto soglia scorta"},
            "limit": {"type": "integer", "default": 20},
        }, "required": []}}},
    {"type": "function", "function": {
        "name": "get_product",
        "description": "Recupera un singolo prodotto per page_id o nome esatto.",
        "parameters": {"type": "object", "properties": {
            "page_id": {"type": "string"}, "name": {"type": "string"},
        }, "required": []}}},
    {"type": "function", "function": {
        "name": "check_serial_availability",
        "description": "Verifica se un seriale è ATTUALMENTE disponibile in inventario (non spedito). Ritorna {sn, available: bool, product: name, used_in_shipment?}.",
        "parameters": {"type": "object", "properties": {
            "serial": {"type": "string"},
        }, "required": ["serial"]}}},
    {"type": "function", "function": {
        "name": "search_shipments",
        "description": "Cerca spedizioni recenti. Filtri opzionali su cliente, prodotto, data.",
        "parameters": {"type": "object", "properties": {
            "cliente": {"type": "string"}, "product": {"type": "string"},
            "date_from": {"type": "string", "description": "YYYY-MM-DD"},
            "date_to": {"type": "string", "description": "YYYY-MM-DD"},
            "limit": {"type": "integer", "default": 20},
        }, "required": []}}},
    {"type": "function", "function": {
        "name": "search_arrivals",
        "description": "Cerca arrivi/receipts recenti. Filtri opzionali su prodotto, data.",
        "parameters": {"type": "object", "properties": {
            "product": {"type": "string"},
            "date_from": {"type": "string"}, "date_to": {"type": "string"},
            "limit": {"type": "integer", "default": 20},
        }, "required": []}}},
    {"type": "function", "function": {
        "name": "search_movements",
        "description": "Cerca movimenti (arrivi + spedizioni unificati) recenti.",
        "parameters": {"type": "object", "properties": {
            "product": {"type": "string"}, "limit": {"type": "integer", "default": 30},
        }, "required": []}}},
    {"type": "function", "function": {
        "name": "get_anomalies",
        "description": "Recupera le anomalie di magazzino rilevate dall'app (seriali duplicati, spediti-ma-disponibili, quantità incoerenti).",
        "parameters": {"type": "object", "properties": {
            "limit": {"type": "integer", "default": 30},
        }, "required": []}}},
    {"type": "function", "function": {
        "name": "search_logs",
        "description": "Cerca nel Registro Log applicativo (app_events).",
        "parameters": {"type": "object", "properties": {
            "category": {"type": "string", "enum": ["INVENTARIO", "ARRIVO", "SPEDIZIONE", "CANCELLAZIONE", "ANOMALIA", "AUTH", "NOTION", "RETRO", "AI"]},
            "user": {"type": "string"}, "product": {"type": "string"},
            "serial": {"type": "string"}, "status": {"type": "string"},
            "limit": {"type": "integer", "default": 30},
        }, "required": []}}},
    {"type": "function", "function": {
        "name": "get_dashboard_summary",
        "description": "Riepilogo KPI magazzino: totale prodotti, valore inventario, sotto scorta, esauriti, ultime attività.",
        "parameters": {"type": "object", "properties": {}, "required": []}}},
    {"type": "function", "function": {
        "name": "prepare_shipment",
        "description": "PREPARA una spedizione (SENZA eseguirla). Ritorna preview con validazione. La spedizione parte solo dopo conferma esplicita utente via execute_pending_operation.",
        "parameters": {"type": "object", "properties": {
            "product_name_or_code": {"type": "string"},
            "quantity": {"type": "number"},
            "serials": {"type": "array", "items": {"type": "string"}, "description": "Solo per prodotti A Seriale"},
            "cliente": {"type": "string"},
            "taken_by": {"type": "string", "description": "Persona che ha ritirato la merce"},
        }, "required": ["product_name_or_code", "cliente"]}}},
    {"type": "function", "function": {
        "name": "prepare_arrival",
        "description": "PREPARA un arrivo (SENZA eseguirlo). Ritorna preview con validazione.",
        "parameters": {"type": "object", "properties": {
            "product_name_or_code": {"type": "string"},
            "quantity": {"type": "number"},
            "serials": {"type": "array", "items": {"type": "string"}},
            "fornitore": {"type": "string"},
        }, "required": ["product_name_or_code"]}}},
]


# ─── Helpers ──────────────────────────────────────────────────────────────────
def _sanitize(v: Any, maxlen: int = 800) -> Any:
    if isinstance(v, str) and len(v) > maxlen:
        return v[:maxlen] + "…"
    return v


def _match_product(items: List[Dict[str, Any]], q: str) -> Optional[Dict[str, Any]]:
    ql = (q or "").strip().lower()
    if not ql:
        return None
    # exact code
    exact = next((i for i in items if (i.get("code") or "").lower() == ql), None)
    if exact: return exact
    # exact name
    exact = next((i for i in items if (i.get("name") or "").strip().lower() == ql), None)
    if exact: return exact
    # partial match
    return next((i for i in items if ql in (i.get("name") or "").lower() or ql in (i.get("code") or "").lower()), None)


# ─── Dispatcher ───────────────────────────────────────────────────────────────
async def dispatch_tool(db, svc, tool_name: str, args: Dict[str, Any], current_user: Dict[str, Any]) -> Dict[str, Any]:
    """Esegue un tool e ritorna il risultato JSON-serializable.
    `svc` = inventory_service (Notion/Local). `current_user` per audit."""
    try:
        if tool_name == "search_products":
            data = await svc.list_inventory()
            items = data.get("items") if isinstance(data, dict) else data
            items = items or []
            q = (args.get("query") or "").strip().lower()
            low = bool(args.get("low_stock_only"))
            out = []
            for it in items:
                name = it.get("name") or ""
                code = it.get("code") or ""
                cat = it.get("category") or ""
                qty = it.get("quantity") or 0
                thresh = it.get("low_stock_threshold") or 0
                if q and q not in name.lower() and q not in code.lower() and q not in cat.lower():
                    continue
                if low and qty > (thresh or 0):
                    continue
                out.append({
                    "page_id": it.get("id") or it.get("page_id"),
                    "name": name, "code": code, "category": cat,
                    "quantity": qty, "unit": it.get("unit"),
                    "tipo_gestione": it.get("tipo_gestione"),
                    "low_stock_threshold": thresh,
                })
            return {"items": out[: int(args.get("limit") or 20)], "total_found": len(out)}

        if tool_name == "get_product":
            data = await svc.list_inventory()
            items = (data.get("items") if isinstance(data, dict) else data) or []
            pid = (args.get("page_id") or "").strip()
            nm = (args.get("name") or "").strip()
            found = None
            if pid:
                found = next((i for i in items if (i.get("id") or i.get("page_id")) == pid), None)
            if not found and nm:
                found = _match_product(items, nm)
            if not found:
                return {"error": "not_found"}
            return {"product": {
                "page_id": found.get("id") or found.get("page_id"),
                "name": found.get("name"), "code": found.get("code"),
                "category": found.get("category"),
                "quantity": found.get("quantity"), "unit": found.get("unit"),
                "tipo_gestione": found.get("tipo_gestione"),
                "serials": found.get("serials") or [],
            }}

        if tool_name == "check_serial_availability":
            sn = (args.get("serial") or "").strip()
            if not sn:
                return {"error": "missing_serial"}
            data = await svc.list_inventory()
            items = (data.get("items") if isinstance(data, dict) else data) or []
            hit = None
            for it in items:
                for s in (it.get("serials") or []):
                    if str(s).strip().lower() == sn.lower():
                        hit = it; break
                if hit: break
            if hit:
                return {"serial": sn, "available": True, "product": hit.get("name"), "product_code": hit.get("code")}
            # Verifica se compare in una spedizione (già usato)
            try:
                exits = await svc.list_exits()
                match = next((e for e in exits if sn.lower() in (str(e.get("sn") or "")).lower()), None)
                if match:
                    return {"serial": sn, "available": False,
                            "used_in_shipment": {"id": match.get("id"), "date": match.get("date"),
                                                 "cliente": match.get("cliente"), "product": match.get("item_name")}}
            except Exception:
                pass
            return {"serial": sn, "available": False, "reason": "not_found_in_inventory"}

        if tool_name == "search_shipments":
            limit = int(args.get("limit") or 20)
            exits = await svc.list_exits(
                date_from=args.get("date_from"), date_to=args.get("date_to"),
            )
            cliente = (args.get("cliente") or "").strip().lower()
            product = (args.get("product") or "").strip().lower()
            out = []
            for e in exits:
                if cliente and cliente not in (str(e.get("cliente") or "").lower()): continue
                if product and product not in (str(e.get("item_name") or "").lower()): continue
                out.append({k: _sanitize(v) for k, v in e.items() if k in ("id", "date", "item_name", "sn", "quantity", "cliente", "taken_by", "unit")})
                if len(out) >= limit: break
            return {"items": out, "total_returned": len(out)}

        if tool_name == "search_arrivals":
            limit = int(args.get("limit") or 20)
            recs = await svc.list_receipts_all(date_from=args.get("date_from"), date_to=args.get("date_to"))
            product = (args.get("product") or "").strip().lower()
            out = []
            for r in recs:
                if product and product not in (str(r.get("item_name") or "").lower()): continue
                out.append({k: _sanitize(v) for k, v in r.items() if k in ("id", "date", "item_name", "sn", "quantity", "unit")})
                if len(out) >= limit: break
            return {"items": out, "total_returned": len(out)}

        if tool_name == "search_movements":
            limit = int(args.get("limit") or 30)
            recs = await svc.list_receipts_all()
            exits = await svc.list_exits()
            product = (args.get("product") or "").strip().lower()
            mv = []
            for r in recs:
                mv.append({"tipo": "arrivo", "date": r.get("date"), "item_name": r.get("item_name"),
                           "sn": r.get("sn"), "quantity": r.get("quantity")})
            for e in exits:
                mv.append({"tipo": "spedizione", "date": e.get("date"), "item_name": e.get("item_name"),
                           "sn": e.get("sn"), "quantity": e.get("quantity"), "cliente": e.get("cliente")})
            if product:
                mv = [m for m in mv if product in (str(m.get("item_name") or "").lower())]
            mv.sort(key=lambda x: x.get("date") or "", reverse=True)
            return {"items": mv[:limit], "total_returned": min(len(mv), limit)}

        if tool_name == "get_anomalies":
            limit = int(args.get("limit") or 30)
            docs = []
            async for d in db.anomalies.find({}).sort("at", -1).limit(limit):
                d.pop("_id", None)
                if isinstance(d.get("at"), datetime):
                    d["at"] = d["at"].isoformat()
                docs.append(d)
            return {"items": docs, "total_returned": len(docs)}

        if tool_name == "search_logs":
            limit = int(args.get("limit") or 30)
            q: Dict[str, Any] = {}
            if args.get("category"): q["category"] = args["category"].upper()
            if args.get("user"): q["user"] = {"$regex": re.escape(args["user"]), "$options": "i"}
            if args.get("product"): q["product"] = {"$regex": re.escape(args["product"]), "$options": "i"}
            if args.get("serial"): q["serial"] = {"$regex": re.escape(args["serial"]), "$options": "i"}
            if args.get("status"): q["status"] = args["status"].upper()
            docs = []
            async for d in db.app_events.find(q).sort("created_at", -1).limit(limit):
                d.pop("_id", None)
                if isinstance(d.get("created_at"), datetime):
                    d["created_at"] = d["created_at"].isoformat()
                docs.append(d)
            return {"items": docs, "total_returned": len(docs)}

        if tool_name == "get_dashboard_summary":
            data = await svc.list_inventory()
            items = (data.get("items") if isinstance(data, dict) else data) or []
            tot_products = len(items)
            low = [i for i in items if (i.get("quantity") or 0) <= (i.get("low_stock_threshold") or 0) and (i.get("quantity") or 0) > 0]
            empty = [i for i in items if (i.get("quantity") or 0) == 0]
            return {
                "total_products": tot_products,
                "low_stock": [{"name": i.get("name"), "quantity": i.get("quantity"), "threshold": i.get("low_stock_threshold")} for i in low[:15]],
                "empty": [{"name": i.get("name")} for i in empty[:15]],
                "total_low_stock": len(low), "total_empty": len(empty),
            }

        # ── Operazioni preparatorie (nessuna esecuzione — solo preview) ──
        if tool_name == "prepare_shipment":
            data = await svc.list_inventory()
            items = (data.get("items") if isinstance(data, dict) else data) or []
            p = _match_product(items, args.get("product_name_or_code") or "")
            if not p:
                return {"error": "product_not_found", "hint": "Il prodotto non esiste in inventario"}
            tg = p.get("tipo_gestione")
            qty = float(args.get("quantity") or 0)
            serials = [s.strip() for s in (args.get("serials") or []) if str(s or "").strip()]
            cliente = (args.get("cliente") or "").strip()
            taken_by = (args.get("taken_by") or current_user.get("username") or "").strip()
            if not cliente:
                return {"error": "missing_cliente"}
            errors: List[str] = []
            if tg == "a_seriale":
                if not serials:
                    return {"error": "missing_serials", "hint": "Prodotto A Seriale: fornisci almeno un seriale"}
                available_sns = {str(s).strip().lower() for s in (p.get("serials") or [])}
                for s in serials:
                    if s.lower() not in available_sns:
                        errors.append(f"SN '{s}' non disponibile in inventario")
                qty = float(len(serials))
            elif tg == "a_quantita":
                if qty <= 0:
                    return {"error": "missing_quantity", "hint": "Prodotto A Quantità: specifica quantity > 0"}
                current_qty = float(p.get("quantity") or 0)
                if qty > current_qty:
                    errors.append(f"Quantità richiesta ({qty}) > disponibile ({current_qty})")
            else:
                return {"error": "tipo_gestione_missing", "hint": f"Prodotto '{p.get('name')}' senza tipo_gestione configurato"}
            if errors:
                return {"validation_failed": True, "errors": errors,
                        "product": p.get("name"), "product_code": p.get("code"), "tipo_gestione": tg}
            preview = {
                "operation_type": "shipment",
                "product_page_id": p.get("id") or p.get("page_id"),
                "product_name": p.get("name"),
                "product_code": p.get("code"),
                "tipo_gestione": tg,
                "quantity": qty,
                "serials": serials,
                "cliente": cliente,
                "taken_by": taken_by or current_user.get("username"),
                "current_quantity_before": p.get("quantity"),
            }
            preview_id = f"AIOP-{datetime.now(timezone.utc).strftime('%Y%m%d%H%M%S')}-{abs(hash(str(preview))) % 100000:05d}"
            await db.ai_pending_ops.insert_one({
                "preview_id": preview_id,
                "user": current_user.get("username"),
                "user_id": str(current_user.get("_id")),
                "created_at": datetime.now(timezone.utc),
                "operation": preview,
                "status": "pending",
            })
            return {"preview_ready": True, "preview_id": preview_id, "summary": preview}

        if tool_name == "prepare_arrival":
            data = await svc.list_inventory()
            items = (data.get("items") if isinstance(data, dict) else data) or []
            p = _match_product(items, args.get("product_name_or_code") or "")
            if not p:
                return {"error": "product_not_found"}
            tg = p.get("tipo_gestione")
            qty = float(args.get("quantity") or 0)
            serials = [s.strip() for s in (args.get("serials") or []) if str(s or "").strip()]
            errors: List[str] = []
            if tg == "a_seriale":
                if not serials:
                    return {"error": "missing_serials"}
                existing = {str(s).strip().lower() for s in (p.get("serials") or [])}
                for s in serials:
                    if s.lower() in existing:
                        errors.append(f"SN '{s}' già presente in inventario")
                qty = float(len(serials))
            elif tg == "a_quantita":
                if qty <= 0:
                    return {"error": "missing_quantity"}
            else:
                return {"error": "tipo_gestione_missing"}
            if errors:
                return {"validation_failed": True, "errors": errors}
            preview = {
                "operation_type": "arrival",
                "product_page_id": p.get("id") or p.get("page_id"),
                "product_name": p.get("name"),
                "product_code": p.get("code"),
                "tipo_gestione": tg,
                "quantity": qty,
                "serials": serials,
                "fornitore": (args.get("fornitore") or "").strip() or None,
                "current_quantity_before": p.get("quantity"),
            }
            preview_id = f"AIOP-{datetime.now(timezone.utc).strftime('%Y%m%d%H%M%S')}-{abs(hash(str(preview))) % 100000:05d}"
            await db.ai_pending_ops.insert_one({
                "preview_id": preview_id,
                "user": current_user.get("username"),
                "user_id": str(current_user.get("_id")),
                "created_at": datetime.now(timezone.utc),
                "operation": preview,
                "status": "pending",
            })
            return {"preview_ready": True, "preview_id": preview_id, "summary": preview}

        return {"error": "unknown_tool", "tool": tool_name}
    except Exception as e:
        logger.exception(f"dispatch_tool({tool_name}) failed")
        return {"error": "tool_execution_failed", "message": str(e)[:200]}
