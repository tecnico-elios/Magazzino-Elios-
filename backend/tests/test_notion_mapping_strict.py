"""Prompt 220 §11 — Mapping Notion RIGOROSO.

Verifica che le funzioni submit_checklist e submit_arrivo scrivano SOLO
valori isolati alle proprietà Notion:
  - SN / Item title  = SOLO seriale (o SOLO nome prodotto per A Quantità)
  - Preso per        = SOLO cliente/struttura
  - Preso da         = SOLO operatore

Nessuna concatenazione mai. Test in-process con monkeypatch — zero write reali su Notion.
"""
import sys
import asyncio
from pathlib import Path
from unittest.mock import AsyncMock

import pytest

sys.path.insert(0, str(Path(__file__).parent.parent))

import server  # noqa: E402
import notion_service  # noqa: E402


@pytest.fixture
def stub_notion(monkeypatch):
    """Sostituisce tutte le chiamate notion_service con AsyncMock che tracciano gli argomenti.

    Ritorna un dict di mock con: create_pick, create_receipt, get_item,
    latest_serial_status, invalidate_inventory_cache, archive_page.
    """
    async def _get_item(page_id):
        # tipo_gestione impostato dinamicamente per test → conservato in un mapping
        return _get_item.map.get(page_id, {"name": "TestItem", "quantity": 999, "unit": "pz", "tipo_gestione": "a_quantita"})
    _get_item.map = {}

    async def _latest_status(sn):
        return _latest_status.map.get(sn, {"status": "unseen"})
    _latest_status.map = {}

    create_pick = AsyncMock(return_value="tracker_pid")
    create_receipt = AsyncMock(return_value="receipt_pid")
    archive_page = AsyncMock(return_value=None)
    invalidate = AsyncMock(return_value=None)

    monkeypatch.setattr(notion_service, "is_configured", lambda: True)
    monkeypatch.setattr(notion_service, "get_item", _get_item)
    monkeypatch.setattr(notion_service, "latest_serial_status", _latest_status)
    monkeypatch.setattr(notion_service, "create_pick", create_pick)
    monkeypatch.setattr(notion_service, "create_receipt", create_receipt)
    monkeypatch.setattr(notion_service, "archive_page", archive_page)
    monkeypatch.setattr(notion_service, "invalidate_inventory_cache", lambda: None)

    # Anche server.notion_service è lo stesso modulo → gli stessi attr sono patchati.
    # Silenzia mail e history (side-effect I/O).
    async def _get_recipients():
        return []
    monkeypatch.setattr(server, "get_recipients", _get_recipients)

    async def _log_anomaly(**kw):
        return None
    monkeypatch.setattr(server, "log_anomaly", _log_anomaly)

    class _FakeCollection:
        async def insert_one(self, _):
            return None
        async def find_one(self, *a, **kw):
            return None
        async def update_one(self, *a, **kw):
            return None
    class _FakeDb:
        def __getattr__(self, _name):
            return _FakeCollection()
    monkeypatch.setattr(server, "db", _FakeDb())

    async def _send_email(*a, **kw):
        return "email_id"
    monkeypatch.setattr(server, "send_email", _send_email)

    return {
        "create_pick": create_pick,
        "create_receipt": create_receipt,
        "get_item_map": _get_item.map,
        "latest_status_map": _latest_status.map,
    }


def _run(coro):
    loop = asyncio.new_event_loop()
    try:
        return loop.run_until_complete(coro)
    finally:
        loop.close()


# ---------------- SPEDIZIONI ----------------

