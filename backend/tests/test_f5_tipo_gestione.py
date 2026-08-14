"""F5 backend tests — Tipo Gestione (Notion SSOT) + Dashboard KPI + Admin update."""
import os
import requests
import pytest

BASE_URL = None
if os.environ.get("REACT_APP_BACKEND_URL"):
    BASE_URL = os.environ["REACT_APP_BACKEND_URL"].rstrip("/")
else:
    with open("/app/frontend/.env") as f:
        for line in f:
            if line.startswith("REACT_APP_BACKEND_URL="):
                BASE_URL = line.split("=", 1)[1].strip().rstrip("/")
                break

ADMIN_HEADERS = {"X-Admin-Password": "admin123"}


@pytest.fixture(scope="module")
def api():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


# ---- Notion Tipo Gestione exposed via /api/inventory ----
def test_inventory_exposes_tipo_gestione(api):
    r = api.get(f"{BASE_URL}/api/inventory", timeout=60)
    assert r.status_code == 200
    items = r.json().get("items", [])
    assert len(items) > 0
    for it in items:
        # Every item must expose tipo_gestione (may be None) + configured bool
        assert "tipo_gestione" in it, f"missing tipo_gestione on {it.get('name')}"
        assert "configured" in it, f"missing configured on {it.get('name')}"
        if it["configured"]:
            assert it["tipo_gestione"] in ("a_seriale", "a_quantita")
            assert it["serialized"] == (it["tipo_gestione"] == "a_seriale")
        else:
            assert it["tipo_gestione"] is None


def test_inventory_has_configured_products(api):
    """At least SOME products must have Tipo Gestione set (user configured them on Notion)."""
    r = api.get(f"{BASE_URL}/api/inventory", timeout=60)
    items = r.json().get("items", [])
    configured = [it for it in items if it.get("configured")]
    assert len(configured) > 0, "Expected at least one product with Tipo Gestione set"


# ---- Dashboard KPI endpoint ----
def test_dashboard_kpi_shape(api):
    r = api.get(f"{BASE_URL}/api/dashboard/kpi", timeout=90)
    assert r.status_code == 200, r.text[:200]
    j = r.json()
    for field in (
        "total_products",
        "total_units",
        "arrivi_today",
        "spedizioni_today",
        "sotto_scorta",
        "esauriti",
        "non_configurati",
        "recent_movements",
        "refreshed_at",
        "low_stock_threshold",
    ):
        assert field in j, f"missing field {field}"
    assert isinstance(j["sotto_scorta"], list)
    assert isinstance(j["esauriti"], list)
    assert isinstance(j["non_configurati"], list)
    assert isinstance(j["recent_movements"], list)
    assert len(j["recent_movements"]) <= 10


def test_dashboard_kpi_totals_match_inventory(api):
    inv = api.get(f"{BASE_URL}/api/inventory", timeout=60).json()
    kpi = api.get(f"{BASE_URL}/api/dashboard/kpi", timeout=60).json()
    assert kpi["total_products"] == len(inv.get("items", []))


def test_dashboard_kpi_movements_have_type(api):
    kpi = api.get(f"{BASE_URL}/api/dashboard/kpi", timeout=60).json()
    for m in kpi["recent_movements"]:
        assert m["type"] in ("arrivo", "spedizione")


# ---- Admin update Tipo Gestione DIRECT-to-Notion ----
def test_admin_update_tipo_gestione_requires_auth(api):
    r = api.put(
        f"{BASE_URL}/api/admin/inventory/tipo-gestione",
        json={"page_id": "fake", "tipo_gestione": "a_seriale"},
    )
    assert r.status_code == 401


def test_admin_update_tipo_gestione_invalid_value(api):
    inv = api.get(f"{BASE_URL}/api/inventory", timeout=60).json().get("items", [])
    if not inv:
        pytest.skip("no inventory")
    sample = inv[0]
    r = api.put(
        f"{BASE_URL}/api/admin/inventory/tipo-gestione",
        headers=ADMIN_HEADERS,
        json={"page_id": sample["id"], "tipo_gestione": "banana"},
    )
    assert r.status_code == 400


