"""Inventory Local Service — DB-backed alternative to notion_service.

MIMICS EXACTLY the public interface of `notion_service` so that the rest of
the backend (server.py, admin_extra_routes.py) can switch at runtime between
the two via `inventory_router.get_svc(db)` based on
`settings.general.inventory_source` (`notion` | `gestionale`).

Design choices:
  - No cache needed (MongoDB is our source when active) — invalidate_inventory_cache() is a no-op.
  - `page_id` semantics: for local products it's the product's ULID/UUID string stored on the doc.
  - Same field names in returned items as notion_service.parse_item():
      {id, name, code, quantity, unit, category, tipo_gestione, url}
    For A Seriale products, `quantity` = count of available serials.
  - Serials live in `product_serials` collection with `status` = 'available' | 'shipped'.
  - Receipts (entrate) live in `local_receipts`, picks (uscite) in `local_picks`.
"""
from __future__ import annotations

import logging
import uuid
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

logger = logging.getLogger(__name__)

_db_ref = {"db": None}


def set_db(db) -> None:
    """Register the Motor DB handle (called once from server.py startup)."""
    _db_ref["db"] = db


def _db():
    if _db_ref["db"] is None:
        raise RuntimeError("inventory_local: DB non inizializzato")
    return _db_ref["db"]


def is_configured() -> bool:
    return _db_ref["db"] is not None


def invalidate_inventory_cache() -> None:
    """No-op — DB is authoritative, no in-memory cache to invalidate."""
    return None


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


async def _serial_counts(product_id: str) -> Dict[str, int]:
    """Return {available: N, shipped: N} for a serialized product."""
    db = _db()
    avail = await db.product_serials.count_documents({"product_id": product_id, "status": "available"})
    shipped = await db.product_serials.count_documents({"product_id": product_id, "status": "shipped"})
    return {"available": avail, "shipped": shipped}


def _product_to_item(doc: Dict[str, Any], available_qty: Optional[float] = None) -> Dict[str, Any]:
    """Convert a product doc from Mongo to the shared item shape."""
    tipo = doc.get("tipo_gestione") or None  # None → NON CONFIGURATO
    if tipo not in ("a_seriale", "a_quantita"):
        tipo = None
    return {
        "id": doc["id"],
        "name": doc.get("name") or "Senza nome",
        "code": doc.get("code") or "",
        "quantity": available_qty if available_qty is not None else (doc.get("quantity") or 0),
        "unit": doc.get("unit") or "pz",
        "category": doc.get("category"),
        "tipo_gestione": tipo,
        "url": None,  # nessun link Notion in modalità gestionale
    }


async def list_inventory(force_refresh: bool = False) -> List[Dict[str, Any]]:
    db = _db()
    out: List[Dict[str, Any]] = []
    async for doc in db.products.find({"active": {"$ne": False}}):
        if doc.get("tipo_gestione") == "a_seriale":
            c = await _serial_counts(doc["id"])
            item = _product_to_item(doc, available_qty=c["available"])
        else:
            item = _product_to_item(doc)
        out.append(item)
    return out


async def get_item(page_id: str) -> Dict[str, Any]:
    db = _db()
    doc = await db.products.find_one({"id": page_id})
    if not doc:
        raise RuntimeError(f"Prodotto locale non trovato: {page_id}")
    if doc.get("tipo_gestione") == "a_seriale":
        c = await _serial_counts(doc["id"])
        return _product_to_item(doc, available_qty=c["available"])
    return _product_to_item(doc)


async def update_tipo_gestione(page_id: str, tipo: str) -> None:
    if tipo not in ("a_seriale", "a_quantita"):
        raise ValueError("tipo must be 'a_seriale' or 'a_quantita'")
    _db()
    r = await _db().products.update_one(
        {"id": page_id},
        {"$set": {"tipo_gestione": tipo, "updated_at": _now_iso()}},
    )
    if r.matched_count == 0:
        raise RuntimeError(f"Prodotto non trovato: {page_id}")


