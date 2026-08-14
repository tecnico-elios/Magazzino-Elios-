"""Backend tests for /api/inventory/lookup — Receipts SN branch (iteration 8)."""
import os
import requests
import pytest

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "").rstrip("/")
if not BASE_URL:
    # Fallback: read from frontend/.env
    with open("/app/frontend/.env") as f:
        for line in f:
            if line.startswith("REACT_APP_BACKEND_URL="):
                BASE_URL = line.split("=", 1)[1].strip().rstrip("/")


def _get(code):
    return requests.get(f"{BASE_URL}/api/inventory/lookup", params={"code": code}, timeout=60)


def test_receipts_sn_simple():
    r = _get("1427354")
    assert r.status_code == 200
    d = r.json()
    # F6-rientri: status is now in_warehouse or out (latest-movement), matched_by="sn"
    assert d["status"] in ("in_warehouse", "out")
    assert d["matched_by"] == "sn"
    assert d["serial"] == "1427354"
    assert d["item"] and d["item"]["name"]


def test_receipts_sn_dot_separated():
    r = _get("1425027")
    assert r.status_code == 200
    d = r.json()
    assert d["status"] in ("in_warehouse", "out")
    assert d["matched_by"] == "sn"
    assert d["serial"] == "1425027"
    assert d["item"] and d["item"]["name"]


def test_not_found():
    r = _get("9999999_NOT_EXIST")
    assert r.status_code == 200
    d = r.json()
    assert d["status"] == "not_found"


def test_sku_regression():
    r = _get("CH02")
    assert r.status_code == 200
    d = r.json()
    assert d["status"] == "ok"
    assert d["matched_by"] == "sku"
    assert d["item"]["name"] == "Cable Dock Daze"
