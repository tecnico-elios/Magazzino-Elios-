# PRD — Magazzino Elios Tech

## Fasi
- **F0/F1/F2/F3** ✅
- **F4 — Multi-utente semplice + Anomalie + Movimenti** ✅ (14/02/2026)
- **F5 — Dashboard KPI + Admin Gestione Prodotti (Tipo Gestione = Notion SSOT)** ✅ (14/02/2026)
- F6 — Test completo E2E (in attesa test reali con Wallbox)
- PWA — solo alla fine, dopo verifica gestionale completa

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
