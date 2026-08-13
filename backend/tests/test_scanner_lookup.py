"""Tests for /api/inventory/lookup scanner endpoint."""
import os
import pytest
import requests

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', 'https://stock-dispatch-12.preview.emergentagent.com').rstrip('/')


@pytest.fixture(scope="module")
def api():
    s = requests.Session()
    return s


def test_health(api):
    r = api.get(f"{BASE_URL}/api/")
    assert r.status_code == 200
    assert r.json().get("status") == "ok"


def test_lookup_sku_ch02(api):
    r = api.get(f"{BASE_URL}/api/inventory/lookup", params={"code": "CH02"})
    assert r.status_code == 200, r.text
    data = r.json()
    assert data["status"] == "ok"
    assert data["matched_by"] == "sku"
    assert data["item"]["name"] == "Cable Dock Daze"
    assert data["item"]["quantity"] > 0
    assert data["item"]["serialized"] is False


def test_lookup_not_found(api):
    r = api.get(f"{BASE_URL}/api/inventory/lookup", params={"code": "INVALID_XYZ_123"})
    assert r.status_code == 200
    data = r.json()
    assert data["status"] == "not_found"
    assert data["code"] == "INVALID_XYZ_123"


def test_lookup_empty_code(api):
    r = api.get(f"{BASE_URL}/api/inventory/lookup", params={"code": ""})
    assert r.status_code == 400
    assert "Codice mancante" in r.json().get("detail", "")


def test_lookup_case_insensitive(api):
    r = api.get(f"{BASE_URL}/api/inventory/lookup", params={"code": "ch02"})
    assert r.status_code == 200
    assert r.json()["status"] == "ok"


def test_inventory_has_wallbox_with_code(api):
    """Find a Wallbox SKU for the frontend test."""
    r = api.get(f"{BASE_URL}/api/inventory")
    assert r.status_code == 200
    items = r.json()["items"]
    wallboxes = [i for i in items if (i.get("category") or "").lower() == "wallbox" and i.get("code") and (i.get("quantity") or 0) > 0]
    assert len(wallboxes) > 0, "No wallbox with code and stock available"
    # Store for informational purposes
    print(f"Wallbox candidate: code={wallboxes[0]['code']} name={wallboxes[0]['name']} serialized={wallboxes[0].get('serialized')}")
