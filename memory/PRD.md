# PRD — Magazzino Elios Tech

## Original Problem Statement
Applicazione web/mobile responsive per gestione magazzino, controllo checklist di spedizioni e arrivi. Notion è la **UNICA fonte di verità** per prodotti, giacenze e cronologia di seriali (Entrate + Uscite). L'app deve integrarsi in tempo reale con Notion, permettere scansione rapida QR/Barcode/seriali, generare e-mail automatiche via Emergent Resend, e supportare più operatori.

## Fasi concordate con l'utente
- **F0 — Fix + Rebrand** ✅ (14/02/2026)
- **F1 — Navigazione + Cache + Focus scanner** ✅ (14/02/2026)
- F2 — Schermata Arrivi (nuovo)
- F3 — Schermata Spedizioni (rework)
- F4 — Multi-utente + Anomalie + Movimenti
- F5 — Dashboard + Admin (gestione prodotti / tipo gestione)
- F6 — Test completo e regressioni

## Regole assolute (dall'utente)
1. **Notion = unica fonte di verità.** Nessun DB interno di prodotti/giacenze. Solo cache temporanea in memoria per velocità.
2. **NON aggiungere Barcode/QR/Seriali all'Inventario Notion.** L'Inventario gestisce solo stock/giacenza. I seriali vivono in Consegne/Entrate + Spedizioni/Uscite.
3. **Regola SN:** Un seriale è **disponibile** solo se `presente in Entrate` **AND** `assente in Uscite`.
4. **Nessun beep/suono/vibrazione** generato dall'app. Feedback solo visivo.
5. Fornitore/Mittente in Arrivi: **solo per l'email**, NON salvato su Notion.
6. Spedizioni: `Cliente` e `Da chi è stato preso` sono campi separati (F3).
7. Multi-utente: architettura pronta, verifica live su Notion prima di ogni conferma.

## Architettura
- **Backend**: FastAPI + Motor (Mongo) + httpx (Notion + Emergent Resend). Serializzazione strict via Pydantic.
- **Frontend**: React 19 + Shadcn UI + Sonner + html5-qrcode + @phosphor-icons/react. Routing SPA con `react-router-dom`. Cache condivisa via `InventoryContext`.
- **Notion**: API v2025-09-03, endpoint `data_sources/*/query`.
- **DB Mongo**: `checklists` (storico spedizioni app), `settings.recipients` (email destinatari), `settings.serial_overrides` (override "serializzato" locale per page_id — temporaneo finché F5).

## Struttura routing (F1)
- `/` (o `/dashboard`) → **DashboardPage** — big Arrivi/Spedizioni cards + KPI
- `/inventario` → **InventarioPage** — tabella searchable
- `/arrivi` → **ArriviPage** — placeholder F2
- `/spedizioni` → **ChecklistPage** — schermata spedizione ESISTENTE (immutata funzionalmente)
- `/movimenti` → **MovimentiPage** — placeholder F4
- `/anomalie` → **AnomaliePage** — placeholder F4
- `/admin` → **AdminPage** — layout autonomo con propria auth

Le pagine 1-6 sono wrapped in `<AppLayout>` che fornisce topbar unificata (7 tab NavLink + button "Aggiorna Notion" + timestamp ultimo sync).

## Cache in-memory (F1)
### Frontend (`/app/frontend/src/lib/InventoryContext.jsx`)
- Provider al top-level condiviso tra tutte le pagine
- Fetch iniziale `GET /api/inventory` + auto-refresh ogni 10 min
- Indici O(1): `bySku` (Codice prodotto → item), `byId` (page_id → item)
- API pubbliche: `items`, `categories`, `loading`, `error`, `refreshedAt`, `refresh()`, `lookupLocalBySku(code)`, `getById(id)`
- `refresh()` è de-duplicato (concurrent callers ricevono la stessa promise in volo)

### Backend (`/app/backend/notion_service.py`)
- `list_inventory(force_refresh=False)` — TTL 60s in-memory
- `/api/inventory` chiama con `force_refresh=True` (pulsante Aggiorna = fresh)
- `/api/inventory/lookup` usa cache (scan rapido)
- `submit_checklist` chiama `get_item()` e `lookup_*` (non-cachati) → autoritativo LIVE

### Regola: la cache NON è mai fonte di verità
- Ogni scan ha una fase locale rapida (SKU match cached) + fase server (SN check Notion)
- Ogni conferma spedizione: re-read live di Inventario + Receipts + Tracker

## Scanner focus + input universale (F1)
`/app/frontend/src/components/ScannerBar.jsx`:
- Auto-focus su mount
- Auto-refocus dopo ogni scan (Enter → submit → clear buffer → refocus)
- Pulsante "focus" (crosshair) per re-centrare manualmente
- Supporta: pistola USB/Bluetooth/WiFi HID (tastiera + Enter), fotocamera (BarcodeScanner dialog), typing manuale
- Nessun beep/suono generato
- Feedback visivo: banner 🟢/🟠/🔴 sotto l'input

