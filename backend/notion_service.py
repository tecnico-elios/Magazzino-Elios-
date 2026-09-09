"""Notion API client for the INVENTARIO database.

The Notion DB has 3 data sources:
  - "Inventario"        (materials, with QTA in magazzino as a FORMULA)
  - "Inventory Tracker" (outgoing picks — we CREATE rows here to record shipments)
  - "Inventory Receipts"(incoming — read-only here)

Because QTA in magazzino is a formula (Initial Stock + rollup(receipts) - rollup(picks)),
we NEVER write to it directly. Instead, we create a new Inventory Tracker row per
shipment, and Notion recomputes the available quantity automatically.
"""
import os
import time
import logging
import re
import httpx
from typing import List, Dict, Any, Optional

logger = logging.getLogger(__name__)

NOTION_TOKEN = os.environ.get("NOTION_TOKEN", "")
NOTION_INVENTARIO_DS_ID = os.environ.get("NOTION_INVENTARIO_DS_ID", "")
NOTION_TRACKER_DS_ID = os.environ.get("NOTION_TRACKER_DS_ID", "")
NOTION_RECEIPTS_DS_ID = os.environ.get("NOTION_RECEIPTS_DS_ID", "")
NOTION_ORDINI_DS_ID = os.environ.get("NOTION_ORDINI_DS_ID", "")
# F14 — Nome esatto del campo (seconda colonna) su cui matchare la struttura in "Eliostech Ordini".
NOTION_ORDINE_STRUCTURE_FIELD = os.environ.get("NOTION_ORDINE_STRUCTURE_FIELD", "Ragione sociale")
NOTION_ORDINE_SN_PROP = "SN WB"
NOTION_ORDINE_QR_PROP = "CODICI QR"
NOTION_VERSION = os.environ.get("NOTION_VERSION", "2025-09-03")
NOTION_BASE = "https://api.notion.com/v1"

# Serials in Inventory Receipts titles can be separated by any of: , . ; whitespace, newlines
_SN_SEP_RE = re.compile(r"[,.;\s]+")

# Short-lived in-memory cache for inventory list. TEMPORARY — Notion remains the source
# of truth. Every write path (submit_checklist) calls get_item()/lookup_* which do NOT
# use this cache, so authoritative checks are always live.
_INVENTORY_CACHE_TTL = 60  # seconds
_inv_cache: Dict[str, Any] = {"data": None, "at": 0.0}


def invalidate_inventory_cache() -> None:
    _inv_cache["data"] = None
    _inv_cache["at"] = 0.0


def _parse_serials(text: str) -> List[str]:
    """Split a Receipts title into individual serial tokens.
    Handles separators: ',', '.', ';', spaces, newlines. Trims and drops empties."""
    if not text:
        return []
    return [s for s in _SN_SEP_RE.split(text.strip()) if s]


def is_configured() -> bool:
    return bool(NOTION_TOKEN and NOTION_INVENTARIO_DS_ID)


def _headers() -> Dict[str, str]:
    return {
        "Authorization": f"Bearer {NOTION_TOKEN}",
        "Notion-Version": NOTION_VERSION,
        "Content-Type": "application/json",
    }


def _plain_text(prop: Optional[Dict[str, Any]]) -> str:
    if not prop:
        return ""
    t = prop.get("type")
    if t == "title":
        return "".join(x.get("plain_text", "") for x in prop.get("title", []))
    if t == "rich_text":
        return "".join(x.get("plain_text", "") for x in prop.get("rich_text", []))
    return ""


def _get_prop(props: Dict[str, Any], *names: str) -> Optional[Dict[str, Any]]:
    lower = {k.lower(): k for k in props.keys()}
    for n in names:
        real = lower.get(n.lower())
        if real:
            return props[real]
    return None


def parse_item(page: Dict[str, Any]) -> Dict[str, Any]:
    props = page.get("properties", {})
    name = _plain_text(_get_prop(props, "Nome prodotto", "Materiale", "Name"))
    code = _plain_text(_get_prop(props, "Codice prodotto", "Codice", "Code"))

    # F13 — Availability SSOT: leggi la colonna 16 "SN /codice" dell'Inventario.
    # Questa è ora l'UNICA fonte per determinare la disponibilità di un seriale.
    sn_prop = _get_prop(props, "SN /codice", "SN / CODICI", "SN /CODICI", "SN/codice")
    serials_list = _parse_serials(_plain_text(sn_prop)) if sn_prop else []

    qty_prop = _get_prop(props, "QTA in magazzino", "Quantità", "Quantita", "Quantity")
    quantity: Optional[float] = None
    if qty_prop:
        t = qty_prop.get("type")
        if t == "number":
            quantity = qty_prop.get("number")
        elif t == "formula":
            f = qty_prop.get("formula", {}) or {}
            if f.get("type") == "number":
                quantity = f.get("number")

    unit_prop = _get_prop(props, "Unità", "Unita", "Unit")
    unit: Optional[str] = None
    if unit_prop:
        t = unit_prop.get("type")
        if t == "select":
            u = unit_prop.get("select") or {}
            unit = u.get("name")
        elif t == "rich_text":
            unit = _plain_text(unit_prop) or None

    cat_prop = _get_prop(props, "Categoria", "Category")
    category: Optional[str] = None
    if cat_prop and cat_prop.get("type") == "select":
        c = cat_prop.get("select") or {}
        category = c.get("name")

    # F5: Tipo Gestione — Single Source of Truth (Notion Select).
    # Notion actual property name is "Tipo gestione" (lowercase g). Accept both cases.
    tg_prop = _get_prop(props, "Tipo gestione", "Tipo Gestione")
    tipo_gestione: Optional[str] = None  # None = NON CONFIGURATO
    if tg_prop and tg_prop.get("type") == "select":
        sel = tg_prop.get("select") or {}
        sel_name = (sel.get("name") or "").strip()
        # Accept exact Italian labels + common variants (accented vs unaccented)
        low = sel_name.lower().replace("à", "a").replace("è", "e")
        if low == "a seriale":
            tipo_gestione = "a_seriale"
        elif low == "a quantita":
            tipo_gestione = "a_quantita"

    return {
        "id": page["id"],
        "name": name or "Senza nome",
        "code": code or "",
        "quantity": quantity if quantity is not None else 0,
        "unit": unit or "pz",
        "category": category,
        "tipo_gestione": tipo_gestione,
        "url": page.get("url"),
        # F13 — seriali disponibili in magazzino (colonna 16 Inventario Notion).
        # Fonte UNICA per la verifica di disponibilità.
        "serials": serials_list,
    }


