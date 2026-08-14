# PRD — Magazzino Elios Tech

## Fasi
- **F0 — Fix + Rebrand** ✅ (14/02/2026)
- **F1 — Navigazione + Cache + Focus scanner** ✅ (14/02/2026)
- **F2 — Arrivi** ✅ (14/02/2026)
- F3 — Rework Spedizioni (scan sequenziale + popup qty + "Da chi è stato preso")
- F4 — Multi-utente + Anomalie + Movimenti
- F5 — Dashboard KPI + Admin gestione prodotti
- F6 — Test completo E2E

## Regole invariate
1. Notion = single source of truth. Cache solo temporanea per velocità.
2. Inventario Notion ≠ archivio seriali. Seriali vivono in Consegne/Entrate + Spedizioni/Uscite.
3. Regola SN disponibile: `presente in Entrate` AND `assente in Uscite`.
4. Fornitore Arrivi: solo email, NON su Notion.
5. Nessun beep. Feedback visivo.

## Property Notion reali (verificate via API schema)
- **Receipts** (Consegne/Entrate): `Item` (title), `Item in entrata` (relation), `Quantità` (number), `Data Consegna` (date)
- **Tracker** (Spedizioni/Uscite): `SN` (title), `Item in uscita` (relation), `Quantità` (number), `Preso per` (rich_text = cliente), `Preso da` (people = operatore), `Data Uscita` (date)
- **Inventario**: `Nome prodotto`, `Codice prodotto`, `QTA in magazzino` (formula), `Unità`, `Categoria`, `Serializzato` (checkbox opzionale)

`Preso da` (people) è già presente su Notion → utile per F3/F4 multi-utente.

## Changelog

### F2 — Arrivi (14/02/2026) ✅
**Backend**
- `notion_service.create_receipt(item_page_id, sn_title, quantity, data_consegna)` — scrive riga in Receipts usando i nomi tecnici Notion (`Item`, `Quantità`, `Item in entrata`, `Data Consegna`). Il rollup su Inventario aggiorna QTA automaticamente.
- `POST /api/arrivi/send` — endpoint completo:
  - Validazione: operatore, fornitore, data, almeno 1 item, count seriali coerente
  - STRICT SN validation LIVE: (a) NON già in Receipts, (b) NON già in Tracker, (c) NON duplicato nel payload
  - Rollback: archivia le rows create se fallisce il processo
  - Cache invalidation dopo scrittura
  - Email HTML dedicata "Arrivo registrato" con Fornitore (verde emerald)
  - Persistenza in Mongo `arrivi` collection
- Modelli Pydantic: `ArrivoItem`, `ArrivoPayload`, `ArrivoRecord`

**Frontend — ArriviPage completa**
- Fornitore/Mittente (etichetta "Solo per l'email — non salvato su Notion")
- Operatore, Data (oggi di default)
- ScannerBar riusata (autofocus + refocus dopo azione)
- Flow scan intelligente:
  - SKU cached NON serializzato → apre `QtyDialog` immediatamente
  - SKU cached serializzato → set "modello pending" per prossimi SN
  - Codice non SKU → server lookup:
    - `already_shipped` → 🔴 già spedito, blocca
    - `sn_receipt` match → 🔴 già in Entrate, blocca
    - `not_found` → SN nuovo → se pending modello, aggiungi; altrimenti apri `ProductPicker`
- Manual selection: bottoni "Prodotto a Seriale" e "Prodotto a Quantità" aprono `ProductPicker` filtrato
- QtyDialog: input numerico centrato, Enter conferma, autofocus
- ProductPicker: search dinamica su nome/codice/categoria da cache InventoryContext
- Lista temporanea con +/- (solo per A Quantità), rimozione riga, rimozione singolo SN
- Sticky footer con totale + Conferma Arrivo verde
- Auto-refocus scanner-input dopo chiusura dialog/picker

**Dashboard**
- Card ARRIVI: badge cambiato da "F2 →" a "Attivo →"

## Test coverage F2
- Backend pytest 38/38 verde (`test_arrivi.py` — 6 nuovi test + 32 esistenti):
  - Validazione operator/fornitore/items vuoti
  - Reject SN già registrato (in Entrate o Uscite)
  - Reject duplicati intra-payload
  - Reject serials count != quantity
- Verifica manuale curl: tutti i casi 400/409 ritornano detail Italian corretto

## API Notion — verifiche schema
Verificato via `GET /data_sources/{id}`: le property REALI di Receipts sono `Item` (title), `Item in entrata` (relation), `Quantità` (number), `Data Consegna` (date). L'utente ha comunicato nomi semplificati `Data/Quantità/Prodotto/Seriale` ma il DB reale usa i nomi tecnici sopra — il codice usa i nomi reali per non rompere.

## Prioritized Backlog (post F2)
- **F3 (Next)**: rework Spedizioni. Scan sequenziale come Arrivi, popup qty per A Quantità, campo "Da chi è stato preso" separato da "Cliente" → mappa a `Preso da` (people) o mantieni `Preso per`.
- **F4**: multi-utente + Anomalie + Movimenti
- **F5**: Dashboard KPI + Admin gestione tipo gestione
- **F6**: test E2E completo

## Env vars
- Notion: `NOTION_TOKEN`, `NOTION_INVENTARIO_DS_ID`, `NOTION_TRACKER_DS_ID`, `NOTION_RECEIPTS_DS_ID`, `NOTION_VERSION`
- Email: `EMERGENT_EMAIL_KEY`, `EMAIL_FROM_NAME`, `CHECKLIST_RECIPIENTS`
- Admin: `ADMIN_PASSWORD` = `admin123`

## Struttura routing (post F2)
- `/` → Dashboard (Arrivi + Spedizioni cards + 4 KPI)
- `/inventario` → tabella searchable, badge A Quantità / A Seriale
- `/arrivi` → **ATTIVO** — schermata completa Arrivi
- `/spedizioni` → esistente ChecklistPage (immutata funzionalmente da F1)
- `/movimenti` → placeholder F4
- `/anomalie` → placeholder F4
- `/admin` → login + Admin panel esistente