## Env vars (backend/.env)
- Notion: `NOTION_TOKEN`, `NOTION_INVENTARIO_DS_ID`, `NOTION_TRACKER_DS_ID`, `NOTION_RECEIPTS_DS_ID`, `NOTION_VERSION`
- Email: `EMERGENT_EMAIL_KEY`, `EMAIL_FROM_NAME`, `CHECKLIST_RECIPIENTS`
- Admin: `ADMIN_PASSWORD`

## Property mapping Notion (attuale)
- **Inventario**: `Nome prodotto`/`Materiale`, `Codice prodotto`/`Codice`, `QTA in magazzino` (formula), `Unità`, `Categoria`, `Serializzato` (checkbox opzionale)
- **Inventory Tracker** (uscite): `SN`, `Quantità`, `Item in uscita` (relation), `Preso per`, `Data Uscita`
- **Inventory Receipts** (entrate): `Item`/`Aa item` (titolo, può contenere più SN separati da `,` `.` `;` spazi/newline), `Item in entrata`, `Data Consegna`/`Data`

## Changelog

### F1 — Navigazione + Cache + Focus scanner (14/02/2026) ✅

**Struttura nuova**
- `AppLayout` con topbar sticky + 7-tab NavLink + Aggiorna + timestamp sync
- 4 pagine placeholder chiare (Dashboard, Inventario, Arrivi, Movimenti, Anomalie)
- Dashboard con big cards Arrivi (verde) + Spedizioni (blu) + 4 KPI (prodotti, pezzi, serializzati, esauriti)
- Inventario searchable per nome/codice/categoria, badge A Quantità / A Seriale

**Cache condivisa**
- `InventoryContext` Provider al top-level: un solo fetch condiviso tra tutte le pagine (prima ogni pagina aveva il proprio `useInventory()`)
- Indici in-memory: `bySku` per riconoscimento locale O(1) durante scan
- `lookupLocalBySku()` esportato: se scansiono un SKU cached NON serializzato → aggiunta INSTANT senza API call
- Backend TTL cache 60s su `list_inventory()` — solo endpoint di lookup lo usa; write path resta live
- `refresh()` de-duplicato

**File rimossi**
- `/app/frontend/src/lib/inventory.js` (sostituito da InventoryContext)
- `/app/frontend/src/lib/catalog.js` (obsoleto — referenziava `/api/catalog` inesistente)

**Spedizione (invariata funzionalmente)**
- ChecklistPage ora usa `useInventoryCtx` invece di `useInventory`
- Rimosso header interno (fornito da AppLayout)
- Aggiunta local SKU pre-check in `handleScannedCode` — scan barcode di prodotto A Quantità = zero API call
- Tutta la logica strict validation, campo Cliente/Destinazione, seriali S/N, invio email → immutata

### F0 — Fix + Rebrand (14/02/2026) ✅
[archivio precedente — vedi commit history]
- Rebrand "Magazzino Elios Tech" (header, email, service)
- Rimozione completa DDT (input, filtro, badge, PDF endpoint, pdf_service.py, campo `ddt_number`)
- BUG FIX strict validation seriali su `POST /api/checklist/send`: ora verifica Receipts (presente) + Tracker (assente) + no duplicati

## Prioritized Backlog (post F1)
- **F2 (Next)**: Schermata ARRIVI. Campo Fornitore/Mittente (solo email, no Notion). Scrittura riga in Consegne/Entrate. Controllo duplicati SN. Email di arrivo (usa stessa lista destinatari).
- **F3**: Rework SPEDIZIONI. Scan sequenziale rapido. Popup quantità per prodotti a quantità. Campo "Da chi è stato preso" separato da "Cliente".
- **F4**: Multi-utente (login operatore, `Preso da` come property Notion). Anomalie (log locale MongoDB o Notion tbd). Movimenti (view aggregata Arrivi+Spedizioni).
- **F5**: Dashboard (KPI, sotto scorta, ultimi movimenti). Admin: modifica `Tipo Gestione` (A Quantità / A Seriale) — property Notion tbd dall'utente.
- **F6**: Test completo E2E + regressioni.

## Info in attesa dall'utente (per F2+)
- Nome esatto proprietà Notion Consegne/Entrate: `Data`, `Quantità`, `Prodotto`, `Seriale` (per la scrittura F2)
- Property `Da chi è stato preso` in Spedizioni/Uscite (F3)
- Definizione multi-utente (F4)
- Property `Tipo Gestione` (F5) — o mantenere override MongoDB
