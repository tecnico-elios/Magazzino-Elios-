"""Backend tests for F2 Arrivi endpoints — Phase 2 auth aware."""
import os
import requests
import pytest

from conftest import BASE_URL


@pytest.fixture(scope="module")
def api():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


def _get_first_serialized(api):
    r = api.get(f"{BASE_URL}/api/inventory")
    items = r.json().get("items", [])
    return next((i for i in items if i.get("serialized")), None)


def test_arrivi_requires_auth(api):
    """Senza JWT → 401 (Phase 2)."""
    r = api.post(f"{BASE_URL}/api/arrivi/send", json={
        "operator": "T", "arrival_date": "2026-02-14", "fornitore": "F",
        "items": [{"page_id": "x", "name": "y", "serialized": False, "quantity": 1, "serials": []}]
    })
    assert r.status_code == 401


def test_arrivi_validation_missing_fornitore(op_headers):
    r = requests.post(f"{BASE_URL}/api/arrivi/send", headers=op_headers, json={
        "operator": "T", "arrival_date": "2026-02-14", "fornitore": "",
        "items": [{"page_id": "x", "name": "y", "serialized": False, "quantity": 1, "serials": []}]
    })
    assert r.status_code == 400
    assert "fornitore" in r.json()["detail"].lower()


def test_arrivi_validation_empty_items(op_headers):
    r = requests.post(f"{BASE_URL}/api/arrivi/send", headers=op_headers, json={
        "operator": "T", "arrival_date": "2026-02-14", "fornitore": "TestSup", "items": []
    })
    assert r.status_code == 400


def test_arrivi_rejects_serial_currently_in_warehouse(api, op_headers):
    s = _get_first_serialized(api)
    if not s:
        pytest.skip("no serialized item")
    mov = api.get(f"{BASE_URL}/api/movimenti", timeout=60).json()["items"]
    in_wh_sn = None
    for m in mov:
        if m.get("type") != "arrivo":
            continue
        sn = (m.get("serial_or_code") or "").strip()
        if not sn or " " in sn or "," in sn or "." in sn or ";" in sn:
            continue
        lk = api.get(f"{BASE_URL}/api/inventory/lookup", params={"code": sn}, timeout=30).json()
        if lk.get("status") == "in_warehouse":
            in_wh_sn = sn
            break
    if not in_wh_sn:
        pytest.skip("no in_warehouse SN found")
    r = requests.post(f"{BASE_URL}/api/arrivi/send", headers=op_headers, json={
        "operator": "Tester", "arrival_date": "2026-02-14", "fornitore": "TestSup",
        "items": [{"page_id": s["id"], "name": s["name"], "serialized": True, "quantity": 1, "serials": [in_wh_sn]}]
    }, timeout=90)
    assert r.status_code == 409, r.text[:300]
    detail = r.json()["detail"].lower()
    assert "già presente" in detail or "gia presente" in detail, detail


def test_arrivi_rejects_duplicate_serial_in_payload(api, op_headers):
    s = _get_first_serialized(api)
    if not s:
        pytest.skip("no serialized item")
    r = requests.post(f"{BASE_URL}/api/arrivi/send", headers=op_headers, json={
        "operator": "Tester", "arrival_date": "2026-02-14", "fornitore": "TestSup",
        "items": [{"page_id": s["id"], "name": s["name"], "serialized": True, "quantity": 2,
                   "serials": ["DUP_ARRIVAL_TEST_XYZ", "DUP_ARRIVAL_TEST_XYZ"]}]
    }, timeout=90)
    assert r.status_code == 409, r.text[:300]
    assert "inserito più volte" in r.json()["detail"].lower()


def test_arrivi_rejects_serialized_wrong_serial_count(op_headers):
    r = requests.post(f"{BASE_URL}/api/arrivi/send", headers=op_headers, json={
        "operator": "T", "arrival_date": "2026-02-14", "fornitore": "TestSup",
        "items": [{"page_id": "abc", "name": "P", "serialized": True, "quantity": 3, "serials": ["A"]}]
    })
    assert r.status_code == 400
    assert "seriali" in r.json()["detail"].lower()
