# PRD — Magazzino Elios Tech

## Fasi
- **F0/F1/F2/F3** ✅
- **F4 — Multi-utente semplice + Anomalie + Movimenti** ✅ (14/02/2026)
- F5 — Dashboard KPI + Admin gestione prodotti
- F6 — Test completo E2E

## F4 Changelog
**Multi-utente semplice** — `useOperator` hook con persistenza localStorage. Nessun login server. Badge `👤 Operatore: [nome]` in topbar AppLayout con edit inline. Arrivi + Spedizioni auto-fill dall'operatore corrente e lo persistono dopo il primo submit.

**Anomalie**
- Backend: `log_anomaly()` helper + collection Mongo `anomalies`. Auto-log in `submit_checklist` (serial errors + shortage) e `submit_arrivo` (serial errors) prima del raise 4xx/5xx.
- Endpoint `GET /api/anomalie?limit=N` — restituisce log ordinato desc
- Frontend: `AnomaliePage` con tabella (Data/Ora, Tipo, Operatore, Prodotto+Seriale, Descrizione) + ricerca

**Movimenti**
- Backend: `notion_service.list_receipts_all()` — legge tutte le rows di Consegne/Entrate con Item name risolto da relation. Endpoint `GET /api/movimenti?limit=200` — unifica live Entrate + Uscite da Notion, sort by date desc. **Mongo NON è la fonte**.
- Frontend: `MovimentiPage` con tabella (Data, Tipo, Prodotto, Q.tà, Seriale/Codice, Cliente, Preso da) + filtri Tutti/📥/📤 + search

**Notion property `Preso da`** ora rich_text (verificato via API schema): il write funziona.

## File F4
- Nuovi: `frontend/src/lib/useOperator.js`, `backend/tests/test_spedizioni_f3.py`
- Riscritti: `frontend/src/pages/MovimentiPage.jsx`, `frontend/src/pages/AnomaliePage.jsx`, `frontend/src/components/AppLayout.jsx`
- Modificati: `backend/notion_service.py` (+`list_receipts_all()`), `backend/server.py` (+`log_anomaly` helper, +`GET /movimenti`, +`GET /anomalie`, +auto-log in submit_checklist/submit_arrivo), `frontend/src/pages/ArriviPage.jsx` + `ChecklistPage.jsx` (useOperator integration)

## Test F4
- Backend pytest **43/43 verde**
- Curl live: `/api/movimenti` restituisce 2 spedizioni Notion (Cavo Molex, Daze duo); `/api/anomalie` logga automaticamente ogni submit bloccato (verificato con SN falso "FAKE_F4_ANOM")
- Frontend: MovimentiPage carica rows live, AnomaliePage mostra il log recente, operator badge editabile in topbar

## Regole invariate
- Notion = Single Source of Truth
- Cache Mongo/frontend solo per velocità, mai fonte di verità
- Nessun beep, focus scanner persistente
- Nessuna scrittura reale su Notion durante i test (tutti gli errori 400/409 bloccano prima)