async def update_tipo_gestione(page_id: str, tipo: str) -> None:
    """Update Notion Inventario `Tipo gestione` select property.
    `tipo` must be exactly 'a_seriale' or 'a_quantita'. Writes DIRECTLY to Notion —
    Notion remains SSOT. Invalidates cache on success."""
    if tipo not in ("a_seriale", "a_quantita"):
        raise ValueError("tipo must be 'a_seriale' or 'a_quantita'")
    if not NOTION_TOKEN or not page_id:
        raise RuntimeError("Notion non configurato")
    name = "A Seriale" if tipo == "a_seriale" else "A Quantità"
    url = f"{NOTION_BASE}/pages/{page_id}"
    body = {"properties": {"Tipo gestione": {"select": {"name": name}}}}
    async with httpx.AsyncClient(timeout=20) as client:
        resp = await client.patch(url, headers=_headers(), json=body)
        if resp.status_code >= 400:
            logger.error(
                f"Notion update_tipo_gestione failed: {resp.status_code} {resp.text[:300]}"
            )
            resp.raise_for_status()
    invalidate_inventory_cache()


# Nome esatto della colonna 16 dell'Inventario Notion (SN / codici seriali).
INVENTARIO_SN_PROP = "SN /codice"


async def update_inventory_serials(page_id: str, serials_to_add: List[str]) -> None:
    """Aggiunge nuovi seriali alla colonna `SN /codice` dell'Inventario Notion
    (colonna 16, tipo rich_text). Preserva i seriali già presenti, evita duplicati.
    Non modifica la struttura di Notion, tocca solo il valore della cella.

    Chiamata da submit_arrivo dopo CONFERMA ARRIVO — F8 §3/§13.
    """
    if not NOTION_TOKEN or not page_id:
        raise RuntimeError("Notion non configurato")
    new_clean = [s.strip() for s in (serials_to_add or []) if s and s.strip()]
    if not new_clean:
        return
    get_url = f"{NOTION_BASE}/pages/{page_id}"
    async with httpx.AsyncClient(timeout=15) as client:
        r = await client.get(get_url, headers=_headers())
        if r.status_code >= 400:
            logger.warning(f"update_inventory_serials GET failed {r.status_code}: {r.text[:200]}")
            r.raise_for_status()
        page = r.json()
    props = page.get("properties", {})
    sn_prop = _get_prop(props, INVENTARIO_SN_PROP, "SN / CODICI", "SN /CODICI", "SN/codice", "SN")
    current_text = _plain_text(sn_prop) if sn_prop else ""
    existing = _parse_serials(current_text)
    existing_lower = {e.lower() for e in existing}
    to_append = [s for s in new_clean if s.lower() not in existing_lower]
    if not to_append:
        return
    merged = existing + to_append
    new_text = "\n".join(merged)
    body = {
        "properties": {
            INVENTARIO_SN_PROP: {
                "rich_text": [{"type": "text", "text": {"content": new_text[:1990]}}],
            }
        }
    }
    patch_url = f"{NOTION_BASE}/pages/{page_id}"
    async with httpx.AsyncClient(timeout=20) as client:
        resp = await client.patch(patch_url, headers=_headers(), json=body)
        if resp.status_code >= 400:
            logger.error(f"update_inventory_serials PATCH failed: {resp.status_code} {resp.text[:300]}")
            resp.raise_for_status()
    invalidate_inventory_cache()


