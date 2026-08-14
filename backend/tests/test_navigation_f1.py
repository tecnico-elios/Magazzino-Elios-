"""F1 backend regression tests: root, inventory, lookup, strict serial validation, admin, removed PDF endpoint."""
import os
import requests
import pytest

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://stock-dispatch-12.preview.emergentagent.com").rstrip("/")


def _get(path, **kw):
    return requests.get(f"{BASE_URL}{path}", timeout=30, **kw)


def _post(path, **kw):
    return requests.post(f"{BASE_URL}{path}", timeout=60, **kw)


def test_root_service_name():
    r = _get("/api/")
    assert r.status_code == 200
    data = r.json()
    assert data.get("service") == "Magazzino Elios Tech"
    assert data.get("notion_configured") is True


def test_inventory_populated():
    r = _get("/api/inventory")
    assert r.status_code == 200
    d = r.json()
    assert "items" in d and "categories" in d
    assert len(d["items"]) > 0, "inventory should not be empty"
    assert isinstance(d["categories"], list)


def test_lookup_not_found():
    r = _get("/api/inventory/lookup", params={"code": "NEVER_EXISTS_XYZ_12345"})
    assert r.status_code == 200
    assert r.json().get("status") == "not_found"


def _first_serialized_item():
    r = _get("/api/inventory")
    for it in r.json().get("items", []):
        if it.get("serialized") and (it.get("quantity") or 0) > 0:
            return it
    return None


def test_checklist_send_fake_serial_rejected():
    item = _first_serialized_item()
    if not item:
        pytest.skip("No serialized item with stock to test with")
    payload = {
        "operator": "TEST_OP",
        "shipping_date": "2026-01-14",
        "structure": "TEST_CLIENT_DO_NOT_CREATE",
        "taken_by": "TEST_OP",
        "notes": None,
        "items": [{
            "page_id": item["id"],
            "name": item["name"],
            "category": item.get("category"),
            "unit": item.get("unit") or "pz",
            "serialized": True,
            "quantity": 1,
            "serials": ["NEVER_SEEN_XYZ_FAKE_9999"],
        }],
    }
    r = _post("/api/checklist/send", json=payload)
    assert r.status_code == 409, f"expected 409, got {r.status_code}: {r.text[:300]}"
    detail = (r.json().get("detail") or "").lower()
    assert "mai entrato in magazzino" in detail or "non risulta presente in magazzino" in detail, f"unexpected detail: {detail}"


def test_checklist_send_duplicate_serials_rejected():
    item = _first_serialized_item()
    if not item:
        pytest.skip("No serialized item with stock to test with")
    payload = {
        "operator": "TEST_OP",
        "shipping_date": "2026-01-14",
        "structure": "TEST_CLIENT_DO_NOT_CREATE",
        "taken_by": "TEST_OP",
        "notes": None,
        "items": [{
            "page_id": item["id"],
            "name": item["name"],
            "category": item.get("category"),
            "unit": item.get("unit") or "pz",
            "serialized": True,
            "quantity": 2,
            "serials": ["DUP_TEST_SN_ABC", "DUP_TEST_SN_ABC"],
        }],
    }
    r = _post("/api/checklist/send", json=payload)
    assert r.status_code == 409, f"expected 409, got {r.status_code}: {r.text[:300]}"
    detail = (r.json().get("detail") or "").lower()
    assert ("inserito più volte" in detail) or ("non risulta presente" in detail) or ("mai entrato" in detail), f"unexpected detail: {detail}"


def test_admin_history_requires_password():
    r = _get("/api/admin/history")
    assert r.status_code == 401


def test_admin_history_with_password():
    r = _get("/api/admin/history", headers={"X-Admin-Password": "admin123"})
    assert r.status_code == 200
    assert isinstance(r.json(), (list, dict))


def test_admin_history_pdf_removed():
    r = _get("/api/admin/history/some-id/pdf", headers={"X-Admin-Password": "admin123"})
    assert r.status_code == 404, f"expected 404, got {r.status_code}"
