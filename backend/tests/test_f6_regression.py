"""F6 — regression bug-sweep. All endpoints return sane data, no 500s.
READ-ONLY + FAKE_SN strict-validation. Zero real Notion writes.
Phase 2: admin routes use JWT; op JWT used for /checklist/send.
"""
import os
import requests
import pytest

from conftest import BASE_URL, _ensure_admin_token, _ensure_op_token

API = f"{BASE_URL}/api"
FAKE_SN = "F6FAKE_SN_NOT_EXISTS_XYZ"


def _admin_hdr():
    tok, _ = _ensure_admin_token()
    return {"Authorization": f"Bearer {tok}"}


def _op_hdr():
    admin_tok, _ = _ensure_admin_token()
    tok, _ = _ensure_op_token(admin_tok)
    return {"Authorization": f"Bearer {tok}", "Content-Type": "application/json"}


ADMIN_HDR = None  # populated lazily below to avoid module-import failures


def _unwrap(payload):
    """API returns either a list or {items:[...]} envelope."""
    if isinstance(payload, dict) and "items" in payload:
        return payload["items"]
    return payload


class TestPublicEndpoints:
    def test_inventory(self):
        r = requests.get(f"{API}/inventory", timeout=30)
        assert r.status_code == 200
        items = _unwrap(r.json())
        assert isinstance(items, list) and len(items) > 0
        it = items[0]
        assert "tipo_gestione" in it and "configured" in it

    def test_inventory_lookup_found(self):
        items = _unwrap(requests.get(f"{API}/inventory", timeout=30).json())
        code = next((i.get("code") or i.get("codice") for i in items if i.get("code") or i.get("codice")), None)
        assert code, "inventory has no code"
        r = requests.get(f"{API}/inventory/lookup", params={"code": code}, timeout=30)
        assert r.status_code == 200
        body = r.json()
        # accept either {found:true} or {status:"found"}
        assert body.get("found") is True or body.get("status") in ("found", "ok")

    def test_inventory_lookup_not_found(self):
        r = requests.get(f"{API}/inventory/lookup", params={"code": FAKE_SN}, timeout=30)
        assert r.status_code == 200
        body = r.json()
        assert body.get("found") is False or body.get("status") == "not_found"

    def test_movimenti_no_month(self):
        r = requests.get(f"{API}/movimenti", timeout=60)
        assert r.status_code == 200
        assert isinstance(_unwrap(r.json()), list)

    def test_movimenti_month_current(self):
        r = requests.get(f"{API}/movimenti", params={"month": "2026-01"}, timeout=60)
        assert r.status_code == 200
        body = r.json()
        assert body.get("month") == "2026-01"
        assert isinstance(_unwrap(body), list)

    def test_movimenti_month_invalid(self):
        r = requests.get(f"{API}/movimenti", params={"month": "not-a-month"}, timeout=30)
        assert r.status_code in (400, 422)

    def test_movimenti_sorted_desc(self):
        items = _unwrap(requests.get(f"{API}/movimenti", params={"month": "2026-01"}, timeout=60).json())
        if len(items) >= 2:
            dates = [i.get("created_time") or i.get("date") for i in items if i.get("created_time") or i.get("date")]
            assert dates == sorted(dates, reverse=True), "movimenti not sorted desc"

    def test_dashboard_kpi(self):
        r = requests.get(f"{API}/dashboard/kpi", timeout=60)
        assert r.status_code == 200
        d = r.json()
        for k in ("total_units", "arrivi_today", "spedizioni_today", "sotto_scorta", "esauriti", "non_configurati", "recent_movements"):
            assert k in d, f"missing kpi {k}"
        assert isinstance(d["sotto_scorta"], list)
        assert isinstance(d["recent_movements"], list)

    def test_anomalie(self):
        r = requests.get(f"{API}/anomalie", timeout=30)
        assert r.status_code == 200
        assert isinstance(_unwrap(r.json()), list)

    def test_checklist_history(self):
        r = requests.get(f"{API}/checklist/history", timeout=30)
        assert r.status_code == 200


class TestAdminEndpoints:
    def test_admin_inventory_requires_auth(self):
        r = requests.get(f"{API}/admin/inventory", timeout=30)
        assert r.status_code in (401, 403)

    def test_admin_inventory_ok(self):
        r = requests.get(f"{API}/admin/inventory", headers=_admin_hdr(), timeout=60)
        assert r.status_code == 200
        assert isinstance(_unwrap(r.json()), list)

    def test_admin_recipients(self):
        r = requests.get(f"{API}/admin/recipients", headers=_admin_hdr(), timeout=30)
        assert r.status_code == 200

    def test_admin_notion_exits(self):
        r = requests.get(f"{API}/admin/notion-exits", headers=_admin_hdr(), timeout=60)
        assert r.status_code == 200


class TestSerialStrictValidation:
    def _find_serialized_item(self):
        items = _unwrap(requests.get(f"{API}/inventory", timeout=30).json())
        return next((i for i in items if i.get("tipo_gestione") == "a_seriale"), None)

    def _find_quantity_item(self):
        items = _unwrap(requests.get(f"{API}/inventory", timeout=30).json())
        return next((i for i in items if i.get("tipo_gestione") == "a_quantita"), None)

    def test_shipment_unknown_serial_blocked(self):
        s = self._find_serialized_item()
        assert s, "no a_seriale item found"
        payload = {
            "operator": "TEST_F6", "taken_by": "TEST_F6",
            "structure": "TEST_F6_CLIENTE", "shipping_date": "2026-01-15",
            "items": [{"page_id": s["id"], "name": s["name"], "serialized": True, "quantity": 1, "serials": [FAKE_SN]}],
        }
        r = requests.post(f"{API}/checklist/send", headers=_op_hdr(), json=payload, timeout=60)
        assert r.status_code in (400, 409), f"expected block got {r.status_code}: {r.text[:200]}"
        assert "non risulta" in r.text.lower() or "presente" in r.text.lower()

    def test_shipment_duplicate_serial_blocked(self):
        s = self._find_serialized_item()
        assert s
        payload = {
            "operator": "TEST_F6", "taken_by": "TEST_F6",
            "structure": "TEST_F6_CLIENTE", "shipping_date": "2026-01-15",
            "items": [{"page_id": s["id"], "name": s["name"], "serialized": True, "quantity": 2, "serials": [FAKE_SN, FAKE_SN]}],
        }
        r = requests.post(f"{API}/checklist/send", headers=_op_hdr(), json=payload, timeout=60)
        assert r.status_code in (400, 409)
        assert "più volte" in r.text.lower() or "duplicat" in r.text.lower() or "non risulta" in r.text.lower()

    def test_shipment_quantity_over_stock(self):
        q = self._find_quantity_item()
        assert q
        payload = {
            "operator": "TEST_F6", "taken_by": "TEST_F6",
            "structure": "TEST_F6_CLIENTE", "shipping_date": "2026-01-15",
            "items": [{"page_id": q["id"], "name": q["name"], "serialized": False, "quantity": 99999999, "serials": []}],
        }
        r = requests.post(f"{API}/checklist/send", headers=_op_hdr(), json=payload, timeout=60)
        assert r.status_code in (400, 409)
        assert "quantit" in r.text.lower() or "disponibil" in r.text.lower()
