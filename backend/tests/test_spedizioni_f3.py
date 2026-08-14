"""F3 Spedizioni — nuovi test backend per taken_by e strict serial submit."""
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


def _first_serialized(api):
    inv = api.get(f"{BASE_URL}/api/inventory").json().get("items", [])
    return next((i for i in inv if i.get("serialized") and (i.get("quantity") or 0) >= 1), None)


def _first_quantity(api):
    inv = api.get(f"{BASE_URL}/api/inventory").json().get("items", [])
    return next((i for i in inv if not i.get("serialized") and (i.get("quantity") or 0) >= 1), None)


def test_spedizione_missing_taken_by(api):
    """F3: taken_by è obbligatorio."""
    r = api.post(f"{BASE_URL}/api/checklist/send", json={
        "operator": "T", "shipping_date": "2026-02-14",
        "structure": "TEST_CLIENTE_F3",
        "taken_by": "",   # empty
        "items": [{"page_id": "x", "name": "y", "serialized": False, "quantity": 1, "serials": []}],
    })
    assert r.status_code == 400
    assert "preso da" in r.json()["detail"].lower()


def test_spedizione_missing_cliente(api):
    r = api.post(f"{BASE_URL}/api/checklist/send", json={
        "operator": "T", "shipping_date": "2026-02-14",
        "structure": "",
        "taken_by": "Mario",
        "items": [{"page_id": "x", "name": "y", "serialized": False, "quantity": 1, "serials": []}],
    })
    assert r.status_code == 400
    assert "cliente" in r.json()["detail"].lower()


def test_spedizione_strict_serial_not_in_receipts(api):
    """SN mai entrato → 409 'non risulta presente in magazzino (mai entrato)'."""
    s = _first_serialized(api)
    if not s:
        pytest.skip("no serialized item")
    r = api.post(f"{BASE_URL}/api/checklist/send", json={
        "operator": "T", "shipping_date": "2026-02-14",
        "structure": "TEST_CLIENTE_F3",
        "taken_by": "Mario Rossi",
        "items": [{"page_id": s["id"], "name": s["name"], "serialized": True, "quantity": 1,
                   "serials": ["NEVER_F3_SN_XYZ"]}],
    }, timeout=90)
    assert r.status_code == 409, r.text[:300]
    assert "non risulta presente" in r.json()["detail"].lower()


def test_spedizione_duplicate_serial(api):
    s = _first_serialized(api)
    if not s:
        pytest.skip("no serialized item")
    r = api.post(f"{BASE_URL}/api/checklist/send", json={
        "operator": "T", "shipping_date": "2026-02-14",
        "structure": "TEST_CLIENTE_F3",
        "taken_by": "Mario Rossi",
        "items": [{"page_id": s["id"], "name": s["name"], "serialized": True, "quantity": 2,
                   "serials": ["DUP_F3_A", "DUP_F3_A"]}],
    }, timeout=90)
    assert r.status_code == 409
    d = r.json()["detail"].lower()
    assert ("inserito più volte" in d) or ("non risulta presente" in d)


def test_spedizione_quantity_over_stock(api):
    """Prodotto A Quantità: se quantity > stock → 409 'Quantità non disponibile'."""
    q = _first_quantity(api)
    if not q:
        pytest.skip("no quantity item")
    r = api.post(f"{BASE_URL}/api/checklist/send", json={
        "operator": "T", "shipping_date": "2026-02-14",
        "structure": "TEST_CLIENTE_F3",
        "taken_by": "Mario Rossi",
        "items": [{"page_id": q["id"], "name": q["name"], "serialized": False, "quantity": 99999999, "serials": []}],
    }, timeout=90)
    assert r.status_code == 409
    assert "non disponibile" in r.json()["detail"].lower()