async def remove_inventory_serials(page_id: str, serials_to_remove: List[str]) -> Dict[str, Any]:
    """Rimuove seriali dalla colonna `SN /codice` dell'Inventario Notion.
    Chiamata da submit_shipment dopo CONFERMA SPEDIZIONE — F8 §18.

    Returns: {"removed": [sn...], "missing": [sn...], "prop_found": bool}
    Raises: httpx.HTTPStatusError se Notion risponde >= 400 (P0 fix — errore visibile).
    """
    if not NOTION_TOKEN or not page_id:
        raise RuntimeError("Notion non configurato")
    rm_lower = {(s or "").strip().lower() for s in (serials_to_remove or []) if (s or "").strip()}
    if not rm_lower:
        return {"removed": [], "missing": [], "prop_found": True}
    get_url = f"{NOTION_BASE}/pages/{page_id}"
    async with httpx.AsyncClient(timeout=15) as client:
        r = await client.get(get_url, headers=_headers())
        if r.status_code >= 400:
            logger.error(f"remove_inventory_serials GET failed: {r.status_code} {r.text[:300]}")
            r.raise_for_status()
        page = r.json()
    props = page.get("properties", {})
    sn_prop = _get_prop(props, INVENTARIO_SN_PROP, "SN / CODICI", "SN /CODICI", "SN/codice", "SN")
    if not sn_prop:
        logger.warning(f"remove_inventory_serials: colonna SN/codice non trovata su page {page_id}")
        return {"removed": [], "missing": list(rm_lower), "prop_found": False}
    existing = _parse_serials(_plain_text(sn_prop))
    existing_lower = {s.lower() for s in existing}
    kept = [s for s in existing if s.lower() not in rm_lower]
    removed = [s for s in existing if s.lower() in rm_lower]
    missing = [s for s in rm_lower if s not in existing_lower]
    if len(kept) == len(existing):
        # Nessun seriale corrispondeva. Log esplicito ma NON è un errore Notion.
        return {"removed": [], "missing": list(rm_lower), "prop_found": True}
    new_text = "\n".join(kept)
    body = {"properties": {INVENTARIO_SN_PROP: {"rich_text": [{"type": "text", "text": {"content": new_text[:1990]}}] if kept else []}}}
    patch_url = f"{NOTION_BASE}/pages/{page_id}"
    async with httpx.AsyncClient(timeout=20) as client:
        resp = await client.patch(patch_url, headers=_headers(), json=body)
        if resp.status_code >= 400:
            logger.error(f"remove_inventory_serials PATCH failed: {resp.status_code} {resp.text[:300]}")
            resp.raise_for_status()
    invalidate_inventory_cache()
    return {"removed": removed, "missing": missing, "prop_found": True}




async def list_inventory(force_refresh: bool = False) -> List[Dict[str, Any]]:
    if not is_configured():
        raise RuntimeError("Notion non configurato")
    now = time.time()
    if (
        not force_refresh
        and _inv_cache["data"] is not None
        and (now - _inv_cache["at"]) < _INVENTORY_CACHE_TTL
    ):
        return _inv_cache["data"]
    url = f"{NOTION_BASE}/data_sources/{NOTION_INVENTARIO_DS_ID}/query"
    body: Dict[str, Any] = {"page_size": 100}
    out: List[Dict[str, Any]] = []
    async with httpx.AsyncClient(timeout=25) as client:
        while True:
            resp = await client.post(url, headers=_headers(), json=body)
            if resp.status_code >= 400:
                logger.error(f"Notion query failed: {resp.status_code} {resp.text[:300]}")
                resp.raise_for_status()
            data = resp.json()
            for p in data.get("results", []):
                out.append(parse_item(p))
            if not data.get("has_more"):
                break
            body["start_cursor"] = data.get("next_cursor")
    _inv_cache["data"] = out
    _inv_cache["at"] = time.time()
    return out


async def get_item(page_id: str) -> Dict[str, Any]:
    if not is_configured():
        raise RuntimeError("Notion non configurato")
    url = f"{NOTION_BASE}/pages/{page_id}"
    async with httpx.AsyncClient(timeout=20) as client:
        resp = await client.get(url, headers=_headers())
        if resp.status_code >= 400:
            logger.error(f"Notion get_item failed: {resp.status_code} {resp.text[:300]}")
            resp.raise_for_status()
        return parse_item(resp.json())


async def find_serial_in_inventory(sn: str) -> Optional[Dict[str, Any]]:
    """F13 — Fonte UNICA per la disponibilità dei seriali.

    Cerca il seriale `sn` nella colonna 16 "SN /codice" dell'Inventario Notion
    iterando la cache già presente (nessuna nuova query a Notion nel caso comune).

    NON consulta Entrate, Uscite, Consegne Wallbox o altri database.

    Returns:
      - dict item se trovato (con name, id, code, ecc.)
      - None se il seriale non è presente nell'Inventario → NON DISPONIBILE.
    """
    sn_clean = (sn or "").strip()
    if not sn_clean:
        return None
    sn_lower = sn_clean.lower()
    items = await list_inventory()
    for it in items:
        for s in (it.get("serials") or []):
            if s.strip().lower() == sn_lower:
                return it
    return None


# ---------- F14 — Eliostech Ordini ----------