async def update_inventory_serials(page_id: str, serials_to_add: List[str]) -> Dict[str, Any]:
    """No-op — nel gestionale i seriali vivono nella collection product_serials,
    già scritti da create_receipt. Manteniamo la stessa firma di notion_service
    per interfaccia uniforme."""
    return {"added": [], "prop_found": True}


async def remove_inventory_serials(page_id: str, serials_to_remove: List[str]) -> Dict[str, Any]:
    """No-op — analoga a update_inventory_serials."""
    return {"removed": list(serials_to_remove or []), "missing": [], "prop_found": True}


async def find_serial_in_inventory(sn: str) -> Optional[Dict[str, Any]]:
    """F13 — Parity con notion_service.find_serial_in_inventory.

    Nel gestionale locale, un seriale è disponibile se esiste in `product_serials`
    con status='available'. Restituisce il prodotto associato o None.
    """
    sn_clean = (sn or "").strip()
    if not sn_clean:
        return None
    db = _db()
    row = await db.product_serials.find_one({
        "serial_lower": sn_clean.lower(),
        "status": "available",
    })
    if not row:
        return None
    product = await db.products.find_one({"id": row["product_id"]})
    if not product:
        return None
    # Ricostruisci una forma "list_inventory" per uniformità con notion_service.
    avail = await db.product_serials.count_documents({
        "product_id": product["id"], "status": "available",
    })
    return {
        "id": product["id"],
        "name": product.get("name") or "Senza nome",
        "code": product.get("code") or "",
        "quantity": avail,
        "unit": product.get("unit") or "pz",
        "category": product.get("category"),
        "tipo_gestione": product.get("tipo_gestione"),
        "url": None,
        "serials": [row["serial"]],
    }


# ---------- Serials ----------

async def latest_serial_status(sn: str) -> Dict[str, Any]:
    """Return current status of a serial.

    Same contract as notion_service.latest_serial_status:
      - {"status": "unseen"}
      - {"status": "in_warehouse", "last": {receipt}, "receipt": {...}, "exit": {...|None}}
      - {"status": "out",          "last": {exit},    "receipt": {...|None}, "exit": {...}}
    """
    db = _db()
    sn_clean = (sn or "").strip()
    if not sn_clean:
        return {"status": "unseen"}
    row = await db.product_serials.find_one({"serial_lower": sn_clean.lower()})
    if not row:
        return {"status": "unseen"}
    product = await db.products.find_one({"id": row["product_id"]})
    last_receipt = None
    last_pick = None
    if row.get("last_receipt_at"):
        last_receipt = {
            "id": row.get("last_receipt_id"),
            "matched_serial": row["serial"],
            "date": row.get("last_receipt_date"),
            "created_time": row.get("last_receipt_at"),
            "item_ids": [row["product_id"]],
            "url": None,
        }
    if row.get("last_pick_at"):
        last_pick = {
            "id": row.get("last_pick_id"),
            "matched_serial": row["serial"],
            "cliente": row.get("last_pick_cliente"),
            "date": row.get("last_pick_date"),
            "created_time": row.get("last_pick_at"),
            "item_ids": [row["product_id"]],
            "url": None,
        }
    if row.get("status") == "available":
        return {"status": "in_warehouse", "last": last_receipt or {}, "receipt": last_receipt, "exit": last_pick}
    return {"status": "out", "last": last_pick or {}, "receipt": last_receipt, "exit": last_pick}


# ---------- Movements (create/rollback) ----------

