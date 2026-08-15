"""F3 Spedizioni — nuovi test backend per taken_by e strict serial submit.
Phase 2 migration: /checklist/send ora richiede JWT. taken_by nel payload è ignorato
(server usa il current_user dal token). L'operatore auto-popolato = full_name utente."""
import os
import requests
import pytest

from conftest import BASE_URL


@pytest.fixture(scope="module")
def api():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


def _first_serialized(api):
    inv = api.get(f"{BASE_URL}/api/inventory").json().get("items", [])
    return next((i for i in inv if i.get("serialized") and (i.get("quantity") or 0) >= 1), None)


def _first_quantity(api):
    inv = api.get(f"{BASE_URL}/api/inventory").json().get("items", [])
    return next((i for i in inv if not i.get("serialized") and (i.get("quantity") or 0) >= 1), None)


def test_spedizione_requires_auth(api):
    """Senza JWT → 401 (Phase 2)."""
    r = api.post(f"{BASE_URL}/api/checklist/send", json={
        "operator": "T", "shipping_date": "2026-02-14",
        "structure": "TEST_CLIENTE_F3",
        "items": [{"page_id": "x", "name": "y", "serialized": False, "quantity": 1, "serials": []}],
    })
    assert r.status_code == 401, r.text[:200]


def test_spedizione_missing_cliente(op_headers):
    r = requests.post(f"{BASE_URL}/api/checklist/send", headers=op_headers, json={
        "operator": "T", "shipping_date": "2026-02-14",
        "structure": "",
        "items": [{"page_id": "x", "name": "y", "serialized": False, "quantity": 1, "serials": []}],
    })
    assert r.status_code == 400
    assert "cliente" in r.json()["detail"].lower()


def test_spedizione_strict_serial_not_in_receipts(api, op_headers):
    """SN mai entrato → 409 'mai entrato'."""
    s = _first_serialized(api)
    if not s:
        pytest.skip("no serialized item")
    r = requests.post(f"{BASE_URL}/api/checklist/send", headers=op_headers, json={
        "operator": "T", "shipping_date": "2026-02-14",
        "structure": "TEST_CLIENTE_F3",
        "items": [{"page_id": s["id"], "name": s["name"], "serialized": True, "quantity": 1,
                   "serials": ["NEVER_F3_SN_XYZ"]}],
    }, timeout=90)
    assert r.status_code == 409, r.text[:300]
    assert "non risulta presente" in r.json()["detail"].lower() or "mai entrato" in r.json()["detail"].lower()


def test_spedizione_duplicate_serial(api, op_headers):
    s = _first_serialized(api)
    if not s:
        pytest.skip("no serialized item")
    r = requests.post(f"{BASE_URL}/api/checklist/send", headers=op_headers, json={
        "operator": "T", "shipping_date": "2026-02-14",
        "structure": "TEST_CLIENTE_F3",
        "items": [{"page_id": s["id"], "name": s["name"], "serialized": True, "quantity": 2,
                   "serials": ["DUP_F3_A", "DUP_F3_A"]}],
    }, timeout=90)
    assert r.status_code == 409
    d = r.json()["detail"].lower()
    assert ("inserito più volte" in d) or ("non risulta presente" in d) or ("mai entrato" in d)


def test_spedizione_quantity_over_stock(api, op_headers):
    """A Quantità: qty > stock → 409."""
    q = _first_quantity(api)
    if not q:
        pytest.skip("no quantity item")
    r = requests.post(f"{BASE_URL}/api/checklist/send", headers=op_headers, json={
        "operator": "T", "shipping_date": "2026-02-14",
        "structure": "TEST_CLIENTE_F3",
        "items": [{"page_id": q["id"], "name": q["name"], "serialized": False, "quantity": 99999999, "serials": []}],
    }, timeout=90)
    assert r.status_code == 409
    assert "non disponibile" in r.json()["detail"].lower()