async def find_order_by_structure(structure: str) -> Dict[str, Any]:
    """F14 — Trova l'ordine in "Eliostech Ordini" cercando `structure` nel campo
    NOTION_ORDINE_STRUCTURE_FIELD (default: "Ragione sociale" — 2ª colonna del db).
    Confronto case-insensitive esatto sul valore trimato.

    Returns:
      {"status": "not_configured"}                                       — DS non configurato
      {"status": "not_found"}                                            — 0 match
      {"status": "multiple", "count": N, "ids": [...], "titles": [...]}  — >1 match
      {"status": "found", "id": pid, "structure": "...", "sn_wb": [...],
       "qr_codes": [...], "qty_wb": <num|None>, "title": "...", "url": "..."}
    """
    if not NOTION_TOKEN or not NOTION_ORDINI_DS_ID:
        return {"status": "not_configured"}
    q = (structure or "").strip()
    if not q:
        return {"status": "not_found"}
    q_low = q.lower()
    url = f"{NOTION_BASE}/data_sources/{NOTION_ORDINI_DS_ID}/query"
    matches: List[Dict[str, Any]] = []
    body: Dict[str, Any] = {"page_size": 100}
    async with httpx.AsyncClient(timeout=30) as client:
        while True:
            resp = await client.post(url, headers=_headers(), json=body)
            if resp.status_code >= 400:
                logger.error(f"Ordini query failed: {resp.status_code} {resp.text[:200]}")
                resp.raise_for_status()
            data = resp.json()
            for p in data.get("results", []):
                props = p.get("properties", {})
                struct_prop = _get_prop(props, NOTION_ORDINE_STRUCTURE_FIELD)
                struct_text = _plain_text(struct_prop).strip() if struct_prop else ""
                if struct_text and struct_text.lower() == q_low:
                    sn_prop = _get_prop(props, NOTION_ORDINE_SN_PROP)
                    qr_prop = _get_prop(props, NOTION_ORDINE_QR_PROP)
                    qty_prop = _get_prop(props, "QTY WB")
                    title_prop = None
                    for k, v in props.items():
                        if v.get("type") == "title":
                            title_prop = v
                            break
                    matches.append({
                        "id": p["id"],
                        "structure": struct_text,
                        "title": _plain_text(title_prop),
                        "sn_wb": _parse_serials(_plain_text(sn_prop)) if sn_prop else [],
                        "qr_codes": _parse_serials(_plain_text(qr_prop)) if qr_prop else [],
                        "qty_wb": qty_prop.get("number") if qty_prop and qty_prop.get("type") == "number" else None,
                        "url": p.get("url"),
                    })
            if not data.get("has_more"):
                break
            body["start_cursor"] = data.get("next_cursor")
    if not matches:
        return {"status": "not_found"}
    if len(matches) > 1:
        return {
            "status": "multiple",
            "count": len(matches),
            "ids": [m["id"] for m in matches],
            "titles": [m.get("title") or "" for m in matches],
        }
    m = matches[0]
    return {"status": "found", **m}


async def append_shipment_to_order(order_page_id: str, serials: List[str], qr_codes: List[str]) -> None:
    """F14 — Aggiunge SN a "SN WB" e QR a "CODICI QR" sull'ordine.
    Merge idempotente (case-insensitive).
    QTY WB (colonna 16, number) viene sempre riportata a len(SN WB) attuali dopo il merge."""
    if not NOTION_TOKEN or not order_page_id:
        raise RuntimeError("Ordine non configurato")
    async with httpx.AsyncClient(timeout=25) as client:
        r = await client.get(f"{NOTION_BASE}/pages/{order_page_id}", headers=_headers())
        if r.status_code >= 400:
            logger.warning(f"Ordine GET failed: {r.status_code} {r.text[:200]}")
            r.raise_for_status()
        props = (r.json() or {}).get("properties", {})
        sn_prop = _get_prop(props, NOTION_ORDINE_SN_PROP)
        qr_prop = _get_prop(props, NOTION_ORDINE_QR_PROP)
        qty_prop = _get_prop(props, "QTY WB")
        cur_sn = _parse_serials(_plain_text(sn_prop)) if sn_prop else []
        cur_qr = _parse_serials(_plain_text(qr_prop)) if qr_prop else []
        cur_qty = qty_prop.get("number") if qty_prop and qty_prop.get("type") == "number" else None
        sn_low = {s.lower() for s in cur_sn}
        qr_low = {q.lower() for q in cur_qr}
        new_sn = list(cur_sn) + [s.strip() for s in (serials or []) if s and s.strip() and s.strip().lower() not in sn_low]
        new_qr = list(cur_qr) + [q.strip() for q in (qr_codes or []) if q and q.strip() and q.strip().lower() not in qr_low]
        updates: Dict[str, Any] = {}
        if len(new_sn) != len(cur_sn):
            updates[NOTION_ORDINE_SN_PROP] = {"rich_text": [{"type": "text", "text": {"content": "\n".join(new_sn)[:1990]}}]}
        if len(new_qr) != len(cur_qr):
            updates[NOTION_ORDINE_QR_PROP] = {"rich_text": [{"type": "text", "text": {"content": "\n".join(new_qr)[:1990]}}]}
        # F14 fix (utente 20/02): QTY WB deve riflettere il conteggio Wallbox nell'ordine.
        # Scrivi len(new_sn). Se new_sn è invariato ma cur_qty è disallineato, ricalibra comunque.
        target_qty = len(new_sn)
        if cur_qty is None or float(cur_qty) != float(target_qty):
            updates["QTY WB"] = {"number": target_qty}
        if not updates:
            return
        resp = await client.patch(f"{NOTION_BASE}/pages/{order_page_id}", headers=_headers(), json={"properties": updates})
        if resp.status_code >= 400:
            logger.error(f"Ordine PATCH failed: {resp.status_code} {resp.text[:300]}")
            resp.raise_for_status()