def test_spedizione_a_seriale_mapping_strict(stub_notion):
    """A Seriale: SN=solo seriale, Preso per=solo cliente, Preso da=solo operatore."""
    stub_notion["get_item_map"]["pg1"] = {
        "name": "Wallbox X", "quantity": 10, "unit": "pz", "tipo_gestione": "a_seriale"
    }
    # Il seriale deve essere "in_warehouse" per essere spedibile
    stub_notion["latest_status_map"]["SN12345"] = {"status": "in_warehouse", "last": {}}

    payload = server.ChecklistPayload(
        operator="Mario Rossi",
        shipping_date="2026-02-15",
        structure="Cliente ACME",
        taken_by="Mario Rossi",
        items=[server.ProductItem(
            page_id="pg1", name="Wallbox X", unit="pz",
            serialized=True, quantity=1, serials=["SN12345"],
        )],
    )
    _run(server.submit_checklist(payload))

    cp = stub_notion["create_pick"]
    assert cp.await_count == 1
    kwargs = cp.await_args.kwargs
    # STRICT: SN = SOLO seriale
    assert kwargs["sn_title"] == "SN12345", f"SN corrotto: {kwargs['sn_title']!r}"
    # STRICT: Preso per = SOLO cliente
    assert kwargs["cliente"] == "Cliente ACME"
    assert "Mario" not in kwargs["cliente"]
    assert "SN12345" not in kwargs["cliente"]
    # STRICT: Preso da = SOLO operatore
    assert kwargs["taken_by"] == "Mario Rossi"
    assert "Cliente" not in kwargs["taken_by"]
    assert "SN12345" not in kwargs["taken_by"]
    # Data
    assert kwargs["data_uscita"] == "2026-02-15"
    assert kwargs["quantity"] == 1


def test_spedizione_a_quantita_no_concat(stub_notion):
    """A Quantità: sn_title = SOLO nome prodotto (MAI concat con cliente/data)."""
    stub_notion["get_item_map"]["pg2"] = {
        "name": "Cavo Ricarica 5m", "quantity": 100, "unit": "pz", "tipo_gestione": "a_quantita"
    }
    payload = server.ChecklistPayload(
        operator="Luca",
        shipping_date="2026-02-15",
        structure="Cliente BETA",
        taken_by="Luca",
        items=[server.ProductItem(
            page_id="pg2", name="Cavo Ricarica 5m", unit="pz",
            serialized=False, quantity=3, serials=[],
        )],
    )
    _run(server.submit_checklist(payload))

    cp = stub_notion["create_pick"]
    kwargs = cp.await_args.kwargs
    # STRICT: MAI concatenazione — solo nome prodotto
    assert kwargs["sn_title"] == "Cavo Ricarica 5m"
    assert " — " not in kwargs["sn_title"]
    assert "Cliente" not in kwargs["sn_title"]
    assert "2026" not in kwargs["sn_title"]
    # cliente/operatore isolati
    assert kwargs["cliente"] == "Cliente BETA"
    assert kwargs["taken_by"] == "Luca"
    assert kwargs["quantity"] == 3


def test_spedizione_taken_by_isolato_da_cliente(stub_notion):
    """taken_by e cliente devono viaggiare SEPARATAMENTE anche con valori strani."""
    stub_notion["get_item_map"]["pg3"] = {
        "name": "Item", "quantity": 5, "unit": "pz", "tipo_gestione": "a_seriale"
    }
    stub_notion["latest_status_map"]["ABC"] = {"status": "in_warehouse", "last": {}}
    payload = server.ChecklistPayload(
        operator="Op1", shipping_date="2026-02-15",
        structure="Cliente — con trattino",
        taken_by="Op1",
        items=[server.ProductItem(
            page_id="pg3", name="Item", serialized=True, quantity=1, serials=["ABC"],
        )],
    )
    _run(server.submit_checklist(payload))
    kw = stub_notion["create_pick"].await_args.kwargs
    assert kw["cliente"] == "Cliente — con trattino"
    assert kw["taken_by"] == "Op1"
    assert kw["sn_title"] == "ABC"
    # nessuna cross-contaminazione
    assert "Op1" not in kw["sn_title"]
    assert "Op1" not in kw["cliente"]
    assert "ABC" not in kw["cliente"]
    assert "ABC" not in kw["taken_by"]


# ---------------- ARRIVI ----------------

