# PRD — Magazzino Elios Tech

## Fasi
- **F0 — Fix + Rebrand** ✅
- **F1 — Navigazione + Cache + Focus scanner** ✅
- **F2 — Arrivi** ✅
- **F3 — Spedizioni rework** ✅ (14/02/2026)
- F4 — Multi-utente + Anomalie + Movimenti
- F5 — Dashboard KPI + Admin gestione prodotti
- F6 — Test completo E2E

## Regole invariate
1. Notion = single source of truth. Cache solo temporanea per velocità.
2. Inventario Notion ≠ archivio seriali. Seriali vivono in Consegne/Entrate + Spedizioni/Uscite.
3. Regola SN disponibile: `presente in Entrate` AND `assente in Uscite`.
4. Fornitore Arrivi: solo email, NON su Notion. Cliente + Preso da Spedizioni: entrambi testo libero su Notion.
5. Nessun beep. Feedback visivo.

## Property Notion reali (verificate)
- **Receipts** (Consegne/Entrate): `Item` (title), `Item in entrata` (relation), `Quantità` (number), `Data Consegna` (date)
- **Tracker** (Spedizioni/Uscite): `SN` (title), `Item in uscita` (relation), `Quantità` (number), `Preso per` (rich_text = Cliente), `Preso da` (**people** su schema attuale → F3 scrive come rich_text; se property è ancora people Notion restituisce 400), `Data Uscita` (date)
- **Inventario**: `Nome prodotto`, `Codice prodotto`, `QTA in magazzino` (formula), `Unità`, `Categoria`, `Serializzato` (checkbox opzionale)

⚠️ **Nota tecnica F3**: `Preso da` è di tipo `people` nello schema attuale ma l'utente vuole che sia scritto come testo libero. Il codice tenta la scrittura rich_text; **l'utente deve cambiare il tipo di `Preso da` da `people` a `rich_text` su Notion** perché la scrittura funzioni. Se il tipo non è stato cambiato, il submit reale ritornerà 502 con errore Notion. La logica di validazione strict lato backend è comunque OK e blocca prima della scrittura tutti i casi errati.

## Changelog

### F3 — Spedizioni rework (14/02/2026) ✅
**Componenti riutilizzabili estratti da ArriviPage**
- `frontend/src/components/QtyDialog.jsx` — popup quantità con supporto opzionale `maxAvailable` (Spedizioni), `label`, `variant` (arrivi=emerald / spedizioni=blue), Enter conferma, autofocus, banner `qty-over-max` quando qty>max
- `frontend/src/components/ProductPicker.jsx` — modal search dinamica su cache Inventory con filtro `serialized`/`quantity`/`all`

**ArriviPage refactor**
- Ora importa `QtyDialog` e `ProductPicker` dai componenti estratti — comportamento invariato

**ChecklistPage (Spedizioni) — riscrittura completa**
- Stesso pattern scanner-first di Arrivi
- 4 input top: Cliente, **Preso da** (nuovo, testo libero), Operatore, Data
- Scan flow:
  - SKU cached NON serializzato → apre `QtyDialog` con `maxAvailable = stock - riservato in lista`
  - SKU cached serializzato → set modello pending
  - SN → server lookup:
    - `already_shipped` → 🔴 SERIALE GIÀ SPEDITO
    - `sn_receipt` match → 🟢 aggiunto (SN valido: in Entrate, non in Uscite, non dup)
    - `not_found` → 🔴 SERIALE NON PRESENTE IN MAGAZZINO (blocca)
  - Duplicato in sessione → 🔴 SERIALE GIÀ INSERITO NELLA SPEDIZIONE
- QtyDialog blocca overflow: mostra "Max: N" e disabilita conferma se qty > stock
- Sticky footer blu con CONFERMA SPEDIZIONE
- Autofocus scanner-input dopo chiusura dialog/picker

**Backend**
- `notion_service.create_pick(item_page_id, sn_title, quantity, cliente, data_uscita, taken_by="")` — firma estesa. Scrive property `Preso da` come rich_text (solo se taken_by non vuoto)
- `ChecklistPayload` e `ChecklistRecord`: nuovo campo `taken_by: str = ""`
- `validate_checklist_basic` richiede `taken_by` non vuoto → 400 IT "Preso da obbligatorio"
- Email HTML aggiunge riga "Preso da"
- `submit_checklist` passa `taken_by=payload.taken_by` a `create_pick`

## Test coverage F3
- Backend pytest **43/43 verde** (5 nuovi test in `test_spedizioni_f3.py`):
  - taken_by mancante → 400
  - cliente mancante → 400
  - SN not in receipts → 409 "non risulta presente"
  - Duplicati intra-payload → 409
  - qty > stock → 409 "non disponibile"
- Test legacy aggiornati: `test_admin_features.py` + `test_navigation_f1.py` ora inviano `taken_by`
- Curl live confermato: 400/409 corretti prima di scrivere su Notion → **nessun rischio scrittura accidentale** grazie a validazione strict

## Prioritized Backlog (post F3)
- **F4 (Next)**: multi-utente (login operatori), Anomalie (log locale), Movimenti (view aggregata Entrate+Uscite)
- **F5**: Dashboard KPI + Admin gestione prodotti (Tipo Gestione)
- **F6**: test E2E completo

## Info necessarie prima di test reale su Notion
- **BLOCCO tecnico F3**: la property `Preso da` su Notion Tracker è di tipo `people`. Prima del primo test reale l'utente deve:
  - a) cambiare tipo da `people` a `Text` (rich_text) → tutto funzionerà
  - b) oppure comunicarci di NON scrivere `Preso da` su Notion (solo nell'email)

## Env vars
- Notion: `NOTION_TOKEN`, `NOTION_INVENTARIO_DS_ID`, `NOTION_TRACKER_DS_ID`, `NOTION_RECEIPTS_DS_ID`, `NOTION_VERSION`
- Email: `EMERGENT_EMAIL_KEY`, `EMAIL_FROM_NAME`, `CHECKLIST_RECIPIENTS`
- Admin: `ADMIN_PASSWORD` = `admin123`