async def remove_shipment_from_order(order_page_id: str, serials: List[str], qr_codes: List[str]) -> None:
    """F14 — Rimuove SN/QR dall'ordine (retroattività/annullamento). Idempotente.
    Aggiorna QTY WB = len(SN WB) rimanenti."""
    if not NOTION_TOKEN or not order_page_id:
        raise RuntimeError("Ordine non configurato")
    sn_rm = {(s or "").strip().lower() for s in (serials or []) if (s or "").strip()}
    qr_rm = {(q or "").strip().lower() for q in (qr_codes or []) if (q or "").strip()}
    if not sn_rm and not qr_rm:
        return
    async with httpx.AsyncClient(timeout=25) as client:
        r = await client.get(f"{NOTION_BASE}/pages/{order_page_id}", headers=_headers())
        if r.status_code >= 400:
            r.raise_for_status()
        props = (r.json() or {}).get("properties", {})
        sn_prop = _get_prop(props, NOTION_ORDINE_SN_PROP)
        qr_prop = _get_prop(props, NOTION_ORDINE_QR_PROP)
        qty_prop = _get_prop(props, "QTY WB")
        cur_sn = _parse_serials(_plain_text(sn_prop)) if sn_prop else []
        cur_qr = _parse_serials(_plain_text(qr_prop)) if qr_prop else []
        cur_qty = qty_prop.get("number") if qty_prop and qty_prop.get("type") == "number" else None
        new_sn = [s for s in cur_sn if s.strip().lower() not in sn_rm]
        new_qr = [q for q in cur_qr if q.strip().lower() not in qr_rm]
        updates: Dict[str, Any] = {}
        if len(new_sn) != len(cur_sn):
            updates[NOTION_ORDINE_SN_PROP] = {"rich_text": [{"type": "text", "text": {"content": "\n".join(new_sn)[:1990]}}]}
        if len(new_qr) != len(cur_qr):
            updates[NOTION_ORDINE_QR_PROP] = {"rich_text": [{"type": "text", "text": {"content": "\n".join(new_qr)[:1990]}}]}
        target_qty = len(new_sn)
        if cur_qty is None or float(cur_qty) != float(target_qty):
            updates["QTY WB"] = {"number": target_qty}
        if not updates:
            return
        resp = await client.patch(f"{NOTION_BASE}/pages/{order_page_id}", headers=_headers(), json={"properties": updates})
        if resp.status_code >= 400:
            resp.raise_for_status()


async def update_tracker_row(page_id: str, new_sn: Optional[str] = None,
                              new_qty: Optional[float] = None,
                              new_cliente: Optional[str] = None,
                              new_date: Optional[str] = None,
                              new_taken_by: Optional[str] = None,
                              new_product_page_id: Optional[str] = None) -> None:
    """F14 §20 — Retroattività: modifica riga esistente in Inventory Tracker (Uscite).
    Aggiorna SOLO i campi non-None. Non crea nuove righe.

    F16 (2026-02): supporta anche `new_product_page_id` — ricollega la riga a un
    prodotto Inventario diverso mantenendo lo stesso record (utile per correzioni
    tipo 'Daze Duo' → 'Pulsar Pro' su stesso seriale)."""
    if not NOTION_TOKEN or not page_id:
        raise RuntimeError("Notion non configurato")
    props: Dict[str, Any] = {}
    if new_sn is not None:
        props["SN"] = {"title": [{"type": "text", "text": {"content": (new_sn or "—")[:200]}}]}
    if new_qty is not None:
        props["Quantità"] = {"number": float(new_qty)}
    if new_cliente is not None:
        props["Preso per"] = {"rich_text": [{"type": "text", "text": {"content": (new_cliente or "")[:2000]}}]}
    if new_date is not None:
        props["Data Uscita"] = {"date": {"start": new_date}}
    if new_taken_by is not None:
        props["Preso da"] = {"rich_text": [{"type": "text", "text": {"content": (new_taken_by or "")[:2000]}}]}
    if new_product_page_id:
        props["Item in uscita"] = {"relation": [{"id": new_product_page_id}]}
    if not props:
        return
    async with httpx.AsyncClient(timeout=20) as client:
        resp = await client.patch(f"{NOTION_BASE}/pages/{page_id}", headers=_headers(), json={"properties": props})
        if resp.status_code >= 400:
            logger.error(f"update_tracker_row failed: {resp.status_code} {resp.text[:200]}")
            resp.raise_for_status()
    invalidate_inventory_cache()


async def update_receipt_row(page_id: str, new_sn: Optional[str] = None,
                              new_qty: Optional[float] = None,
                              new_date: Optional[str] = None) -> None:
    """F14 §20 — Retroattività: modifica riga esistente in Inventory Receipts (Entrate)."""
    if not NOTION_TOKEN or not page_id:
        raise RuntimeError("Notion non configurato")
    props: Dict[str, Any] = {}
    if new_sn is not None:
        props["Item"] = {"title": [{"type": "text", "text": {"content": (new_sn or "—")[:200]}}]}
    if new_qty is not None:
        props["Quantità"] = {"number": float(new_qty)}
    if new_date is not None:
        props["Data Consegna"] = {"date": {"start": new_date}}
    if not props:
        return
    async with httpx.AsyncClient(timeout=20) as client:
        resp = await client.patch(f"{NOTION_BASE}/pages/{page_id}", headers=_headers(), json={"properties": props})
        if resp.status_code >= 400:
            resp.raise_for_status()
    invalidate_inventory_cache()


