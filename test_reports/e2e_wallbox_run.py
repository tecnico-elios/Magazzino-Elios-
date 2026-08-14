"""
One-shot F6 E2E test against REAL Notion (user-authorized).
Full wallbox A Seriale lifecycle: arrival -> ship -> return -> ship again + duplicate block.
"""
import os, time, json, sys
import requests

BASE = os.environ.get("REACT_APP_BACKEND_URL", "").rstrip("/")
if not BASE:
    for line in open("/app/frontend/.env"):
        if line.startswith("REACT_APP_BACKEND_URL="):
            BASE = line.split("=",1)[1].strip().rstrip("/")

S = requests.Session()
S.headers.update({"Content-Type": "application/json"})

def p(step, data):
    print(f"\n=== {step} ===")
    print(json.dumps(data, indent=2, ensure_ascii=False, default=str)[:2000])

def http(method, path, **kw):
    url = f"{BASE}{path}"
    r = S.request(method, url, timeout=60, **kw)
    try: body = r.json()
    except Exception: body = r.text
    print(f"{method} {path} -> {r.status_code}")
    return r, body

results = {"base_url": BASE, "steps": {}}

# ---------- pick a wallbox a_seriale product ----------
r, inv = http("GET", "/api/inventory")
assert r.status_code == 200, inv
items = inv.get("items", [])
serial_items = [i for i in items if i.get("tipo_gestione") == "a_seriale"]
wallbox = [i for i in serial_items if "wallbox" in (i.get("category","") or "").lower() or "wallbox" in (i.get("name","") or "").lower()]
chosen = wallbox[0] if wallbox else (serial_items[0] if serial_items else None)
assert chosen, "No a_seriale product found"
page_id = chosen["id"]
name = chosen["name"]
unit = chosen.get("unit") or "pz"
categoria = chosen.get("category")
print(f"Chosen product: name={name} page_id={page_id} unit={unit} categoria={categoria} tipo_gestione={chosen.get('tipo_gestione')}")

SN = os.environ.get("REUSE_SN") or f"F6E2ETEST_{int(time.time())}"
# Wait between Notion writes to avoid minute-level created_time collisions
STEP_WAIT = int(os.environ.get("STEP_WAIT", "65"))
print(f"Generated SN: {SN}")
results["sn"] = SN
results["product"] = {"page_id": page_id, "name": name, "unit": unit, "categoria": categoria}

# Sanity: lookup should be not_found
r, lk = http("GET", f"/api/inventory/lookup?code={SN}")
p("SN pre-lookup", lk)
assert lk.get("status") == "not_found", f"SN unexpectedly exists: {lk}"

today = time.strftime("%Y-%m-%d")

def item_payload(qty=1, serials=None):
    return {
        "page_id": page_id,
        "name": name,
        "unit": unit,
        "categoria": categoria,
        "serialized": True,
        "quantity": qty,
        "serials": serials or [SN],
    }

# ---------- STEP 1: ARRIVO iniziale ----------
r, body = http("POST", "/api/arrivi/send", json={
    "operator": "F6 E2E Tester",
    "arrival_date": today,
    "fornitore": "F6 E2E Test",
    "items": [item_payload()],
})
p("STEP 1 - Arrivo iniziale", body)
results["steps"]["1_arrivo_iniziale"] = {"status": r.status_code, "body": body}
assert r.status_code == 200, f"STEP 1 FAILED: {body}"

time.sleep(STEP_WAIT)

# ---------- STEP 2: lookup -> in_warehouse ----------
r, lk = http("GET", f"/api/inventory/lookup?code={SN}")
p("STEP 2 - lookup post-arrivo", lk)
results["steps"]["2_lookup_post_arrivo"] = lk
assert lk.get("status") == "in_warehouse", f"STEP 2 FAILED: {lk}"
assert lk.get("matched_by") == "sn", f"STEP 2 matched_by wrong: {lk}"
assert (lk.get("item") or {}).get("tipo_gestione") == "a_seriale"

# ---------- STEP 3: PRIMA SPEDIZIONE ----------
r, body = http("POST", "/api/checklist/send", json={
    "operator": "F6 E2E Tester",
    "shipping_date": today,
    "structure": "F6 E2E CLIENTE 1",
    "taken_by": "F6 E2E Tester",
    "items": [item_payload()],
})
p("STEP 3 - Prima spedizione", body)
results["steps"]["3_prima_spedizione"] = {"status": r.status_code, "body": body}
assert r.status_code == 200, f"STEP 3 FAILED: {body}"

time.sleep(STEP_WAIT)

# ---------- STEP 4: lookup -> out ----------
r, lk = http("GET", f"/api/inventory/lookup?code={SN}")
p("STEP 4 - lookup post-spedizione", lk)
results["steps"]["4_lookup_post_spedizione"] = lk
assert lk.get("status") == "out", f"STEP 4 FAILED: {lk}"
assert lk.get("matched_by") == "sn"
shipped_to_1 = lk.get("shipped_to") or (lk.get("item") or {}).get("shipped_to")
print(f"shipped_to reported: {shipped_to_1}")

