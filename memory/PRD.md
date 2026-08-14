# PRD — Magazzino Elios Tech

## Fasi
- **F0/F1/F2/F3** ✅
- **F4 — Multi-utente + Anomalie + Movimenti** ✅
- **F5 — Dashboard KPI + Admin Gestione Prodotti (Tipo Gestione = Notion SSOT)** ✅
- **UI-op — Rimozione badge topbar + rename "Preso da" → "Operatore" in Spedizioni** ✅
- **Movimenti per mese — filtro server-side Notion + cache per-mese** ✅
- **F6 — Regressione finale (75 test verdi)** ✅
- **F6-feedback — Timer 3s auto-clear banner scanner** ✅ (14/02/2026)
- **F6-rientri — Logica ULTIMO MOVIMENTO per prodotti A Seriale** ✅ (14/02/2026)
- **F6-rientro-dialog — Conferma esplicita reintegro Wallbox già spedita** ✅ (14/02/2026)
- **F6-orario — Data/ora Europe/Rome nelle email + KPI "today" locale** ✅ (14/02/2026)
- **F6-quantita — Barcode ripetibile per A Quantità + Dropdown ricerca live** ✅ (14/02/2026)
- **F6-manual-search — Lookup SN debounced (400ms) in dropdown per inserimento tastiera** ✅ (14/02/2026)
- **F6-conferma-finale — Popup riepilogo prima di scrittura Notion+email in Arrivi e Spedizioni** ✅ (14/02/2026)
- PWA — solo alla fine, dopo verifica gestionale completa

## F6-rientri Changelog
**Regola dell'ultimo movimento (Notion SSOT)**:
- `notion_service.lookup_receipts_sn()` e `lookup_tracker_sn()` iterano TUTTE le pagine e ritornano il match più recente (per `date` + tiebreaker `created_time`)
- Nuovo helper `notion_service.latest_serial_status(sn)`: ritorna `{status: "unseen"|"in_warehouse"|"out", last, receipt, exit}` confrontando date-latest di Receipts vs Tracker
- `/api/inventory/lookup` ora ritorna `status` ∈ `ok` (SKU match) / `in_warehouse` / `out` / `not_found`

**Arrivi (submit_arrivo)**:
- unseen → OK (nuovo seriale)
- last = uscita → OK ("rientro valido")
- last = entrata → BLOCK 409 "già presente in magazzino"

**Spedizioni (submit_checklist)**:
- unseen → BLOCK 409 "non risulta mai entrato in magazzino"
- last = uscita → BLOCK 409 "non disponibile in magazzino (uscito il ... — cliente ...)"
- last = entrata → OK

**Storico preservato**: ogni rientro crea una NUOVA riga in Consegne/Entrate. Nessuna sovrascrittura di righe passate.

**Multi-operatore**: verifica LIVE via `latest_serial_status()` al submit — nessuna base cache per decisione finale.

## F6-feedback Changelog
**Timer 3s auto-clear** in `ScannerBar.jsx`: `useEffect` su `lastScan` avvia `setTimeout(onClearLastScan, 3000)` con cleanup automatico. Una nuova scansione cambia il riferimento di `lastScan` → l'effect si rigenera → il timer riparte da 3s. Vale per verde/giallo/rosso, qualsiasi prodotto (A Quantità, A Seriale, Wallbox, cavi, accessori).

## Test F6-rientri + feedback
- Backend pytest **80/80 verde**, 4 skipped by design (non riproducibili senza modificare Notion reale)
- Nuovi test in `test_f6_rientri.py`: unseen lookup, SKU regression, known-SN → in_warehouse|out, arrivo blocca in_warehouse SN, duplicati payload, spedizione blocca unseen SN, helper diretto
- E2E screenshot: banner appare, scompare dopo 3.4s, sostituito immediatamente da nuova scansione
- Verificato via curl: unseen → not_found, SKU CH02 → ok+sku, submit spedizione unseen SN → 409 "mai entrato", submit arrivo in_warehouse SN → 409 "già presente"

## Regole invariate
- Notion = Single Source of Truth (Inventario + Consegne + Spedizioni)
- MongoDB solo per: history, anomalies, settings
- Nessun beep, focus scanner persistente, no page-reload
- Nessuna scrittura reale di movimenti su Notion durante i test

## F5 Changelog
**Tipo Gestione = Single Source of Truth su Notion**
- Notion property: **"Tipo gestione"** (Select) — valori: `A Quantità` | `A Seriale`
- Backend legge la property e la espone come `tipo_gestione` ∈ `a_seriale` | `a_quantita` | `None` (non configurato)
- Rimossi: category-based fallback, MongoDB `serial_overrides` come fonte di verità (endpoint legacy mantenuto ma proxya direttamente a Notion)
- Endpoint `PUT /api/admin/inventory/tipo-gestione` → aggiorna Notion via PATCH page + invalida cache