async def create_pick(
    item_page_id: str,
    sn_title: str,
    quantity: float,
    cliente: str,
    data_uscita: str,
    taken_by: str = "",
) -> str:
    """Create a new row in the Inventory Tracker (Spedizioni/Uscite) data source.
    Returns new page id. Notion's rollup on the Inventario item auto-updates via
    'Item in uscita' relation.

    Property mapping (actual Notion schema):
      SN (title)              — serial number or product code
      Item in uscita (rel)    — link to Inventario item
      Quantità (number)
      Preso per (rich_text)   — Cliente / Destinazione (free text)
      Preso da (rich_text)    — Chi ha materialmente prelevato (free text)
      Data Uscita (date)
    """
    if not NOTION_TOKEN or not NOTION_TRACKER_DS_ID:
        raise RuntimeError("Tracker data source non configurato")
    url = f"{NOTION_BASE}/pages"
    properties: Dict[str, Any] = {
        "SN": {"title": [{"type": "text", "text": {"content": (sn_title or "—")[:200]}}]},
        "Quantità": {"number": quantity},
        "Item in uscita": {"relation": [{"id": item_page_id}]},
        "Preso per": {"rich_text": [{"type": "text", "text": {"content": (cliente or "")[:2000]}}]},
        "Data Uscita": {"date": {"start": data_uscita}},
    }
    if taken_by and taken_by.strip():
        properties["Preso da"] = {
            "rich_text": [{"type": "text", "text": {"content": taken_by.strip()[:2000]}}]
        }
    body = {
        "parent": {"type": "data_source_id", "data_source_id": NOTION_TRACKER_DS_ID},
        "properties": properties,
    }
    async with httpx.AsyncClient(timeout=20) as client:
        resp = await client.post(url, headers=_headers(), json=body)
        if resp.status_code >= 400:
            logger.error(f"Notion create_pick failed: {resp.status_code} {resp.text[:300]}")
            resp.raise_for_status()
        return resp.json().get("id", "")


async def list_receipts_all(date_from: Optional[str] = None, date_to: Optional[str] = None) -> List[Dict[str, Any]]:
    """Return Inventory Receipts rows (enriched with Inventario item name).
    If `date_from`/`date_to` (ISO YYYY-MM-DD) are provided, filter server-side via
    Notion API — avoids downloading the full history."""
    if not is_configured() or not NOTION_RECEIPTS_DS_ID:
        return []
    url = f"{NOTION_BASE}/data_sources/{NOTION_RECEIPTS_DS_ID}/query"
    inv = await list_inventory()
    inv_map = {it["id"]: it for it in inv}
    body: Dict[str, Any] = {
        "page_size": 100,
        "sorts": [{"property": "Data Consegna", "direction": "descending"}],
    }
    if date_from or date_to:
        conds: List[Dict[str, Any]] = []
        if date_from:
            conds.append({"property": "Data Consegna", "date": {"on_or_after": date_from}})
        if date_to:
            conds.append({"property": "Data Consegna", "date": {"on_or_before": date_to}})
        body["filter"] = conds[0] if len(conds) == 1 else {"and": conds}
    out: List[Dict[str, Any]] = []
    async with httpx.AsyncClient(timeout=25) as client:
        while True:
            resp = await client.post(url, headers=_headers(), json=body)
            if resp.status_code >= 400:
                logger.error(f"Notion receipts list failed: {resp.status_code} {resp.text[:200]}")
                resp.raise_for_status()
            data = resp.json()
            for p in data.get("results", []):
                props = p.get("properties", {})
                title = _plain_text(_get_prop(props, "Item", "Aa item", "Aa Item"))
                qty_prop = _get_prop(props, "Quantità")
                qty = qty_prop.get("number") if qty_prop else None
                date_prop = _get_prop(props, "Data Consegna", "Data")
                d = None
                if date_prop and date_prop.get("type") == "date":
                    dv = date_prop.get("date") or {}
                    d = dv.get("start")
                rel_prop = _get_prop(props, "Item in entrata", "Item in ingresso")
                item_ids: List[str] = []
                item_name = None
                item_unit = "pz"
                if rel_prop and rel_prop.get("type") == "relation":
                    for r in (rel_prop.get("relation") or []):
                        rid = r.get("id")
                        if rid:
                            item_ids.append(rid)
                            it = inv_map.get(rid)
                            if it:
                                item_name = it.get("name")
                                item_unit = it.get("unit") or "pz"
                out.append({
                    "id": p["id"],
                    "sn": title,
                    "quantity": qty,
                    "date": d,
                    "item_ids": item_ids,
                    "item_name": item_name,
                    "unit": item_unit,
                    "created_time": p.get("created_time"),
                })
            if not data.get("has_more"):
                break
            body["start_cursor"] = data.get("next_cursor")
    return out



async def archive_page(page_id: str) -> None:
    """Archive a page — used to rollback a partially-created shipment."""
    if not NOTION_TOKEN or not page_id:
        return
    url = f"{NOTION_BASE}/pages/{page_id}"
    async with httpx.AsyncClient(timeout=15) as client:
        try:
            await client.patch(url, headers=_headers(), json={"archived": True})
        except Exception as e:
            logger.warning(f"Rollback archive failed for {page_id}: {e}")