def test_admin_update_tipo_gestione_roundtrip(api):
    """Update a product's Tipo Gestione via API → verify Notion returns the new value."""
    inv = api.get(f"{BASE_URL}/api/inventory", timeout=60).json().get("items", [])
    # Pick a configured 'A Quantità' item to flip and restore
    target = next(
        (it for it in inv if it.get("tipo_gestione") == "a_quantita"),
        None,
    )
    if not target:
        pytest.skip("no 'a_quantita' item to flip")
    original = target["tipo_gestione"]

    try:
        # Flip to a_seriale
        r = api.put(
            f"{BASE_URL}/api/admin/inventory/tipo-gestione",
            headers=ADMIN_HEADERS,
            json={"page_id": target["id"], "tipo_gestione": "a_seriale"},
            timeout=30,
        )
        assert r.status_code == 200, r.text[:200]

        # Re-read fresh (bypass cache via /api/inventory force_refresh path)
        inv2 = api.get(f"{BASE_URL}/api/inventory", timeout=60).json().get("items", [])
        updated = next((it for it in inv2 if it["id"] == target["id"]), None)
        assert updated is not None
        assert updated["tipo_gestione"] == "a_seriale"
        assert updated["serialized"] is True
        assert updated["configured"] is True
    finally:
        # Restore original
        api.put(
            f"{BASE_URL}/api/admin/inventory/tipo-gestione",
            headers=ADMIN_HEADERS,
            json={"page_id": target["id"], "tipo_gestione": original},
            timeout=30,
        )


# ---- Admin inventory list exposes tipo_gestione ----
def test_admin_inventory_exposes_tipo_gestione(api):
    r = api.get(f"{BASE_URL}/api/admin/inventory", headers=ADMIN_HEADERS, timeout=60)
    assert r.status_code == 200
    items = r.json().get("items", [])
    assert len(items) > 0
    for it in items:
        assert "tipo_gestione" in it
        assert "configured" in it
        assert "serialized" in it


# ---- No secondary source of truth (MongoDB override) ----
def test_no_mongo_override_effect(api):
    """Ensure the deprecated /admin/inventory/serial endpoint now proxies to Notion,
    NOT to a Mongo override collection. After flipping, fresh Notion read must reflect."""
    inv = api.get(f"{BASE_URL}/api/inventory", timeout=60).json().get("items", [])
    target = next(
        (it for it in inv if it.get("tipo_gestione") == "a_quantita"),
        None,
    )
    if not target:
        pytest.skip("no 'a_quantita' item")
    original = target["tipo_gestione"]
    try:
        # Use deprecated endpoint — MUST now write to Notion
        r = api.put(
            f"{BASE_URL}/api/admin/inventory/serial",
            headers=ADMIN_HEADERS,
            json={"page_id": target["id"], "serialized": True},
            timeout=30,
        )
        assert r.status_code == 200
        inv2 = api.get(f"{BASE_URL}/api/inventory", timeout=60).json().get("items", [])
        updated = next((it for it in inv2 if it["id"] == target["id"]), None)
        # Notion value should now be a_seriale (came from Notion, not from Mongo override)
        assert updated["tipo_gestione"] == "a_seriale"
    finally:
        api.put(
            f"{BASE_URL}/api/admin/inventory/tipo-gestione",
            headers=ADMIN_HEADERS,
            json={"page_id": target["id"], "tipo_gestione": original},
            timeout=30,
        )


# ---- Submit blocks when tipo_gestione is NOT configured ----
def test_submit_arrivo_blocks_not_configured(api, monkeypatch=None):
    """If we could find a product with tipo_gestione=None, the arrivi submit should
    reject it with 400 and 'TIPO DI GESTIONE NON CONFIGURATO'."""
    inv = api.get(f"{BASE_URL}/api/inventory", timeout=60).json().get("items", [])
    unset = next((it for it in inv if not it.get("configured")), None)
    if not unset:
        pytest.skip("all products configured — cannot test not-configured block")
    payload = {
        "operator": "F5 Test",
        "arrival_date": "2026-02-14",
        "fornitore": "FORN_F5",
        "items": [
            {
                "page_id": unset["id"],
                "name": unset["name"],
                "unit": unset.get("unit") or "pz",
                "serialized": False,
                "quantity": 1,
                "serials": [],
            }
        ],
    }
    r = api.post(f"{BASE_URL}/api/arrivi/send", json=payload, timeout=60)
    assert r.status_code == 400, r.text[:200]
    assert "NON CONFIGURATO" in r.text.upper()
