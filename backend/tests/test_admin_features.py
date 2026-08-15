"""Backend tests for Magazzino Elios Tech admin features.
Phase 2 migration: rotte admin protette da JWT (Bearer). X-Admin-Password legacy
resta attivo per `/api/admin/login` (deprecato) — le rotte admin veri usano JWT."""
import os
import requests
import pytest

from conftest import BASE_URL


@pytest.fixture(scope="module")
def api():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


# ---- Health / rebrand ----
def test_root(api):
    r = api.get(f"{BASE_URL}/api/")
    assert r.status_code == 200
    j = r.json()
    assert j.get("status") == "ok"
    # Rebrand check
    assert j.get("service") == "Magazzino Elios Tech"
    assert j.get("notion_configured") is True


# ---- Legacy admin/login endpoint (X-Admin-Password) — deprecated but kept ----
def test_legacy_admin_login_wrong(api):
    r = api.post(f"{BASE_URL}/api/admin/login", json={"password": "wrong"})
    assert r.status_code == 401


def test_admin_history_requires_auth(api):
    r = api.get(f"{BASE_URL}/api/admin/history")
    assert r.status_code == 401


def test_admin_history_rejects_operator(op_headers):
    """Un Operatore NON deve poter accedere alle rotte admin (403)."""
    r = requests.get(f"{BASE_URL}/api/admin/history", headers=op_headers)
    assert r.status_code == 403


# ---- Admin history + filters (JWT admin) ----
def test_admin_history_no_filter(admin_headers):
    r = requests.get(f"{BASE_URL}/api/admin/history", headers=admin_headers)
    assert r.status_code == 200
    j = r.json()
    assert "items" in j and "count" in j
    assert isinstance(j["items"], list)
    assert j["count"] == len(j["items"])


def test_admin_history_cliente_filter(admin_headers):
    all_r = requests.get(f"{BASE_URL}/api/admin/history", headers=admin_headers).json()
    if not all_r["items"]:
        pytest.skip("No history to filter")
    sample = all_r["items"][0].get("structure", "")
    if not sample:
        pytest.skip("empty structure")
    frag = sample[:4]
    r = requests.get(f"{BASE_URL}/api/admin/history", headers=admin_headers, params={"cliente": frag})
    assert r.status_code == 200
    j = r.json()
    assert j["count"] <= all_r["count"]
    for it in j["items"]:
        assert frag.lower() in (it.get("structure") or "").lower()


def test_admin_history_date_filter(admin_headers):
    r = requests.get(f"{BASE_URL}/api/admin/history", headers=admin_headers,
                     params={"date_from": "1900-01-01", "date_to": "1900-12-31"})
    assert r.status_code == 200
    assert r.json()["count"] == 0


def test_admin_history_materiale_filter(admin_headers):
    r = requests.get(f"{BASE_URL}/api/admin/history", headers=admin_headers,
                     params={"materiale": "ZZZZ_NOSUCH_ITEM"})
    assert r.status_code == 200
    assert r.json()["count"] == 0


def test_admin_history_ddt_param_ignored(admin_headers):
    r = requests.get(f"{BASE_URL}/api/admin/history", headers=admin_headers,
                     params={"ddt": "IGNORED_LEGACY"})
    assert r.status_code == 200


# ---- Notion exits ----
def test_admin_notion_exits(admin_headers):
    r = requests.get(f"{BASE_URL}/api/admin/notion-exits", headers=admin_headers, timeout=60)
    assert r.status_code == 200, r.text
    j = r.json()
    assert "items" in j and "count" in j
    assert isinstance(j["items"], list)
    if j["count"] > 0:
        sample = j["items"][0]
        for f in ("id", "sn", "cliente", "quantity", "date"):
            assert f in sample, f"missing field {f}"
        assert "item_name" in sample
        assert "unit" in sample


def test_admin_notion_exits_requires_auth(api):
    r = api.get(f"{BASE_URL}/api/admin/notion-exits")
    assert r.status_code == 401


def test_admin_history_pdf_endpoint_removed(admin_headers):
    r = requests.get(f"{BASE_URL}/api/admin/history/anyid/pdf", headers=admin_headers)
    assert r.status_code == 404


# ---- F0 strict-serial submit validation (usando op JWT) ----
def test_submit_rejects_unknown_serial(api, op_headers):
    inv = api.get(f"{BASE_URL}/api/inventory").json().get("items", [])
    serialized = next((it for it in inv if it.get("serialized") and (it.get("quantity") or 0) >= 1), None)
    if not serialized:
        pytest.skip("no serialized item available")
    fake_sn = "ELIOSTEST_UNKNOWN_SN_9999999"
    payload = {
        "operator": "Test F0",
        "shipping_date": "2026-02-14",
        "structure": "TEST_CLIENTE_F0_STRICT",
        "items": [{
            "page_id": serialized["id"],
            "name": serialized["name"],
            "category": serialized.get("category"),
            "unit": serialized.get("unit") or "pz",
            "serialized": True,
            "quantity": 1,
            "serials": [fake_sn],
        }],
    }
    r = requests.post(f"{BASE_URL}/api/checklist/send", headers=op_headers, json=payload, timeout=90)
    assert r.status_code == 409, f"Expected 409, got {r.status_code}: {r.text[:200]}"
    detail = (r.json().get("detail") or "").lower()
    assert "non risulta presente" in detail or "mai entrato" in detail, detail


def test_submit_rejects_duplicate_serial_in_same_shipment(api, op_headers):
    inv = api.get(f"{BASE_URL}/api/inventory").json().get("items", [])
    serialized = next((it for it in inv if it.get("serialized") and (it.get("quantity") or 0) >= 2), None)
    if not serialized:
        pytest.skip("need a serialized item with qty>=2")
    fake_sn = "DUP_TEST_SN_00001"
    payload = {
        "operator": "Test F0",
        "shipping_date": "2026-02-14",
        "structure": "TEST_CLIENTE_F0_DUP",
        "items": [{
            "page_id": serialized["id"],
            "name": serialized["name"],
            "category": serialized.get("category"),
            "unit": serialized.get("unit") or "pz",
            "serialized": True,
            "quantity": 2,
            "serials": [fake_sn, fake_sn],
        }],
    }
    r = requests.post(f"{BASE_URL}/api/checklist/send", headers=op_headers, json=payload, timeout=90)
    assert r.status_code == 409, r.text[:300]
    detail = (r.json().get("detail") or "").lower()
    assert ("inserito più volte" in detail) or ("non risulta presente" in detail), detail