async def create_receipt(
    item_page_id: str,
    sn_title: str,
    quantity: float,
    data_consegna: str,
) -> str:
    """Register an arrival on the local inventory.

    Behavior:
      - If the product is A Seriale: ensure a serial row exists (status=available)
        and update quantity is derived (count of available serials).
      - If A Quantità: increment product.quantity by `quantity`.
    Also persists a `local_receipts` row for history + Movimenti listing.
    Returns the receipt row id.
    """
    db = _db()
    prod = await db.products.find_one({"id": item_page_id})
    if not prod:
        raise RuntimeError(f"Prodotto locale non trovato: {item_page_id}")
    rid = str(uuid.uuid4())
    now = _now_iso()
    is_serial = prod.get("tipo_gestione") == "a_seriale"
    sn_clean = (sn_title or "").strip()

    if is_serial:
        # sn_title = seriale — 1 pezzo, upsert riga seriale come "available"
        if not sn_clean:
            raise RuntimeError("Seriale mancante per prodotto A Seriale")
        await db.product_serials.update_one(
            {"serial_lower": sn_clean.lower(), "product_id": item_page_id},
            {"$set": {
                "product_id": item_page_id,
                "serial": sn_clean,
                "serial_lower": sn_clean.lower(),
                "status": "available",
                "last_receipt_id": rid,
                "last_receipt_at": now,
                "last_receipt_date": data_consegna,
                "updated_at": now,
            },
             "$setOnInsert": {"created_at": now}},
            upsert=True,
        )
    else:
        # A Quantità: incrementa quantity
        await db.products.update_one(
            {"id": item_page_id},
            {"$inc": {"quantity": float(quantity or 0)}, "$set": {"updated_at": now}},
        )

    await db.local_receipts.insert_one({
        "id": rid,
        "product_id": item_page_id,
        "product_name": prod.get("name"),
        "sn": sn_clean if is_serial else (prod.get("name") or ""),
        "quantity": 1 if is_serial else float(quantity or 0),
        "data_consegna": data_consegna,
        "unit": prod.get("unit") or "pz",
        "created_at": now,
    })
    return rid


async def create_pick(
    item_page_id: str,
    sn_title: str,
    quantity: float,
    cliente: Optional[str],
    data_uscita: str,
    taken_by: Optional[str] = None,
) -> str:
    """Register a shipment (uscita) on the local inventory.

    - A Seriale: mark serial as 'shipped'.
    - A Quantità: decrement product.quantity.
    """
    db = _db()
    prod = await db.products.find_one({"id": item_page_id})
    if not prod:
        raise RuntimeError(f"Prodotto locale non trovato: {item_page_id}")
    pid = str(uuid.uuid4())
    now = _now_iso()
    is_serial = prod.get("tipo_gestione") == "a_seriale"
    sn_clean = (sn_title or "").strip()

    if is_serial:
        if not sn_clean:
            raise RuntimeError("Seriale mancante per prodotto A Seriale")
        r = await db.product_serials.update_one(
            {"serial_lower": sn_clean.lower(), "product_id": item_page_id, "status": "available"},
            {"$set": {
                "status": "shipped",
                "last_pick_id": pid,
                "last_pick_at": now,
                "last_pick_date": data_uscita,
                "last_pick_cliente": cliente,
                "last_pick_taken_by": taken_by,
                "updated_at": now,
            }},
        )
        if r.matched_count == 0:
            # o non esiste o già shipped: rifiuta
            raise RuntimeError(f"Seriale {sn_clean} non disponibile")
    else:
        # decrementa quantity (min 0)
        r = await db.products.find_one_and_update(
            {"id": item_page_id, "quantity": {"$gte": float(quantity or 0)}},
            {"$inc": {"quantity": -float(quantity or 0)}, "$set": {"updated_at": now}},
        )
        if not r:
            raise RuntimeError("Quantità non disponibile")

    await db.local_picks.insert_one({
        "id": pid,
        "product_id": item_page_id,
        "product_name": prod.get("name"),
        "sn": sn_clean if is_serial else (prod.get("name") or ""),
        "quantity": 1 if is_serial else float(quantity or 0),
        "cliente": cliente,
        "taken_by": taken_by,
        "data_uscita": data_uscita,
        "unit": prod.get("unit") or "pz",
        "created_at": now,
    })
    return pid