def test_arrivo_a_seriale_mapping_strict(stub_notion):
    """A Seriale in arrivo: sn_title = SOLO seriale (nessuna data/fornitore concat)."""
    stub_notion["get_item_map"]["pgA"] = {
        "name": "Wallbox Y", "quantity": 0, "unit": "pz", "tipo_gestione": "a_seriale"
    }
    stub_notion["latest_status_map"]["NEWSN1"] = {"status": "unseen"}
    payload = server.ArrivoPayload(
        operator="Op2",
        arrival_date="2026-02-15",
        fornitore="FornitoreZ",
        items=[server.ArrivoItem(
            page_id="pgA", name="Wallbox Y",
            serialized=True, quantity=1, serials=["NEWSN1"],
        )],
    )
    _run(server.submit_arrivo(payload))
    cr = stub_notion["create_receipt"]
    assert cr.await_count == 1
    kwargs = cr.await_args.kwargs
    # STRICT: solo seriale
    assert kwargs["sn_title"] == "NEWSN1"
    assert "Fornitore" not in kwargs["sn_title"]
    assert "2026" not in kwargs["sn_title"]
    assert " — " not in kwargs["sn_title"]
    assert kwargs["data_consegna"] == "2026-02-15"
    assert kwargs["quantity"] == 1


def test_arrivo_a_quantita_no_date_concat(stub_notion):
    """A Quantità in arrivo: sn_title = SOLO nome prodotto (MAI concat con data)."""
    stub_notion["get_item_map"]["pgQ"] = {
        "name": "Accessorio K", "quantity": 0, "unit": "pz", "tipo_gestione": "a_quantita"
    }
    payload = server.ArrivoPayload(
        operator="Op3",
        arrival_date="2026-02-15",
        fornitore="ForY",
        items=[server.ArrivoItem(
            page_id="pgQ", name="Accessorio K",
            serialized=False, quantity=7, serials=[],
        )],
    )
    _run(server.submit_arrivo(payload))
    kw = stub_notion["create_receipt"].await_args.kwargs
    assert kw["sn_title"] == "Accessorio K"
    assert "2026" not in kw["sn_title"]
    assert " — " not in kw["sn_title"]
    assert kw["quantity"] == 7


# ---------------- NOTION SERVICE UNIT ----------------

def test_notion_service_create_pick_properties(monkeypatch):
    """Verifica la costruzione delle properties dict (JSON body inviato a Notion)."""
    captured = {}
    class FakeResp:
        status_code = 200
        def json(self):
            return {"id": "abc"}
        def raise_for_status(self):
            return None
    class FakeClient:
        def __init__(self, *a, **kw):
            pass
        async def __aenter__(self):
            return self
        async def __aexit__(self, *a):
            return False
        async def post(self, url, headers=None, json=None):
            captured["json"] = json
            return FakeResp()
        async def patch(self, url, headers=None, json=None):
            return FakeResp()
    monkeypatch.setattr(notion_service, "NOTION_TOKEN", "fake")
    monkeypatch.setattr(notion_service, "NOTION_TRACKER_DS_ID", "ds")
    monkeypatch.setattr(notion_service.httpx, "AsyncClient", FakeClient)

    _run(notion_service.create_pick(
        item_page_id="pg", sn_title="SERIAL1", quantity=1,
        cliente="CLI", data_uscita="2026-02-15", taken_by="OP",
    ))
    props = captured["json"]["properties"]
    # SN title contains ONLY the serial
    assert props["SN"]["title"][0]["text"]["content"] == "SERIAL1"
    # Preso per = SOLO cliente
    assert props["Preso per"]["rich_text"][0]["text"]["content"] == "CLI"
    # Preso da = SOLO operatore
    assert props["Preso da"]["rich_text"][0]["text"]["content"] == "OP"
    # Data isolata
    assert props["Data Uscita"]["date"]["start"] == "2026-02-15"
    # Relation su Item in uscita ok
    assert props["Item in uscita"]["relation"][0]["id"] == "pg"
    # NESSUNA property extra concatenata
    for key, val in props.items():
        # Scandi tutti i rich_text/title/text per assicurarti che non ci sia mai " — "
        # concatenato con cliente+operatore+seriale insieme
        text_content = str(val)
        assert not ("SERIAL1" in text_content and "CLI" in text_content), f"concat in {key}"
        assert not ("SERIAL1" in text_content and "OP" in text_content and key != "SN"), f"concat in {key}"
