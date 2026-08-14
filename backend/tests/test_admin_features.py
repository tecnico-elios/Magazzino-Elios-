"""Backend tests for Magazzino Elios Tech admin features."""
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

ADMIN_HEADERS = {"X-Admin-Password": "admin123"}


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


# ---- Admin auth ----
def test_admin_login_wrong(api):
    r = api.post(f"{BASE_URL}/api/admin/login", json={"password": "wrong"})
    assert r.status_code == 401


def test_admin_login_ok(api):
    r = api.post(f"{BASE_URL}/api/admin/login", json={"password": "admin123"})
    assert r.status_code == 200


def test_admin_history_requires_auth(api):
    r = api.get(f"{BASE_URL}/api/admin/history")
    assert r.status_code == 401


# ---- Admin history + filters ----
def test_admin_history_no_filter(api):
    r = api.get(f"{BASE_URL}/api/admin/history", headers=ADMIN_HEADERS)
    assert r.status_code == 200
    j = r.json()
    assert "items" in j and "count" in j
    assert isinstance(j["items"], list)
    assert j["count"] == len(j["items"])


def test_admin_history_cliente_filter(api):
    all_r = api.get(f"{BASE_URL}/api/admin/history", headers=ADMIN_HEADERS).json()
    if not all_r["items"]:
        pytest.skip("No history to filter")
    sample = all_r["items"][0].get("structure", "")
    if not sample:
        pytest.skip("empty structure")
    frag = sample[:4]
    r = api.get(f"{BASE_URL}/api/admin/history", headers=ADMIN_HEADERS, params={"cliente": frag})
    assert r.status_code == 200
    j = r.json()
    assert j["count"] <= all_r["count"]
    for it in j["items"]:
        assert frag.lower() in (it.get("structure") or "").lower()


def test_admin_history_date_filter(api):
    r = api.get(f"{BASE_URL}/api/admin/history", headers=ADMIN_HEADERS,
                params={"date_from": "1900-01-01", "date_to": "1900-12-31"})
    assert r.status_code == 200
    assert r.json()["count"] == 0


def test_admin_history_materiale_filter(api):
    r = api.get(f"{BASE_URL}/api/admin/history", headers=ADMIN_HEADERS,
                params={"materiale": "ZZZZ_NOSUCH_ITEM"})
    assert r.status_code == 200
    assert r.json()["count"] == 0


def test_admin_history_ddt_param_ignored(api):
    """Legacy `ddt` query param should be silently ignored (no 422) after F0 cleanup."""
    r = api.get(f"{BASE_URL}/api/admin/history", headers=ADMIN_HEADERS,
                params={"ddt": "IGNORED_LEGACY"})
    assert r.status_code == 200


# ---- Notion exits ----
def test_admin_notion_exits(api):
    r = api.get(f"{BASE_URL}/api/admin/notion-exits", headers=ADMIN_HEADERS, timeout=60)
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


# ---- PDF endpoint removed in F0 ----
def test_admin_history_pdf_endpoint_removed(api):
    """PDF/DDT endpoint should no longer exist."""
    r = api.get(f"{BASE_URL}/api/admin/history/anyid/pdf", headers=ADMIN_HEADERS)
    assert r.status_code == 404


# ---- F0 strict-serial submit validation ----
def test_submit_rejects_unknown_serial(api):
    """A serialized item with a serial that is NOT in Inventory Receipts must be rejected."""
    inv = api.get(f"{BASE_URL}/api/inventory").json().get("items", [])
    serialized = next((it for it in inv if it.get("serialized") and (it.get("quantity") or 0) >= 1), None)
    if not serialized:
        pytest.skip("no serialized item available")
    fake_sn = "ELIOSTEST_UNKNOWN_SN_9999999"
    payload = {
        "operator": "Test F0",
        "shipping_date": "2026-02-14",
        "structure": "TEST_CLIENTE_F0_STRICT",
        "taken_by": "Tester",
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
    r = api.post(f"{BASE_URL}/api/checklist/send", json=payload, timeout=90)
    assert r.status_code == 409, f"Expected 409, got {r.status_code}: {r.text[:200]}"
    detail = (r.json().get("detail") or "").lower()
    assert "non risulta presente" in detail or "mai entrato" in detail, detail


def test_submit_rejects_duplicate_serial_in_same_shipment(api):
    """Two identical serials in one shipment must be rejected."""
    inv = api.get(f"{BASE_URL}/api/inventory").json().get("items", [])
    serialized = next((it for it in inv if it.get("serialized") and (it.get("quantity") or 0) >= 2), None)
    if not serialized:
        pytest.skip("need a serialized item with qty>=2")
    fake_sn = "DUP_TEST_SN_00001"
    payload = {
        "operator": "Test F0",
        "shipping_date": "2026-02-14",
        "structure": "TEST_CLIENTE_F0_DUP",
        "taken_by": "Tester",
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
    r = api.post(f"{BASE_URL}/api/checklist/send", json=payload, timeout=90)
    assert r.status_code == 409, r.text[:300]
    detail = (r.json().get("detail") or "").lower()
    # Either duplicate-in-shipment error OR unknown-serial error triggers first;
    # both are acceptable rejections.
    assert ("inserito più volte" in detail) or ("non risulta presente" in detail), detail
