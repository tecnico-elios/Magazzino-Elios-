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
import logging
import re
import httpx
from typing import List, Dict, Any, Optional

logger = logging.getLogger(__name__)

NOTION_TOKEN = os.environ.get("NOTION_TOKEN", "")
NOTION_INVENTARIO_DS_ID = os.environ.get("NOTION_INVENTARIO_DS_ID", "")
NOTION_TRACKER_DS_ID = os.environ.get("NOTION_TRACKER_DS_ID", "")
NOTION_RECEIPTS_DS_ID = os.environ.get("NOTION_RECEIPTS_DS_ID", "")
NOTION_VERSION = os.environ.get("NOTION_VERSION", "2025-09-03")
NOTION_BASE = "https://api.notion.com/v1"

# Serials in Inventory Receipts titles can be separated by any of: , . ; whitespace, newlines
_SN_SEP_RE = re.compile(r"[,.;\s]+")


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

    ser_prop = _get_prop(props, "Serializzato", "Serialized")
    serialized_notion: Optional[bool] = None
    if ser_prop and ser_prop.get("type") == "checkbox":
        serialized_notion = bool(ser_prop.get("checkbox", False))

    return {
        "id": page["id"],
        "name": name or "Senza nome",
        "code": code or "",
        "quantity": quantity if quantity is not None else 0,
        "unit": unit or "pz",
        "category": category,
        "serialized_notion": serialized_notion,
        "url": page.get("url"),
    }


async def list_inventory() -> List[Dict[str, Any]]:
    if not is_configured():
        raise RuntimeError("Notion non configurato")
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


async def create_pick(
    item_page_id: str,
    sn_title: str,
    quantity: float,
    cliente: str,
    data_uscita: str,
) -> str:
    """Create a new row in the Inventory Tracker data source. Returns new page id.
    Notion's formula on the Inventario item auto-updates via rollup on Picked Quantity."""
    if not NOTION_TOKEN or not NOTION_TRACKER_DS_ID:
        raise RuntimeError("Tracker data source non configurato")
    url = f"{NOTION_BASE}/pages"
    body = {
        "parent": {"type": "data_source_id", "data_source_id": NOTION_TRACKER_DS_ID},
        "properties": {
            "SN": {"title": [{"type": "text", "text": {"content": sn_title[:200] or "—"}}]},
            "Quantità": {"number": quantity},
            "Item in uscita": {"relation": [{"id": item_page_id}]},
            "Preso per": {"rich_text": [{"type": "text", "text": {"content": (cliente or "")[:200]}}]},
            "Data Uscita": {"date": {"start": data_uscita}},
        },
    }
    async with httpx.AsyncClient(timeout=20) as client:
        resp = await client.post(url, headers=_headers(), json=body)
        if resp.status_code >= 400:
            logger.error(f"Notion create_pick failed: {resp.status_code} {resp.text[:300]}")
            resp.raise_for_status()
        return resp.json().get("id", "")


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


async def lookup_tracker_sn(sn: str) -> Optional[Dict[str, Any]]:
    if not is_configured() or not NOTION_TRACKER_DS_ID:
        return None
    url = f"{NOTION_BASE}/data_sources/{NOTION_TRACKER_DS_ID}/query"
    body = {
        "filter": {"property": "SN", "title": {"equals": sn}},
        "page_size": 5,
    }
    async with httpx.AsyncClient(timeout=15) as client:
        resp = await client.post(url, headers=_headers(), json=body)
        if resp.status_code >= 400:
            logger.error(f"Notion tracker SN lookup failed: {resp.status_code} {resp.text[:200]}")
            return None
        data = resp.json()
    results = data.get("results", [])
    if not results:
        return None
    p = results[0]
    props = p.get("properties", {})
    cliente = _plain_text(_get_prop(props, "Preso per"))
    date_prop = _get_prop(props, "Data Uscita")
    d = None
    if date_prop and date_prop.get("type") == "date":
        dv = date_prop.get("date") or {}
        d = dv.get("start")
    rel_prop = _get_prop(props, "Item in uscita")
    item_ids: List[str] = []
    if rel_prop and rel_prop.get("type") == "relation":
        item_ids = [r.get("id") for r in (rel_prop.get("relation") or []) if r.get("id")]
    return {
        "id": p["id"],
        "cliente": cliente,
        "date": d,
        "item_ids": item_ids,
        "url": p.get("url"),
    }


async def lookup_receipts_sn(sn: str) -> Optional[Dict[str, Any]]:
    """Find an Inventory Receipts row whose 'Item' title contains `sn` as one of
    the tokens separated by commas/dots/semicolons/whitespace/newlines.
    Returns the matched serial + relation to the Inventario item."""
    if not is_configured() or not NOTION_RECEIPTS_DS_ID:
        return None
    url = f"{NOTION_BASE}/data_sources/{NOTION_RECEIPTS_DS_ID}/query"
    body: Dict[str, Any] = {"page_size": 100}
    sn_norm = sn.strip().lower()
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
                        return {
                            "id": p["id"],
                            "matched_serial": s,
                            "all_serials": serials,
                            "date": d,
                            "item_ids": item_ids,
                            "url": p.get("url"),
                            "raw_title": title_text,
                        }
            if not data.get("has_more"):
                break
            body["start_cursor"] = data.get("next_cursor")
    return None


async def list_exits() -> List[Dict[str, Any]]:
    """Query the Inventory Tracker data source for ALL outgoing picks in Notion,
    including those created outside this app.
    Resolves the related Inventario item's name via a page_id -> name map."""
    if not NOTION_TOKEN or not NOTION_TRACKER_DS_ID:
        raise RuntimeError("Tracker non configurato")

    inventory = await list_inventory()
    name_map = {
        it["id"]: {"name": it["name"], "unit": it["unit"], "category": it.get("category")}
        for it in inventory
    }

    url = f"{NOTION_BASE}/data_sources/{NOTION_TRACKER_DS_ID}/query"
    body: Dict[str, Any] = {"page_size": 100}
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