# ---------- STEP 5: RIENTRO ----------
r, body = http("POST", "/api/arrivi/send", json={
    "operator": "F6 E2E Tester",
    "arrival_date": today,
    "fornitore": "F6 E2E RIENTRO",
    "items": [item_payload()],
})
p("STEP 5 - Rientro", body)
results["steps"]["5_rientro"] = {"status": r.status_code, "body": body}
assert r.status_code == 200, f"STEP 5 FAILED (rientro dovrebbe essere consentito): {body}"

time.sleep(STEP_WAIT)

# ---------- STEP 6: lookup -> in_warehouse ----------
r, lk = http("GET", f"/api/inventory/lookup?code={SN}")
p("STEP 6 - lookup post-rientro", lk)
results["steps"]["6_lookup_post_rientro"] = lk
assert lk.get("status") == "in_warehouse", f"STEP 6 FAILED: {lk}"

# ---------- STEP 7: SECONDA SPEDIZIONE ----------
r, body = http("POST", "/api/checklist/send", json={
    "operator": "F6 E2E Tester",
    "shipping_date": today,
    "structure": "F6 E2E CLIENTE 2",
    "taken_by": "F6 E2E Tester",
    "items": [item_payload()],
})
p("STEP 7 - Seconda spedizione", body)
results["steps"]["7_seconda_spedizione"] = {"status": r.status_code, "body": body}
assert r.status_code == 200, f"STEP 7 FAILED: {body}"

time.sleep(STEP_WAIT)

# ---------- STEP 8: lookup -> out CLIENTE 2 ----------
r, lk = http("GET", f"/api/inventory/lookup?code={SN}")
p("STEP 8 - lookup finale", lk)
results["steps"]["8_lookup_finale"] = lk
assert lk.get("status") == "out", f"STEP 8 FAILED: {lk}"
shipped_to_2 = lk.get("shipped_to") or (lk.get("item") or {}).get("shipped_to")
print(f"final shipped_to: {shipped_to_2}")

# ---------- STEP 9: STORICO ----------
month = time.strftime("%Y-%m")
r, mv = http("GET", f"/api/movimenti?month={month}")
p("STEP 9 - movimenti (truncated)", {"count": mv.get("count"), "sample_keys": list((mv.get("items") or [{}])[0].keys()) if mv.get("items") else None})
occ = []
for row in mv.get("items", []):
    sc = row.get("serial_or_code") or row.get("serial") or ""
    if SN in str(sc):
        occ.append({"tipo": row.get("tipo") or row.get("type"), "data": row.get("data") or row.get("date"), "fornitore_o_cliente": row.get("fornitore") or row.get("cliente") or row.get("structure") or row.get("shipped_to")})
print(f"Occurrences of SN in movimenti: {len(occ)}")
for o in occ:
    print(" -", o)
results["steps"]["9_movimenti"] = {"total_month": mv.get("count"), "sn_occurrences": occ}
assert len(occ) >= 4, f"STEP 9 FAILED: expected >=4 rows, got {len(occ)}"

# ---------- STEP 10: TENTATIVO DUPLICATO ----------
# Now SN is out. Need to test duplicate arrival while in_warehouse.
# But state is 'out' currently. Do a 3rd rientro first to put it back, then duplicate.
r_extra, extra = http("POST", "/api/arrivi/send", json={
    "operator": "F6 E2E Tester",
    "arrival_date": today,
    "fornitore": "F6 E2E RIENTRO 2",
    "items": [item_payload()],
})
print(f"[helper rientro-2 status] {r_extra.status_code}")
results["steps"]["10a_helper_rientro2"] = {"status": r_extra.status_code, "body": extra}
assert r_extra.status_code == 200, f"helper rientro-2 failed: {extra}"

time.sleep(STEP_WAIT)
r, lk = http("GET", f"/api/inventory/lookup?code={SN}")
print(f"pre-duplicate state: {lk.get('status')}")
assert lk.get("status") == "in_warehouse"

r, body = http("POST", "/api/arrivi/send", json={
    "operator": "F6 E2E Tester",
    "arrival_date": today,
    "fornitore": "F6 E2E DUP",
    "items": [item_payload()],
})
p("STEP 10 - Tentativo arrivo duplicato (dovrebbe 409)", body)
results["steps"]["10_duplicato"] = {"status": r.status_code, "body": body}
assert r.status_code == 409, f"STEP 10 FAILED: expected 409, got {r.status_code}: {body}"
detail_str = json.dumps(body, ensure_ascii=False).lower()
assert "già presente in magazzino" in detail_str or "gia presente" in detail_str, f"STEP 10 detail mismatch: {body}"

print("\n\n============ ALL STEPS PASSED ============")
print(f"SN utilizzato: {SN}")
print("Righe create su Notion (da revisionare/eliminare manualmente):")
print("  - Consegne Wallbox/Entrate: 3 righe (Arrivo iniziale, Rientro, Rientro 2)")
print("  - Spedizioni/Uscite: 2 righe (CLIENTE 1, CLIENTE 2)")

with open("/app/test_reports/e2e_wallbox_result.json", "w") as f:
    json.dump(results, f, indent=2, default=str, ensure_ascii=False)
print("\nSaved: /app/test_reports/e2e_wallbox_result.json")
