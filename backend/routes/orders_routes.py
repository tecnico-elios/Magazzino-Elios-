"""F14 — Ricerca autocomplete strutture in "Eliostech Ordini".

GET /api/orders/search?q=<testo>&limit=20
Restituisce fino a `limit` ordini il cui campo `NOTION_ORDINE_STRUCTURE_FIELD`
(seconda colonna, default `Modulo Ordine/Struttura`) contiene `q` (case-insensitive).

Il frontend memorizza l'ID Notion selezionato → viene usato al submit per identificare
con certezza l'ordine, evitando che modifiche testuali causino l'aggiornamento
dell'ordine sbagliato.
"""
from __future__ import annotations

import logging
from typing import Any, Dict, List

import httpx
from fastapi import APIRouter, Depends, HTTPException, Query

import notion_service

logger = logging.getLogger(__name__)


def build_router(db, deps) -> APIRouter:
    router = APIRouter(prefix="/orders", tags=["orders"])

    @router.get("/search")
    async def search_orders(
        q: str = Query(..., min_length=1, max_length=100),
        limit: int = Query(default=20, ge=1, le=50),
        current=Depends(deps.get_current_user),
    ) -> Dict[str, Any]:
        if not notion_service.NOTION_TOKEN or not notion_service.NOTION_ORDINI_DS_ID:
            raise HTTPException(503, "Database Eliostech Ordini non configurato")
        q_low = (q or "").strip().lower()
        if not q_low:
            return {"items": [], "count": 0}
        url = f"{notion_service.NOTION_BASE}/data_sources/{notion_service.NOTION_ORDINI_DS_ID}/query"
        matches: List[Dict[str, Any]] = []
        body: Dict[str, Any] = {"page_size": 100}
        try:
            async with httpx.AsyncClient(timeout=25) as client:
                while len(matches) < limit:
                    resp = await client.post(url, headers=notion_service._headers(), json=body)
                    if resp.status_code >= 400:
                        logger.error(f"Ordini query failed: {resp.status_code} {resp.text[:200]}")
                        resp.raise_for_status()
                    data = resp.json()
                    for p in data.get("results", []):
                        props = p.get("properties", {})
                        struct_prop = notion_service._get_prop(props, notion_service.NOTION_ORDINE_STRUCTURE_FIELD)
                        struct_text = (notion_service._plain_text(struct_prop) if struct_prop else "").strip()
                        if struct_text and q_low in struct_text.lower():
                            title_txt = ""
                            for _k, v in props.items():
                                if v.get("type") == "title":
                                    title_txt = notion_service._plain_text(v)
                                    break
                            matches.append({
                                "id": p["id"],
                                "structure": struct_text,
                                "title": title_txt,
                                "url": p.get("url"),
                            })
                            if len(matches) >= limit:
                                break
                    if not data.get("has_more"):
                        break
                    body["start_cursor"] = data.get("next_cursor")
        except HTTPException:
            raise
        except Exception as e:
            raise HTTPException(502, f"Errore ricerca ordini: {e}")
        return {"items": matches, "count": len(matches), "query": q_low}

    @router.get("/{page_id}")
    async def get_order(page_id: str, current=Depends(deps.get_current_user)) -> Dict[str, Any]:
        """Verifica che una pagina Ordine esista ancora e restituisce lo snapshot corrente."""
        if not notion_service.NOTION_TOKEN or not page_id:
            raise HTTPException(400, "page_id mancante")
        try:
            async with httpx.AsyncClient(timeout=15) as client:
                r = await client.get(f"{notion_service.NOTION_BASE}/pages/{page_id}", headers=notion_service._headers())
                if r.status_code == 404:
                    raise HTTPException(404, "Ordine non più disponibile")
                if r.status_code >= 400:
                    raise HTTPException(502, f"Errore Notion: {r.status_code}")
                data = r.json()
                if data.get("archived"):
                    raise HTTPException(404, "Ordine archiviato")
                props = data.get("properties", {})
                struct_prop = notion_service._get_prop(props, notion_service.NOTION_ORDINE_STRUCTURE_FIELD)
                struct_text = (notion_service._plain_text(struct_prop) if struct_prop else "").strip()
                return {"id": data.get("id"), "structure": struct_text, "url": data.get("url"), "exists": True}
        except HTTPException:
            raise
        except Exception as e:
            raise HTTPException(502, f"Verifica ordine fallita: {e}")

    return router