async def archive_page(page_id: str) -> None:
    """Rollback a partially-created receipt/pick. `page_id` = receipt or pick id."""
    db = _db()
    # Prova a rimuovere sia da receipts che da picks (uno solo esisterà)
    r_recv = await db.local_receipts.find_one({"id": page_id})
    if r_recv:
        await db.local_receipts.delete_one({"id": page_id})
        prod_id = r_recv["product_id"]
        prod = await db.products.find_one({"id": prod_id})
        if prod and prod.get("tipo_gestione") == "a_quantita":
            await db.products.update_one(
                {"id": prod_id},
                {"$inc": {"quantity": -float(r_recv.get("quantity") or 0)}},
            )
        elif prod:
            # per il seriale, torna a "non presente" (rimuovi la riga se era stata creata da questo receipt)
            await db.product_serials.update_one(
                {"last_receipt_id": page_id},
                {"$unset": {"last_receipt_id": "", "last_receipt_at": "", "last_receipt_date": ""}},
            )
        return
    r_pick = await db.local_picks.find_one({"id": page_id})
    if r_pick:
        await db.local_picks.delete_one({"id": page_id})
        prod_id = r_pick["product_id"]
        prod = await db.products.find_one({"id": prod_id})
        if prod and prod.get("tipo_gestione") == "a_quantita":
            await db.products.update_one(
                {"id": prod_id},
                {"$inc": {"quantity": float(r_pick.get("quantity") or 0)}},
            )
        elif prod:
            # ripristina seriale come available
            await db.product_serials.update_one(
                {"last_pick_id": page_id},
                {"$set": {"status": "available"},
                 "$unset": {"last_pick_id": "", "last_pick_at": "", "last_pick_date": "", "last_pick_cliente": "", "last_pick_taken_by": ""}},
            )


# ---------- Movimenti listings ----------

async def list_receipts_all(date_from: Optional[str] = None, date_to: Optional[str] = None) -> List[Dict[str, Any]]:
    db = _db()
    q: Dict[str, Any] = {}
    if date_from:
        q.setdefault("data_consegna", {})["$gte"] = date_from
    if date_to:
        q.setdefault("data_consegna", {})["$lte"] = date_to
    out: List[Dict[str, Any]] = []
    async for row in db.local_receipts.find(q).sort("data_consegna", -1):
        out.append({
            "id": row.get("id"),
            "sn": row.get("sn"),
            "quantity": row.get("quantity"),
            "date": row.get("data_consegna"),
            "item_ids": [row.get("product_id")] if row.get("product_id") else [],
            "item_name": row.get("product_name"),
            "unit": row.get("unit") or "pz",
            "created_time": row.get("created_at"),
        })
    return out


async def list_exits(date_from: Optional[str] = None, date_to: Optional[str] = None) -> List[Dict[str, Any]]:
    db = _db()
    q: Dict[str, Any] = {}
    if date_from:
        q.setdefault("data_uscita", {})["$gte"] = date_from
    if date_to:
        q.setdefault("data_uscita", {})["$lte"] = date_to
    out: List[Dict[str, Any]] = []
    async for row in db.local_picks.find(q).sort("data_uscita", -1):
        out.append({
            "id": row.get("id"),
            "sn": row.get("sn"),
            "cliente": row.get("cliente"),
            "taken_by": row.get("taken_by"),
            "quantity": row.get("quantity"),
            "date": row.get("data_uscita"),
            "item_ids": [row.get("product_id")] if row.get("product_id") else [],
            "item_names": [row.get("product_name")] if row.get("product_name") else [],
            "item_name": row.get("product_name"),
            "unit": row.get("unit") or "pz",
            "category": None,
            "url": None,
            "created_time": row.get("created_at"),
        })
    return out
