"""Backend tests for F2 Arrivi endpoints."""
import os
import requests
import pytest

BASE_URL = os.environ['REACT_APP_BACKEND_URL'].rstrip('/') if os.environ.get('REACT_APP_BACKEND_URL') else None
if not BASE_URL:
    with open('/app/frontend/.env') as f:
        for line in f:
            if line.startswith('REACT_APP_BACKEND_URL='):
                BASE_URL = line.split('=', 1)[1].strip().rstrip('/')
                break


@pytest.fixture(scope="module")
def api():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


def _get_first_serialized(api):
    r = api.get(f"{BASE_URL}/api/inventory")
    items = r.json().get("items", [])
    return next((i for i in items if i.get("serialized")), None)


def test_arrivi_validation_missing_fornitore(api):
    r = api.post(f"{BASE_URL}/api/arrivi/send", json={
        "operator": "T", "arrival_date": "2026-02-14", "fornitore": "",
        "items": [{"page_id": "x", "name": "y", "serialized": False, "quantity": 1, "serials": []}]
    })
    assert r.status_code == 400
    assert "fornitore" in r.json()["detail"].lower()


def test_arrivi_validation_missing_operator(api):
    r = api.post(f"{BASE_URL}/api/arrivi/send", json={
        "operator": "", "arrival_date": "2026-02-14", "fornitore": "TestSup",
        "items": [{"page_id": "x", "name": "y", "serialized": False, "quantity": 1, "serials": []}]
    })
    assert r.status_code == 400
    assert "operatore" in r.json()["detail"].lower()


def test_arrivi_validation_empty_items(api):
    r = api.post(f"{BASE_URL}/api/arrivi/send", json={
        "operator": "T", "arrival_date": "2026-02-14", "fornitore": "TestSup", "items": []
    })
    assert r.status_code == 400


def test_arrivi_rejects_serial_already_shipped(api):
    """SN 1384516 è già uscito storicamente — deve essere rifiutato all'arrivo."""
    s = _get_first_serialized(api)
    if not s:
        pytest.skip("no serialized item")
    r = api.post(f"{BASE_URL}/api/arrivi/send", json={
        "operator": "Tester", "arrival_date": "2026-02-14", "fornitore": "TestSup",
        "items": [{"page_id": s["id"], "name": s["name"], "serialized": True, "quantity": 1, "serials": ["1384516"]}]
    }, timeout=90)
    assert r.status_code == 409, r.text[:300]
    detail = r.json()["detail"].lower()
    # o già in entrate o in uscite: entrambi validi rifiuti
    assert ("entrate" in detail) or ("uscite" in detail)


def test_arrivi_rejects_duplicate_serial_in_payload(api):
    s = _get_first_serialized(api)
    if not s:
        pytest.skip("no serialized item")
    r = api.post(f"{BASE_URL}/api/arrivi/send", json={
        "operator": "Tester", "arrival_date": "2026-02-14", "fornitore": "TestSup",
        "items": [{"page_id": s["id"], "name": s["name"], "serialized": True, "quantity": 2,
                   "serials": ["DUP_ARRIVAL_TEST_XYZ", "DUP_ARRIVAL_TEST_XYZ"]}]
    }, timeout=90)
    assert r.status_code == 409, r.text[:300]
    assert "inserito più volte" in r.json()["detail"].lower()


def test_arrivi_rejects_serialized_wrong_serial_count(api):
    """Se serialized=True e serials.length != quantity → 400."""
    r = api.post(f"{BASE_URL}/api/arrivi/send", json={
        "operator": "T", "arrival_date": "2026-02-14", "fornitore": "TestSup",
        "items": [{"page_id": "abc", "name": "P", "serialized": True, "quantity": 3, "serials": ["A"]}]
    })
    assert r.status_code == 400
    assert "seriali" in r.json()["detail"].lower()
