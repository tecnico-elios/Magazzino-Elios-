"""F6-quantita: prodotti A Quantità con barcode ripetuto NON devono essere trattati
come seriali univoci. Il barcode identifica il modello, non la singola unità.
Test READ-ONLY sul lookup — nessuna riga creata su Notion."""
import os
import requests
import pytest

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "").rstrip("/")
if not BASE_URL:
    with open("/app/frontend/.env") as f:
        for line in f:
            if line.startswith("REACT_APP_BACKEND_URL="):
                BASE_URL = line.split("=", 1)[1].strip().rstrip("/")
                break


@pytest.fixture(scope="module")
def api():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


def test_lookup_barcode_of_a_quantita_returns_ok(api):
    """Se un prodotto è A Quantità e il codice viene trovato in Receipts/Tracker,
    la risposta deve essere status='ok' matched_by='barcode' — MAI in_warehouse/out."""
    mov = api.get(f"{BASE_URL}/api/movimenti", timeout=60).json()["items"]
    # Trova un movimento di un prodotto A Quantità con codice non vuoto
    inv = api.get(f"{BASE_URL}/api/inventory", timeout=60).json().get("items", [])
    quantita_ids = {i["id"] for i in inv if i.get("tipo_gestione") == "a_quantita"}
    tested = False
    for m in mov:
        code = (m.get("serial_or_code") or "").strip()
        if not code or " " in code or "," in code or ";" in code:
            continue
        # We need to know the product_id but /api/movimenti aggregates only name.
        # Try lookup and check the returned item's tipo_gestione.
        r = api.get(f"{BASE_URL}/api/inventory/lookup", params={"code": code}, timeout=30)
        if r.status_code != 200:
            continue
        d = r.json()
        item = d.get("item") or {}
        if item.get("tipo_gestione") == "a_quantita":
            assert d["status"] == "ok", f"expected ok for barcode of a_quantita, got {d['status']}"
            assert d["matched_by"] in ("barcode", "sku")
            tested = True
            break
    if not tested:
        pytest.skip("no a_quantita product with single-token code in Notion history")


def test_lookup_sku_of_a_quantita_still_returns_ok_sku(api):
    """SKU (Codice prodotto in Inventario) di un prodotto A Quantità deve
    ritornare status='ok' matched_by='sku'."""
    inv = api.get(f"{BASE_URL}/api/inventory", timeout=60).json().get("items", [])
    q_item = next(
        (i for i in inv if i.get("tipo_gestione") == "a_quantita" and i.get("code")),
        None,
    )
    if not q_item:
        pytest.skip("no a_quantita product with SKU")
    r = api.get(f"{BASE_URL}/api/inventory/lookup", params={"code": q_item["code"]}, timeout=30)
    assert r.status_code == 200
    d = r.json()
    assert d["status"] == "ok"
    assert d["matched_by"] == "sku"


def test_lookup_sn_of_a_seriale_still_returns_status(api):
    """Regressione: SN di un prodotto A Seriale continua a tornare in_warehouse|out."""
    r = api.get(f"{BASE_URL}/api/inventory/lookup", params={"code": "1375364"}, timeout=30)
    assert r.status_code == 200
    d = r.json()
    if d["status"] == "not_found":
        pytest.skip("SN 1375364 not in Notion anymore")
    # If found as SN of a_seriale product, status must be in_warehouse|out
    item = d.get("item") or {}
    if item.get("tipo_gestione") == "a_seriale":
        assert d["status"] in ("in_warehouse", "out")
        assert d["matched_by"] == "sn"
