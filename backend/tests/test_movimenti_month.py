"""F6-opt: /api/movimenti con filtro mensile server-side (Notion)."""
import os
import requests
import pytest
from datetime import date

BASE_URL = None
if os.environ.get("REACT_APP_BACKEND_URL"):
    BASE_URL = os.environ["REACT_APP_BACKEND_URL"].rstrip("/")
else:
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


def _current_month():
    d = date.today()
    return f"{d.year:04d}-{d.month:02d}"


def test_movimenti_default_no_month(api):
    """Senza `month` legge l'intero storico (retro-compat)."""
    r = api.get(f"{BASE_URL}/api/movimenti", timeout=60)
    assert r.status_code == 200, r.text[:200]
    j = r.json()
    assert "items" in j and "count" in j
    assert j.get("month") is None
    assert j.get("date_from") is None
    assert j.get("date_to") is None


def test_movimenti_month_current(api):
    m = _current_month()
    r = api.get(f"{BASE_URL}/api/movimenti", params={"month": m}, timeout=60)
    assert r.status_code == 200, r.text[:200]
    j = r.json()
    assert j["month"] == m
    assert j["date_from"] == f"{m}-01"
    # date_to = ultimo giorno del mese
    from calendar import monthrange
    y, mm = int(m.split("-")[0]), int(m.split("-")[1])
    last = monthrange(y, mm)[1]
    assert j["date_to"] == f"{m}-{last:02d}"
    # tutte le date restituite devono rientrare nel mese
    for it in j["items"]:
        d = it.get("date")
        if d:
            assert d[:7] == m, f"item date {d} fuori mese {m}"


def test_movimenti_month_past(api):
    """Un mese storico deve restituire 0 o più righe SOLO di quel mese."""
    r = api.get(f"{BASE_URL}/api/movimenti", params={"month": "2020-01"}, timeout=60)
    assert r.status_code == 200
    j = r.json()
    assert j["month"] == "2020-01"
    for it in j["items"]:
        d = it.get("date")
        if d:
            assert d[:7] == "2020-01"


def test_movimenti_month_invalid_format(api):
    r = api.get(f"{BASE_URL}/api/movimenti", params={"month": "not-a-date"}, timeout=30)
    assert r.status_code == 400
    r = api.get(f"{BASE_URL}/api/movimenti", params={"month": "2026-13"}, timeout=30)
    assert r.status_code == 400


def test_movimenti_sorted_desc(api):
    """Ordinamento discendente per data."""
    r = api.get(f"{BASE_URL}/api/movimenti", timeout=60)
    j = r.json()
    dates = [it.get("date") for it in j["items"] if it.get("date")]
    assert dates == sorted(dates, reverse=True), "movimenti non ordinati desc"
