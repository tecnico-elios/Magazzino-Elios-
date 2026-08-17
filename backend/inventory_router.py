"""Inventory Router — piccola facciata che sceglie fra Notion e Gestionale locale
in base a `settings.general.inventory_source`.

Usage:
    from inventory_router import get_svc
    svc = await get_svc(db)
    items = await svc.list_inventory()
"""
from __future__ import annotations

from typing import Any

import notion_service
import inventory_local


async def get_source(db) -> str:
    doc = await db.settings.find_one({"_id": "app_settings"}) or {}
    src = ((doc.get("general") or {}).get("inventory_source")) or "notion"
    return "gestionale" if src == "gestionale" else "notion"


async def get_svc(db) -> Any:
    """Return the active inventory service module (same public interface)."""
    src = await get_source(db)
    if src == "gestionale":
        return inventory_local
    return notion_service