async def create_receipt(
    item_page_id: str,
    sn_title: str,
    quantity: float,
    data_consegna: str,
) -> str:
    """Create a new row in the Inventory Receipts (Consegne/Entrate) data source.
    Returns the new page id. Notion's rollup formula on the Inventario item's
    QTA auto-updates via the 'Item in entrata' relation.

    Property names match the actual Notion schema:
      - Item (title)            — SN string or product name (for non-serialized)
      - Item in entrata (relation) — link to Inventario item
      - Quantità (number)
      - Data Consegna (date)
    """
    if not NOTION_TOKEN or not NOTION_RECEIPTS_DS_ID:
        raise RuntimeError("Receipts data source non configurato")
    url = f"{NOTION_BASE}/pages"
    body = {
        "parent": {"type": "data_source_id", "data_source_id": NOTION_RECEIPTS_DS_ID},
        "properties": {
            "Item": {"title": [{"type": "text", "text": {"content": (sn_title or "—")[:200]}}]},
            "Quantità": {"number": quantity},
            "Item in entrata": {"relation": [{"id": item_page_id}]},
            "Data Consegna": {"date": {"start": data_consegna}},
        },
    }
    async with httpx.AsyncClient(timeout=20) as client:
        resp = await client.post(url, headers=_headers(), json=body)
        if resp.status_code >= 400:
            logger.error(f"Notion create_receipt failed: {resp.status_code} {resp.text[:300]}")
            resp.raise_for_status()
        return resp.json().get("id", "")


async def lookup_tracker_sn(sn: str) -> Optional[Dict[str, Any]]:
    """Find the LATEST Inventory Tracker row (by Data Uscita, tiebreaker created_time)
    whose SN title contains `sn`. Returns None if never seen in Tracker.
    Iterates ALL pages to find the most recent match — important for the
    rientro-Wallbox flow where multiple exits of the same SN can coexist."""
    if not is_configured() or not NOTION_TRACKER_DS_ID:
        return None
    url = f"{NOTION_BASE}/data_sources/{NOTION_TRACKER_DS_ID}/query"
    body: Dict[str, Any] = {"page_size": 100}
    sn_norm = sn.strip().lower()
    best: Optional[Dict[str, Any]] = None

    def _key(hit: Dict[str, Any]) -> str:
        return (hit.get("date") or "") + "|" + (hit.get("created_time") or "")

    async with httpx.AsyncClient(timeout=25) as client:
        while True:
            resp = await client.post(url, headers=_headers(), json=body)
            if resp.status_code >= 400:
                logger.error(
                    f"Notion tracker query failed: {resp.status_code} {resp.text[:200]}"
                )
                return None
            data = resp.json()
            for p in data.get("results", []):
                props = p.get("properties", {})
                title_prop = _get_prop(props, "SN", "Serial", "Seriale")
                title_text = _plain_text(title_prop)
                serials = _parse_serials(title_text)
                for s in serials:
                    if s.strip().lower() == sn_norm:
                        cliente = _plain_text(_get_prop(props, "Preso per"))
                        date_prop = _get_prop(props, "Data Uscita")
                        d = None
                        if date_prop and date_prop.get("type") == "date":
                            dv = date_prop.get("date") or {}
                            d = dv.get("start")
                        rel_prop = _get_prop(props, "Item in uscita")
                        item_ids: List[str] = []
                        if rel_prop and rel_prop.get("type") == "relation":
                            item_ids = [
                                r.get("id")
                                for r in (rel_prop.get("relation") or [])
                                if r.get("id")
                            ]
                        candidate = {
                            "id": p["id"],
                            "matched_serial": s,
                            "cliente": cliente,
                            "date": d,
                            "created_time": p.get("created_time"),
                            "item_ids": item_ids,
                            "url": p.get("url"),
                        }
                        if best is None or _key(candidate) > _key(best):
                            best = candidate
                        break
            if not data.get("has_more"):
                break
            body["start_cursor"] = data.get("next_cursor")
    return best


async def lookup_receipts_sn(sn: str) -> Optional[Dict[str, Any]]:
    """Find the LATEST Inventory Receipts row (by Data Consegna, tiebreaker created_time)
    whose 'Item' title contains `sn` as one of the tokens. Returns None if never seen.
    Iterates ALL pages — required for the rientro-Wallbox flow."""
    if not is_configured() or not NOTION_RECEIPTS_DS_ID:
        return None
    url = f"{NOTION_BASE}/data_sources/{NOTION_RECEIPTS_DS_ID}/query"
    body: Dict[str, Any] = {"page_size": 100}
    sn_norm = sn.strip().lower()
    best: Optional[Dict[str, Any]] = None

    def _key(hit: Dict[str, Any]) -> str:
        return (hit.get("date") or "") + "|" + (hit.get("created_time") or "")

    async with httpx.AsyncClient(timeout=25) as client:
        while True:
            resp = await client.post(url, headers=_headers(), json=body)
            if resp.status_code >= 400:
                logger.error(
                    f"Receipts query failed: {resp.status_code} {resp.text[:200]}"
                )
                return None
            data = resp.json()
            for p in data.get("results", []):
                props = p.get("properties", {})
                title_prop = _get_prop(props, "Item", "Aa item", "Aa Item")
                title_text = _plain_text(title_prop)
                serials = _parse_serials(title_text)
                for s in serials:
                    if s.strip().lower() == sn_norm:
                        rel_prop = _get_prop(
                            props, "Item in entrata", "Item in ingresso", "Item"
                        )
                        item_ids: List[str] = []
                        if rel_prop and rel_prop.get("type") == "relation":
                            item_ids = [
                                r.get("id")
                                for r in (rel_prop.get("relation") or [])
                                if r.get("id")
                            ]
                        date_prop = _get_prop(props, "Data Consegna", "Data")
                        d = None
                        if date_prop and date_prop.get("type") == "date":
                            dv = date_prop.get("date") or {}
                            d = dv.get("start")
                        candidate = {
                            "id": p["id"],
                            "matched_serial": s,
                            "all_serials": serials,
                            "date": d,
                            "created_time": p.get("created_time"),
                            "item_ids": item_ids,
                            "url": p.get("url"),
                            "raw_title": title_text,
                        }
                        if best is None or _key(candidate) > _key(best):
                            best = candidate
                        break
            if not data.get("has_more"):
                break
            body["start_cursor"] = data.get("next_cursor")
    return best


