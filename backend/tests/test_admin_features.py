"""Backend tests for new admin features: history filters, notion-exits, PDF DDT."""
import os
import re
import requests
import pytest

BASE_URL = os.environ['REACT_APP_BACKEND_URL'].rstrip('/') if os.environ.get('REACT_APP_BACKEND_URL') else None
if not BASE_URL:
    # Fallback: read from frontend .env
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


# ---- Health ----
def test_root(api):
    r = api.get(f"{BASE_URL}/api/")
    assert r.status_code == 200
    j = r.json()
    assert j.get("status") == "ok"
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
    # use first 4 chars
    frag = sample[:4]
    r = api.get(f"{BASE_URL}/api/admin/history", headers=ADMIN_HEADERS, params={"cliente": frag})
    assert r.status_code == 200
    j = r.json()
    assert j["count"] <= all_r["count"]
    for it in j["items"]:
        assert frag.lower() in (it.get("structure") or "").lower()


def test_admin_history_ddt_filter(api):
    r = api.get(f"{BASE_URL}/api/admin/history", headers=ADMIN_HEADERS, params={"ddt": "NONEXISTENT_DDT_XYZ_12345"})
    assert r.status_code == 200
    assert r.json()["count"] == 0


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


# ---- Notion exits ----
def test_admin_notion_exits(api):
    r = api.get(f"{BASE_URL}/api/admin/notion-exits", headers=ADMIN_HEADERS, timeout=60)
    assert r.status_code == 200, r.text
    j = r.json()
    assert "items" in j and "count" in j
    assert isinstance(j["items"], list)
    if j["count"] > 0:
        sample = j["items"][0]
        # Expected fields per review request
        for f in ("id", "sn", "cliente", "quantity", "date"):
            assert f in sample, f"missing field {f}"
        # item_name should be present (may be None but key exists)
        assert "item_name" in sample
        assert "unit" in sample


def test_admin_notion_exits_cliente_filter(api):
    r_all = api.get(f"{BASE_URL}/api/admin/notion-exits", headers=ADMIN_HEADERS, timeout=60).json()
    if r_all["count"] == 0:
        pytest.skip("no exits")
    # find a cliente that exists
    cli = None
    for it in r_all["items"]:
        if it.get("cliente"):
            cli = it["cliente"][:5]
            break
    if not cli:
        pytest.skip("no cliente present")
    r = api.get(f"{BASE_URL}/api/admin/notion-exits", headers=ADMIN_HEADERS,
                params={"cliente": cli}, timeout=60)
    assert r.status_code == 200
    j = r.json()
    assert j["count"] <= r_all["count"]
    for it in j["items"]:
        assert cli.lower() in (it.get("cliente") or "").lower()


def test_admin_notion_exits_requires_auth(api):
    r = api.get(f"{BASE_URL}/api/admin/notion-exits")
    assert r.status_code == 401


# ---- PDF DDT ----
def test_admin_history_pdf_404(api):
    r = api.get(f"{BASE_URL}/api/admin/history/nonexistent-id-xyz/pdf", headers=ADMIN_HEADERS)
    assert r.status_code == 404


def test_admin_history_pdf_ok(api):
    hist = api.get(f"{BASE_URL}/api/admin/history", headers=ADMIN_HEADERS).json()
    if not hist["items"]:
        pytest.skip("No history to generate PDF")
    cid = hist["items"][0]["id"]
    r = api.get(f"{BASE_URL}/api/admin/history/{cid}/pdf", headers=ADMIN_HEADERS)
    assert r.status_code == 200
    assert r.headers.get("content-type", "").startswith("application/pdf")
    disp = r.headers.get("content-disposition", "")
    assert "DDT-" in disp
    # basic PDF magic bytes
    assert r.content[:4] == b"%PDF"
    assert len(r.content) > 500


def test_admin_history_pdf_requires_auth(api):
    r = api.get(f"{BASE_URL}/api/admin/history/some-id/pdf")
    assert r.status_code == 401
