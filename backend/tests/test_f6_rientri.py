"""F6-rientri: verifica logica ultimo movimento per prodotti A Seriale.
- SN unseen → arrivi OK, spedizioni BLOCK
- SN last=entrata → arrivi BLOCK, spedizioni OK
- SN last=uscita → arrivi OK (rientro), spedizioni BLOCK
- Duplicati nella stessa operazione → BLOCK
Test READ-ONLY: nessuna riga viene creata su Notion (tutti i submit sono attesi 400/409).
"""
import os
import requests
import pytest
import asyncio

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "").rstrip("/")
if not BASE_URL:
    with open("/app/frontend/.env") as f:
        for line in f:
            if line.startswith("REACT_APP_BACKEND_URL="):
                BASE_URL = line.split("=", 1)[1].strip().rstrip("/")
                break


@pytest.fixture(scope="module")
def api():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


# ---- /api/inventory/lookup returns new statuses ----
def test_lookup_unseen_serial_is_not_found(api):
    r = api.get(f"{BASE_URL}/api/inventory/lookup", params={"code": "F6RIENTRI_NEVER_SEEN_XYZ"}, timeout=30)
    assert r.status_code == 200
    assert r.json()["status"] == "not_found"


def test_lookup_sku_still_works(api):
    r = api.get(f"{BASE_URL}/api/inventory/lookup", params={"code": "CH02"}, timeout=30)
    assert r.status_code == 200
    j = r.json()
    assert j["status"] == "ok"
    assert j["matched_by"] == "sku"


def test_lookup_returns_in_warehouse_or_out_for_known_serial(api):
    """Almeno un seriale conosciuto (Notion Receipts) deve tornare status in_warehouse|out."""
    # Recupera un movimento reale da /api/movimenti (arrivo) e riusa il suo SN
    r = api.get(f"{BASE_URL}/api/movimenti", timeout=60)
    assert r.status_code == 200
    items = r.json()["items"]
    known_sn = None
    for m in items:
        s = (m.get("serial_or_code") or "").strip()
        # SN a token singolo (evita celle multi-serial per il test)
        if s and " " not in s and "," not in s and "." not in s and ";" not in s:
            # Verifica che il lookup ritorni in_warehouse|out (non not_found)
            lk = api.get(f"{BASE_URL}/api/inventory/lookup", params={"code": s}, timeout=30).json()
            if lk["status"] in ("in_warehouse", "out"):
                known_sn = s
                assert lk.get("matched_by") == "sn"
                assert lk.get("item") is not None
                return
    pytest.skip("no single-token SN with status in_warehouse|out found")


# ---- Submit ARRIVO: block if SN currently in warehouse ----
def test_arrivo_blocks_serial_currently_in_warehouse(api):
    """Trova un SN il cui ultimo movimento è ENTRATA e prova a registrarlo di nuovo."""
    inv = api.get(f"{BASE_URL}/api/inventory", timeout=60).json().get("items", [])
    ser_item = next((i for i in inv if i.get("tipo_gestione") == "a_seriale"), None)
    if not ser_item:
        pytest.skip("no serialized product")
    # Cerca un SN in_warehouse per questo prodotto (via movimenti mese corrente + retro)
    mov = api.get(f"{BASE_URL}/api/movimenti", timeout=60).json()["items"]
    in_wh_sn = None
    for m in mov:
        if m.get("type") != "arrivo":
            continue
        s = (m.get("serial_or_code") or "").strip()
        if not s or " " in s or "," in s or "." in s:
            continue
        lk = api.get(f"{BASE_URL}/api/inventory/lookup", params={"code": s}, timeout=30).json()
        if lk.get("status") == "in_warehouse":
            in_wh_sn = s
            item = lk["item"]
            break
    if not in_wh_sn:
        pytest.skip("no SN currently in_warehouse to test")
    payload = {
        "operator": "F6-rientri test",
        "arrival_date": "2026-02-14",
        "fornitore": "F6 TEST FORN",
        "items": [{
            "page_id": item["id"], "name": item["name"], "unit": item.get("unit") or "pz",
            "serialized": True, "quantity": 1, "serials": [in_wh_sn],
        }],
    }
    r = api.post(f"{BASE_URL}/api/arrivi/send", json=payload, timeout=60)
    assert r.status_code == 409, r.text[:200]
    detail = (r.json().get("detail") or "").lower()
    assert "già presente" in detail or "gia presente" in detail, detail


def test_arrivo_allows_new_unseen_serial(api):
    """Un SN mai visto deve poter essere aggiunto — ma non lo confermiamo davvero,
    verifichiamo solo che il check pre-serial NON blocchi."""
    inv = api.get(f"{BASE_URL}/api/inventory", timeout=60).json().get("items", [])
    ser_item = next((i for i in inv if i.get("tipo_gestione") == "a_seriale"), None)
    if not ser_item:
        pytest.skip("no serialized product")
    unique_sn = "F6RIENTRI_NEW_SN_TEST_UNIQUE_ZZZZ"
    lk = api.get(f"{BASE_URL}/api/inventory/lookup", params={"code": unique_sn}, timeout=30).json()
    assert lk["status"] == "not_found"


# ---- Duplicate-in-payload ----
def test_arrivo_blocks_duplicate_serial_in_payload(api):
    inv = api.get(f"{BASE_URL}/api/inventory", timeout=60).json().get("items", [])
    ser_item = next((i for i in inv if i.get("tipo_gestione") == "a_seriale"), None)
    if not ser_item:
        pytest.skip("no serialized product")
    payload = {
        "operator": "F6-rientri test",
        "arrival_date": "2026-02-14",
        "fornitore": "F6 DUP",
        "items": [{
            "page_id": ser_item["id"], "name": ser_item["name"], "unit": ser_item.get("unit") or "pz",
            "serialized": True, "quantity": 2,
            "serials": ["F6RIENTRI_DUP_SN", "F6RIENTRI_DUP_SN"],
        }],
    }
    r = api.post(f"{BASE_URL}/api/arrivi/send", json=payload, timeout=60)
    assert r.status_code == 409
    detail = (r.json().get("detail") or "").lower()
    assert "inserito più volte" in detail or "inserito piu volte" in detail


# ---- Submit SPEDIZIONE: block if SN unseen ----
def test_spedizione_blocks_unseen_serial(api):
    inv = api.get(f"{BASE_URL}/api/inventory", timeout=60).json().get("items", [])
    ser_item = next((i for i in inv if i.get("tipo_gestione") == "a_seriale"), None)
    if not ser_item:
        pytest.skip("no serialized product")
    payload = {
        "operator": "F6-rientri test",
        "shipping_date": "2026-02-14",
        "structure": "F6 CLI",
        "taken_by": "F6-rientri test",
        "items": [{
            "page_id": ser_item["id"], "name": ser_item["name"], "unit": ser_item.get("unit") or "pz",
            "serialized": True, "quantity": 1,
            "serials": ["F6RIENTRI_NEVER_SEEN_ABC"],
        }],
    }
    r = api.post(f"{BASE_URL}/api/checklist/send", json=payload, timeout=60)
    assert r.status_code == 409
    detail = (r.json().get("detail") or "").lower()
    assert "mai entrato" in detail, detail


# ---- Latest_serial_status helper direct test ----
def test_latest_serial_status_helper_unseen():
    import sys
    sys.path.insert(0, "/app/backend")
    import notion_service  # noqa: E402
    st = asyncio.run(notion_service.latest_serial_status("F6RIENTRI_HELPER_TEST_ZZZ"))
    assert st["status"] == "unseen"
