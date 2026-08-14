# PRD — Magazzino Elios Tech

## Original Problem Statement
Applicazione web/mobile responsive per gestione magazzino, controllo checklist di spedizioni e (roadmap) arrivi. Notion è la **UNICA fonte di verità** per prodotti, giacenze e cronologia di seriali (Entrate + Uscite). L'app deve integrarsi in tempo reale con Notion, permettere scansione rapida QR/Barcode/seriali, generare e-mail automatiche via Emergent Resend, e supportare più operatori.

## Fasi concordate con l'utente
- **F0 — Fix + Rebrand** ✅ (14/02/2026)
- F1 — Navigazione (Dashboard/Inventario/Arrivi/Spedizioni/Movimenti/Anomalie/Admin) + cache in-memory + focus scanner persistente
- F2 — Schermata Arrivi (nuovo)
- F3 — Schermata Spedizioni (rework)
- F4 — Multi-utente + Anomalie + Movimenti
- F5 — Dashboard + Admin (gestione prodotti / tipo gestione)
- F6 — Test completo e regressioni

## Regole assolute (dall'utente)
1. **Notion = unica fonte di verità.** Nessun DB interno di prodotti/giacenze. Solo cache temporanea in memoria per velocità.
2. **NON aggiungere Barcode/QR/Seriali all'Inventario Notion.** L'Inventario gestisce solo stock/giacenza. I seriali vivono in Consegne/Entrate + Spedizioni/Uscite.
3. **Regola SN:** Un seriale è **disponibile** solo se `presente in Entrate` **AND** `assente in Uscite`.
4. **Nessun beep/suono/vibrazione** generato dall'app.
5. Fornitore/Mittente in Arrivi: **solo per l'email**, NON salvato su Notion.
6. Spedizioni: `Cliente` e `Da chi è stato preso` sono campi separati (F3).
7. Multi-utente: architettura pronta, verifica live su Notion prima di ogni conferma.

## Architettura
- **Backend**: FastAPI + Motor (Mongo) + httpx (Notion + Emergent Resend). Serializzazione strict via Pydantic.
- **Frontend**: React 19 + Shadcn UI + Sonner + html5-qrcode + @phosphor-icons/react.
- **Notion**: API v2025-09-03, endpoint `data_sources/*/query`.
- **DB Mongo**: `checklists` (storico spedizioni app), `settings.recipients` (email destinatari), `settings.serial_overrides` (override "serializzato" locale per page_id — temporaneo finché F5 non introduce `Tipo Gestione` su Notion).

## Env vars (backend/.env)
- Notion: `NOTION_TOKEN`, `NOTION_INVENTARIO_DS_ID`, `NOTION_TRACKER_DS_ID`, `NOTION_RECEIPTS_DS_ID`, `NOTION_VERSION`
- Email: `EMERGENT_EMAIL_KEY`, `EMAIL_FROM_NAME`, `CHECKLIST_RECIPIENTS`
- Admin: `ADMIN_PASSWORD`

## Property mapping Notion (attuale)
- **Inventario**: `Nome prodotto`/`Materiale`, `Codice prodotto`/`Codice`, `QTA in magazzino` (formula), `Unità`, `Categoria`, `Serializzato` (checkbox opzionale)
- **Inventory Tracker** (uscite): `SN`, `Quantità`, `Item in uscita` (relation), `Preso per`, `Data Uscita`
- **Inventory Receipts** (entrate): `Item`/`Aa item` (titolo, può contenere più SN separati da `,` `.` `;` spazi/newline), `Item in entrata`, `Data Consegna`/`Data`

## Changelog

### F0 — Fix + Rebrand (14/02/2026) ✅
**Rebrand**
- Titolo app: `Magazzino Elios Tech`
- Header pagina spedizione: "Spedizione" (kicker: "Magazzino Elios Tech")
- Root `GET /api/` ora restituisce `service: "Magazzino Elios Tech"`
- Email header, subject e footer aggiornati
- Admin: "Torna al magazzino" invece di "Torna alla checklist"

**Rimozione DDT (feature deprecata)**
- Rimosso input "Numero DDT" dalla schermata Spedizione
- Rimosso filtro DDT dal Pannello Admin
- Rimosso badge `DDT XXX` dallo storico
- Rimosso pulsante download PDF DDT
- Rimosso endpoint `GET /api/admin/history/{id}/pdf`
- Eliminato file `/app/backend/pdf_service.py`
- Rimosso campo `ddt_number` da modelli Pydantic (`ChecklistPayload`, `ChecklistRecord`)
- Rimosso parametro `ddt` da `GET /api/admin/history`
- `ChecklistPayload` ha `extra="ignore"` per compatibilità con vecchie chiamate residue

**BUG FIX critico — Validazione strict seriali su submit**
Prima: `POST /api/checklist/send` verificava solo se il SN fosse già in Uscite (Tracker). Un seriale mai entrato veniva accettato.
Ora la validazione allineata alla regola assoluta:
- (a) SN deve essere presente in **Consegne/Entrate** → altrimenti `SN non risulta presente in magazzino (mai entrato)`
- (b) SN NON deve essere presente in **Spedizioni/Uscite** → altrimenti `SN risulta già uscito`
- (c) SN NON deve essere duplicato nella spedizione corrente → altrimenti `SN inserito più volte`
Tutti i controlli sono LIVE su Notion al momento del submit (multi-utente safe).

**Pulizia**
- Rimosso `FilePdf` icon import, `downloadingId` state, `downloadPdf` func in AdminPage
- Rimosso trailing garbage in ChecklistPage.jsx (parse error fixato)
- Rows Notion Tracker create durante test (`ELIOSTEST_UNKNOWN_SN_9999999`, `CLI_TEST`, `TEST_CLIENTE_F0_*`) archiviate

**Test**
- 14/14 pytest passed
- Test aggiunti: `test_submit_rejects_unknown_serial`, `test_submit_rejects_duplicate_serial_in_same_shipment`, `test_admin_history_pdf_endpoint_removed`

## Prioritized Backlog (post F0)
- **F1 (Next)**: Nuova navigazione 7 sezioni; ScannerBar con focus persistente; precaricamento in-memory cache per SKU/Barcode/QR/SN → prodotto
- **F2**: Schermata ARRIVI. Campo Fornitore/Mittente (solo email, no Notion). Scrittura riga in Consegne/Entrate. Controllo duplicati SN. Email di arrivo (usa stessa lista destinatari).
- **F3**: Rework SPEDIZIONI. Scan sequenziale rapido. Popup quantità per prodotti a quantità. Campo "Da chi è stato preso" separato da "Cliente".
- **F4**: Multi-utente (login operatore, `Preso da` come property Notion). Anomalie (log locale MongoDB o Notion tbd). Movimenti (view aggregata Arrivi+Spedizioni).
- **F5**: Dashboard (KPI, sotto scorta, ultimi movimenti). Admin: modifica `Tipo Gestione` (A Quantità / A Seriale) — property Notion tbd dall'utente.
- **F6**: Test completo E2E + regressioni.

## Info in attesa dall'utente (per F1+)
- Proprietà Notion `Tipo Gestione` (nome esatto quando la creerà)
- Proprietà Notion `Fornitore` in Consegne/Entrate (o conferma che non serve)
- Proprietà Notion `Da chi è stato preso` in Spedizioni/Uscite (o conferma che va aggiunta con quel nome)