async def latest_serial_status(sn: str) -> Dict[str, Any]:
    """F6-rientri: determine current status of a serial by comparing the
    latest Receipts hit with the latest Tracker hit — Notion is SSOT.
    Returns one of:
      - {"status": "unseen"}                          — mai visto
      - {"status": "in_warehouse", "last": {receipt}} — ultimo movimento = ENTRATA
      - {"status": "out",          "last": {exit}}    — ultimo movimento = USCITA
    Called LIVE on submit paths to prevent multi-operator races.
    """
    r = await lookup_receipts_sn(sn)
    t = await lookup_tracker_sn(sn)
    if not r and not t:
        return {"status": "unseen"}

    def _key(hit: Optional[Dict[str, Any]]) -> str:
        if not hit:
            return ""
        return (hit.get("date") or "") + "|" + (hit.get("created_time") or "")

    if r and not t:
        return {"status": "in_warehouse", "last": r, "receipt": r, "exit": None}
    if t and not r:
        return {"status": "out", "last": t, "receipt": None, "exit": t}
    # both present — the newer one wins. On exact tie (Notion created_time is
    # rounded to the minute), prefer OUT because a shipment physically can only
    # occur after its receipt was created.
    if _key(r) > _key(t):
        return {"status": "in_warehouse", "last": r, "receipt": r, "exit": t}
    return {"status": "out", "last": t, "receipt": r, "exit": t}


async def list_exits(date_from: Optional[str] = None, date_to: Optional[str] = None) -> List[Dict[str, Any]]:
    """Query the Inventory Tracker data source for outgoing picks.
    If `date_from`/`date_to` (ISO YYYY-MM-DD) are provided, filter server-side."""
    if not NOTION_TOKEN or not NOTION_TRACKER_DS_ID:
        raise RuntimeError("Tracker non configurato")

    inventory = await list_inventory()
    name_map = {
        it["id"]: {"name": it["name"], "unit": it["unit"], "category": it.get("category")}
        for it in inventory
    }

    url = f"{NOTION_BASE}/data_sources/{NOTION_TRACKER_DS_ID}/query"
    body: Dict[str, Any] = {"page_size": 100}
    if date_from or date_to:
        conds: List[Dict[str, Any]] = []
        if date_from:
            conds.append({"property": "Data Uscita", "date": {"on_or_after": date_from}})
        if date_to:
            conds.append({"property": "Data Uscita", "date": {"on_or_before": date_to}})
        body["filter"] = conds[0] if len(conds) == 1 else {"and": conds}
    out: List[Dict[str, Any]] = []
    async with httpx.AsyncClient(timeout=30) as client:
        while True:
            resp = await client.post(url, headers=_headers(), json=body)
            if resp.status_code >= 400:
                logger.error(f"Notion tracker query failed: {resp.status_code} {resp.text[:300]}")
                resp.raise_for_status()
            data = resp.json()
            for p in data.get("results", []):
                props = p.get("properties", {})
                sn = _plain_text(_get_prop(props, "SN"))
                cliente = _plain_text(_get_prop(props, "Preso per"))
                taken_by = _plain_text(_get_prop(props, "Preso da"))
                qty_prop = _get_prop(props, "Quantità", "Quantita", "Quantity")
                qty = qty_prop.get("number") if qty_prop and qty_prop.get("type") == "number" else None
                date_prop = _get_prop(props, "Data Uscita", "Data")
                d = None
                if date_prop and date_prop.get("type") == "date":
                    dv = date_prop.get("date") or {}
                    d = dv.get("start")
                rel_prop = _get_prop(props, "Item in uscita", "Item")
                item_ids: List[str] = []
                if rel_prop and rel_prop.get("type") == "relation":
                    item_ids = [r.get("id") for r in (rel_prop.get("relation") or []) if r.get("id")]
                item_names = [name_map.get(i, {}).get("name", "?") for i in item_ids]
                units = [name_map.get(i, {}).get("unit", "pz") for i in item_ids]
                categories = [name_map.get(i, {}).get("category") for i in item_ids]
                out.append({
                    "id": p["id"],
                    "sn": sn,
                    "cliente": cliente,
                    "taken_by": taken_by,
                    "quantity": qty,
                    "date": d,
                    "item_ids": item_ids,
                    "item_names": item_names,
                    "item_name": item_names[0] if item_names else None,
                    "unit": units[0] if units else "pz",
                    "category": categories[0] if categories else None,
                    "url": p.get("url"),
                    "created_time": p.get("created_time"),
                })
            if not data.get("has_more"):
                break
            body["start_cursor"] = data.get("next_cursor")
    # Filter out empty draft rows (no quantity and no relation and no cliente)
    out = [
        e for e in out
        if (e.get("quantity") is not None) or e.get("item_ids") or e.get("cliente") or e.get("sn")
    ]
    # Sort by date descending (fallback to created_time)
    out.sort(key=lambda x: (x.get("date") or "") + (x.get("created_time") or ""), reverse=True)
    return out