**Dashboard KPI** — `GET /api/dashboard/kpi`
- Aggrega live da Notion (Inventario + Entrate + Uscite), cache TTL 60s
- Campi: `total_products`, `total_units`, `arrivi_today`, `spedizioni_today`, `sotto_scorta[]` (≤2), `esauriti[]`, `non_configurati[]`, `recent_movements[]` (top 10)
- Frontend: `DashboardPage.jsx` con 4 KPI cards, sezioni sotto-scorta/esauriti, alert non-configurati, timeline ultimi 10 movimenti. Auto-refresh silenzioso ogni 60s (non blocca scanner/arrivi/spedizioni)

**Admin › Gestione Prodotti**
- Rinominata la vecchia tab "Inventario Notion" → "Gestione Prodotti"
- UI: lista prodotti letti dinamicamente da Notion, ricerca live per nome/codice/categoria, filtri Tutti / A Seriale / A Quantità / Non configurati
- Toggle esplicito `A Quantità ↔ A Seriale` scrive direttamente su Notion. Al successo aggiorna lo state e mostra badge "NON CONFIGURATO" quando pertinente

**Blocco submit se `Tipo Gestione` non configurato**
- `submit_arrivo` e `submit_checklist` rileggono ogni item fresh da Notion; se `tipo_gestione` è `None` → 400 "TIPO DI GESTIONE NON CONFIGURATO su Notion per: <lista>" + log anomalia (kind: `tipo_gestione_missing`)
- Frontend scanner (Arrivi + Spedizioni): se `local.configured === false` → banner errore "🔴 TIPO GESTIONE NON CONFIGURATO"

**Nuovi prodotti**
- Zero hardcode: qualsiasi prodotto aggiunto direttamente su Notion appare in Inventario/Admin/Dashboard entro il TTL cache (60s server, 10 min client — bottone Aggiorna forza refresh immediato)

## F5 File modificati
- `backend/notion_service.py` — `parse_item()` legge `Tipo gestione` Select, nuovo `update_tipo_gestione()` (PATCH Notion + invalidate cache)
- `backend/server.py` — riscritto `resolve_serialized()` (Notion only, None = non configurato), `annotate_item()` helper, nuovo `PUT /admin/inventory/tipo-gestione`, `PUT /admin/inventory/serial` mantenuto come proxy verso Notion (backward compat), nuovo `GET /dashboard/kpi`, block-if-not-configured in `submit_arrivo` + `submit_checklist`
- `frontend/src/pages/DashboardPage.jsx` — riscritta con KPI cards live da `/api/dashboard/kpi`
- `frontend/src/pages/AdminPage.jsx` — `InventoryTab` diventa "Gestione Prodotti" con toggle Tipo Gestione (writes to Notion)
- `frontend/src/pages/InventarioPage.jsx` — usa `tipo_gestione` (non più `serialized`), mostra badge "NON CONFIGURATO"
- `frontend/src/pages/ArriviPage.jsx` + `ChecklistPage.jsx` — scanner blocca prodotti con `configured=false`
- `backend/tests/test_f5_tipo_gestione.py` — 9 nuovi test (schema, roundtrip Notion, KPI, block not-configured)

## F5 Test
- Backend pytest **53/53 verde** (44 pre-esistenti + 9 nuovi F5)
- Verificato via curl: `/api/dashboard/kpi` → 196 pz totali, 10 sotto scorta, 12 esauriti, 0 non configurati (utente ha configurato tutti i 42 prodotti)
- Verificato su UI: Dashboard mostra dati live corretti
- Roundtrip Notion via API: PUT tipo-gestione → re-read via /api/inventory ritorna il nuovo valore + cache invalidata correttamente

## Regole invariate
- Notion = Single Source of Truth (anche per Tipo Gestione da F5)
- Cache Mongo/frontend solo per velocità, mai fonte di verità
- Nessun beep, focus scanner persistente, no page-reload
- Nessuna scrittura reale di movimenti su Notion durante i test (arrivi/spedizioni Wallbox reali saranno testate solo su approvazione utente)
- NO PWA fino a completa verifica del gestionale

## Backlog
- F6 — regressione E2E finale + verifica con Wallbox reale (su approvazione utente)
- Refactoring server.py/notion_service.py (>1000 righe) → `routes/` folder dopo F6
- PWA (manifest + service worker) — ultima fase
