# PRD — Magazzino Elios Tech

## Fasi
- **F0-F6** ✅ (scanner, cache O(1), Notion SSOT, conferma finale, mapping strict)
- **Phase-2 Auth & RBAC** ✅ (15/02/2026)
  - JWT + bcrypt + MongoDB (users, audit_logs)
  - Bootstrap sicuro primo admin → Admin reale: **Riccardo Biuso** (`riccardo`)
  - Ruoli operator|admin, session invalidation via `password_version`
- **Phase-3 P1 Admin Extra** ✅ (15/02/2026)
  - Audit Log, Anomalie delete, Storico Seriali, Ricerca globale, Cleanup TEST_
- **Design System Unification (Ibrido premium)** ✅ (15/02/2026)
  - Design tokens navy/amber + IBM Plex/Manrope in `index.css` (utility `.et-*`)
  - Header dark navy + nav accent amber su tutte le pagine
- **F7 — Ottimizzazione + Impostazioni Admin estese** ✅ (15/02/2026)
  - **Sessioni attive** in MongoDB `active_sessions` (sid nel JWT, `last_activity` tracciato ad ogni chiamata, NO device info)
  - `GET/DELETE /api/admin/sessions` → tab Admin → Sessioni con Online/Offline (soglia 2 min) e "Disconnetti"
  - Auto-logout idle configurabile lato client (`sicurezza.idle_logout_minutes`) — listener mouse/keyboard/touch/scroll
  - Auto-expiry sessioni server-side quando `last_activity > idle_logout_minutes`
  - **must_change_password** flag: creazione nuovo utente & reset admin lo impostano a `true`; `require_password_current` dep blocca ogni rotta tranne `change-my-password`; redirect frontend a `/force-change-password` via evento globale
  - **Login attempts + lockout**: `login_attempts` collection, `max_login_attempts` e `lockout_minutes` da settings, ritorna 429 quando bloccato
  - **Impostazioni estese** (nested nel settings store esistente): scanner (autofocus, feedback ms verde/rosso, autoselect, suono), dashboard (auto-refresh, recent limit), magazzino (soglia, warn low/oos), ricerca (live, max, partial), movimenti (max, current-month), sicurezza (session TTL, idle, max attempts, lockout)
  - **Responsive CSS**: media queries `(hover:none) and (pointer:coarse)` → min-h 44px + font-size 16px (no zoom iOS) su input/button; smartphone verticale → tabs scroll orizzontale, dialog full-width, KPI grid 2 col; palmare industriale → text compatti; prefers-reduced-motion; anti scroll-orizzontale globale
- PWA — solo alla fine

## F8 — Fuso orario configurabile + barra ricerca semplificata ✅ (16/02/2026)
- **Fuso orario Admin**: nuova sezione `general.timezone` nel settings store esistente (default `Europe/Rome`), UI select in Admin → Impostazioni con 14 fusi IANA (Europe/Rome, London, Paris, Berlin, Madrid, Lisbon; America/New_York, Chicago, Denver, Los_Angeles; Asia/Dubai, Tokyo; Australia/Sydney; UTC). Ora legale/solare gestita automaticamente da ZoneInfo.
- Nuovo endpoint pubblico autenticato `GET /api/time` → `{tz, utc_iso, local_iso, local_date, local_datetime}`: ora generata dal server, indipendente dall'orologio del dispositivo.
- Nuovo helper centrale `frontend/src/lib/tz.js` (`getConfiguredTz`, `fetchServerToday`, `fmtDateTime`, `fmtTime`, `useTz`) con cache + invalidazione su `elios:settings-changed`.
- 6 punti di visualizzazione data/ora convertiti al tz dinamico: `AppLayout` (Ultimo sync), `DashboardPage`, `AnomaliePage`, `AdminPage.HistoryTab`, `AdminUsersPage`, `AdminExtraTabs` (Audit).
- 3 default form data aggiornati a server-time: `ArriviPage.arrivalDate`, `ChecklistPage.shippingDate`, `MovimentiPage.monthKey`.
- Dati storici già salvati NON toccati — solo la formattazione lato client cambia.

## F8 — Barra di ricerca semplificata (Arrivi/Spedizioni) ✅ (16/02/2026)
- Layout `[input] [🔎 CERCA] [📷] [🎯]` responsive con `flex-wrap`
- Pulsante CERCA = stessa pipeline dell'ENTER (ricerca locale + lookup esistente, nessuna nuova chiamata Notion)
- Fotocamera ridotta a icon-only, focus mantenuto
- Evento globale `elios:refocus-scanner` emesso da QtyDialog (close/confirm) e SerialCollector (cancel/commit) → ScannerBar riporta il focus alla barra SOLO se nessun altro INPUT/TEXTAREA/SELECT/contentEditable è attivo (no focus-stealing)

## File architettura
- Backend: `server.py` (F1-F6 preservato) + `routes/{auth,admin_users,admin_extra}_routes.py`, `auth.py` con session helpers
- Frontend: `AuthContext` con idle timer + must_change_password event, `ProtectedRoute`, `LoginPage`, `ForceChangePasswordPage` (F7), `AdminPage` (tab Sessioni), `AdminExtraTabs` (SettingsTab riorganizzata + SessionsTab)

## Regole invariate
- Notion = SSOT (inventario, seriali, movimenti, arrivi, uscite) — mai toccata dalle nuove feature F7
- MongoDB solo per: users, audit_logs, anomalies, active_sessions, login_attempts, history locale, settings
- Password mai in chiaro (bcrypt), mai su Notion, mai nei log/audit
- Mapping strict §11 invariato: `SN`/`Item`=solo seriale, `Preso per`=solo cliente, `Preso da`=solo operatore
- Nessuna scrittura reale di movimenti Wallbox durante i test
- JWT solo via Bearer header (mai cookie) — per-device via localStorage/sessionStorage

## Backlog
- Export CSV/Excel storico Spedizioni/Arrivi (P1)
- PWA installabilità (P2)
- Stats operatore giornaliere/settimanali (idea)

## F9 — Admin restructure completo (12 tab per area) ✅ (16/02/2026)
- Admin ora mostra tab separati per ogni area richiesta: Generali · Magazzino · Scanner · Arrivi · Spedizioni · Notifiche · Notion · Fonte Inventario · Registro Attività · Manutenzione · Gestione Prodotti (predisposizione) — più tab avanzati esistenti (Inventario, Storico, Ricerca, Storico SN, Sessioni, Cleanup TEST).
- Split `SettingsTab` via prop `filter` (senza duplicare load/save logic): wrapper `SettingsGeneralTab` / `SettingsMagazzinoTab` / `SettingsScannerTab` mostrano solo le loro sezioni.
- Nuove tab info-only per area operativa: `SettingsArriviTab`, `SettingsSpedizioniTab`, `ProductsAdminTab` (documentano regole cablate).
- Landing su "Impostazioni Generali" (default).

## F9 — Permessi configurabili RESPONSABILE ✅ (16/02/2026)
- Backend `auth.PERMISSION_MODULES` (12 moduli) + `has_permission(user, module)` + salvataggio `permissions` in user doc via `PATCH /admin/users/{id}`.
- Frontend `PermissionsDialog` con checkbox per moduli extra (Gestione Prodotti/Utenti, Impostazioni, Notifiche, Registro, Manutenzione). Base operativa (Dashboard/Arrivi/Spedizioni/Inventario/Movimenti/Anomalie) sempre attiva.

## F9 — Notifiche tipizzate + Admin restructure light + Impostazioni Notion ✅ (16/02/2026)
- **Notifiche tipizzate (§28)**: ogni destinatario ha ora 6 flag evento (`arrivi`, `spedizioni`, `sotto_scorta`, `esauriti`, `anomalie`, `errori_notion`). Backend: `NotificationEvents` pydantic model, `get_recipients_for_event(event)` helper, `submit_arrivo` e `submit_shipment` filtrano rispettivamente per `arrivi` e `spedizioni`. Migrazione automatica retro-compat: destinatari esistenti hanno tutti gli eventi ON.
- **UI RecipientsTab**: chip cliccabili sotto ogni email (Arrivi/Spedizioni/Sotto scorta/Esauriti/Anomalie/Errori Notion). Toggle ON/OFF colorato emerald/slate. Automaticamente disabilitati se il destinatario è disattivato.
- **Admin restructure light (§21-27)**: rinominata tab "Destinatari" → **"Notifiche"**. Aggiunta nuova tab **"Notion"** dedicata (diagnostica read-only) separata da "Manutenzione". Nessun refactor invasivo — le tabs esistenti sono mantenute e riorganizzate.
- **Impostazioni Notion (§27)**: nuova `NotionSettingsTab` con stato connessione, database mappati (Inventario/Entrate/Uscite), documentazione colonne 13 e 16 (già esistenti su Notion — non modificate dal gestionale), note sicurezza struttura.

## F9 — Sistema/Manutenzione (Notion status + Sincronizza/Svuota cache) ✅ (16/02/2026)
- Backend: `POST /api/admin/maintenance/refresh-cache` (invalida + ricarica inventario da Notion) e `GET /api/admin/maintenance/status` (stato Notion + count items). Nessuna scrittura su Notion.
- Frontend: nuova tab Admin `ManutenzioneTab` con stato Notion (pallino verde/rosso), count prodotti in cache, timestamp ultimo check, bottoni "Sincronizza ora" / "Svuota cache" / "Verifica stato".
- Nota: gli altri punti F9 (Admin restructure per area, tipizzazione notifiche per evento) sono già stati esplicitamente rifiutati (P2) o richiedono scelta operativa dell'utente — non toccati per evitare regressioni.

## F14 — Ricerca Retroattività: label + colonna + campo dinamici per tipo ✅ (19/02/2026)

- **Backend `routes/retro_routes.py`**: aggiunto campo `fornitore` a `RetroFindBody`. Quando `tipo=arrivo`, i receipts Notion vengono arricchiti con il campo `fornitore` (best-effort) tramite match su `db.arrivi` Mongo per `(arrival_date, serial)` o `(arrival_date, item_name)`. Il filtro server-side usa `structure` se tipo=spedizione, `fornitore` se tipo=arrivo.
- **Frontend `RetroattivitaPage.jsx`**:
  * Label filtro dinamica: `Struttura / Cliente (opz)` per Spedizioni · `Fornitore (opz)` per Arrivi (placeholder e data-testid coerenti).
  * Body della `POST /retro/find` invia il campo corretto in base al tipo (`structure` o `fornitore`).
  * Colonna risultati dinamica: `Struttura / Cliente` per Spedizioni · `Fornitore` per Arrivi. Cella mostra `r.cliente` o `r.fornitore`.
- **Non toccati**: `EditDialog`, salvataggio, audit, motivazione, gestione QR (manuale + scan), permessi retroattività, mapping Notion.

## F14 — CORREZIONI POST-IMPLEMENTAZIONE ✅ (19/02/2026)

### Correzione 1 — Match struttura su "Modulo Ordine/Struttura" (non più "Ragione sociale")
- **Diagnostica reale su Notion** (script Python su 721 ordini + 15 strutture Uscite): il campo che contiene i nomi struttura come inseriti dagli operatori è il **TITLE `Modulo Ordine/Struttura`** (4/5 match diretti su strutture reali come "Dalla Nonna Trattoria Bar", "Ristorante Il Cenacolo", "Paradise Village", "Award Vigilanza"). "Ragione sociale" conteneva invece nomi di persone (es. "Alessandra Cannazza") → non era il criterio corretto.
- **Fix**: `NOTION_ORDINE_STRUCTURE_FIELD=Modulo Ordine/Struttura` in `/app/backend/.env`. Nessuna modifica a codice o struttura Notion.
- **Verifica finale**: "Dalla Nonna Trattoria Bar" → `found` ✅, "Casa Vacanze Palmer Palace" → `found` ✅, "Alessandra Cannazza" → correttamente `not_found` (non più matchato) ✅, "STRUTTURA_XYZ" → `not_found` ✅.

### Correzione 2 — QR Retroattività: manuale + scansione fotocamera
- **`RetroattivitaPage.jsx`**: sostituito il singolo input QR con la scelta a 2 bottoni:
  * `[INSERISCI MANUALMENTE]` — input testuale con verifica live via `GET /api/qr/check` on blur/Enter.
  * `[📷 SCANSIONA QR]` — apre il componente `BarcodeScanner` esistente (html5-qrcode, riuso 100% del componente già usato in Arrivi/Spedizioni). Il valore letto popola automaticamente il campo `newQr` e applica la stessa verifica di univocità.
- **Regola univocità**: unica verifica sul QR = "già utilizzato per altro SN?" → 409/blocco. Nessuna altra validazione aggiuntiva.
- **Modifica QR esistente** (§3): il flusso già supportato dal backend `PATCH /api/retro/shipment/{id}` (campo `new_qr_code`) — aggiorna il record esistente, upsert `qr_associations`, append al nuovo ordine, rimozione dal vecchio se cambia struttura. Nessuna nuova riga.
- **Riuso `BarcodeScanner`**: nessun secondo sistema di scansione creato — importato direttamente da `../components/BarcodeScanner`.

### Invariato
- QR opzionale nelle Spedizioni + SALTA/ASSOCIA · controllo "QR già utilizzato" · QTY WB invariato · SN WB/CODICI QR update · matching ordine · blocco 0/multi · permesso `modifica_retroattiva` · audit before/after · nessuna modifica struttura Notion.

## F14 — QR opzionale Spedizioni + Sync "Eliostech Ordini" + Operazione Retroattiva ✅ (19/02/2026)

### Blocco A — QR Code opzionale Spedizioni (§1-7)
- **Frontend `ChecklistPage.jsx`**: nuovo dialog `qr-prompt-dialog` che compare DOPO ogni seriale aggiunto (sia da scan singolo che da `SerialCollector` batch). Coda `qrQueue` processa un seriale per volta con 2 azioni: `SALTA` / `ASSOCIA QR`. In modalità ASSOCIA: input testuale (supporta scanner hardware + digitazione manuale) con verifica live via `GET /api/qr/check`.
- **Backend `routes/qr_routes.py`** (nuovo file): `GET /api/qr/check`, `GET /api/qr/associations`, `POST /api/qr/detach`. Univocità globale QR ↔ SN garantita da indice unico `qr_associations.qr_code_lower`.
- **Persistenza MongoDB**: nuova collection `qr_associations` con indici unique. Al submit spedizione, upsert automatico { qr_code, serial, product, structure, order_page_id, associated_at, associated_by }.
- **Controlli**: (a) QR già associato ad altro SN → 409; (b) duplicato QR nella stessa spedizione → 409; (c) lista qr_codes non allineata a serials → 400.

### Blocco B — Sync Notion "Eliostech Ordini" (§8-14)
- **Backend `notion_service.py`**:
  * Nuove costanti: `NOTION_ORDINI_DS_ID` (env), `NOTION_ORDINE_STRUCTURE_FIELD="Ragione sociale"` (default, seconda colonna configurabile via env), `NOTION_ORDINE_SN_PROP="SN WB"`, `NOTION_ORDINE_QR_PROP="CODICI QR"`.
  * `find_order_by_structure(structure)` → itera DS Ordini, match case-insensitive esatto su campo Ragione sociale. Returns `{status: found|not_found|multiple|not_configured}`.
  * `append_shipment_to_order(page_id, serials, qr_codes)` — merge idempotente su SN WB e CODICI QR. **QTY WB MAI toccato**.
  * `remove_shipment_from_order(...)` per retroattività.
- **`server.py` submit_checklist**: PRIMA di scrivere in Notion Tracker, cerca l'ordine dalla struttura; `not_found` → 409 "Ordine non trovato per la struttura selezionata"; `multiple` → 409 "Trovati N ordini". Solo se `found` procede.
- **Post-scrittura Tracker**: append_shipment_to_order su Notion Ordini con tutti i seriali + QR raccolti (best-effort, se fallisce logga anomalia ma non rollback).
- **Verifica reale su Notion**: DS `26ba9b09-6783-81ce-9e33-000b68307eaa` confermato attivo. Test parziale: match "Alessandra Cannazza" → `found`, match `STRUTTURA_XYZ` → `not_found` ✅.

### Blocco C — Operazione Retroattiva (§15-51)
- **Nuovo permesso** `modifica_retroattiva` in `auth.PERMISSION_MODULES` — assegnabile al RESPONSABILE dall'Admin via UI esistente `PermissionsDialog`.
- **Backend `routes/retro_routes.py`** (nuovo file):
  * `GET /api/retro/authorized` — usato dal frontend per decidere se mostrare la card Dashboard.
  * `POST /api/retro/find` — cerca operazioni esistenti (LIVE da Notion via `list_exits`/`list_receipts_all`) con filtri tipo/data/seriale/struttura.
  * `PATCH /api/retro/shipment/{tracker_page_id}` — modifica riga Uscite esistente. Cambi consentiti: seriale/quantità/struttura/data/preso da/QR. Aggiorna anche l'ordine collegato (rimozione da vecchio + append al nuovo) + colonna 16 Inventario. Motivazione + audit before/after obbligatori.
  * `PATCH /api/retro/arrivo/{receipt_page_id}` — modifica riga Entrate esistente (SN/qty/data).
  * `POST /api/retro/cancel/{tipo}/{page_id}` — archiviazione soft (Notion archive) + audit. Storico preservato.
- **Guardia `_require_retro(current)`**: Admin/Master sempre; Responsabile solo con `modifica_retroattiva`; Operator sempre 403 "Operazione retroattiva non autorizzata".
- **Nuova pagina `RetroattivitaPage.jsx`** su route `/retroattivita` — form ricerca + tabella risultati + `EditDialog` modale con campi editabili SOLO se compilati (§22 minimamente invasiva), motivazione obbligatoria, pulsante `Annulla operazione` separato.
- **Card Dashboard** "↩️ Operazione Retroattiva" — visibile SOLO se `/api/retro/authorized` ritorna `authorized: true`. Operator: card invisibile. Responsabile senza permesso: card invisibile.
- **Regola fondamentale §19 §20 §21**: le PATCH modificano il RECORD esistente (Notion `update_tracker_row`/`update_receipt_row` + `append/remove_shipment_from_order`), MAI creano nuove righe.
- **Audit obbligatorio**: ogni retro insert in `audit_logs` con action `retro.shipment.update|retro.arrivo.update|retro.cancel`, meta `{reason, before, after, date_registrazione}`.

### Struttura Notion invariata
- 0 modifiche a: database Inventario, Entrate, Uscite, Ordini, proprietà, tipi, mapping, viste, relazioni, formule.
- Il campo di match struttura è configurabile via env `NOTION_ORDINE_STRUCTURE_FIELD` (default `Ragione sociale`).

### Test superati
- Backend compila 5 file (server, notion_service, qr_routes, retro_routes, auth) ✅
- Frontend lint 0 errori su ChecklistPage/DashboardPage/RetroattivitaPage/App.js ✅
- Endpoint `/api/qr/check` e `/api/retro/authorized` protetti (401 senza JWT) ✅
- Match `find_order_by_structure` reale su Notion: 1 struttura esistente → `found`, 1 inesistente → `not_found` ✅
- 0 modifiche alla struttura Notion ✅

### File aggiunti/modificati
- Backend NEW: `routes/qr_routes.py`, `routes/retro_routes.py`
- Backend EDIT: `auth.py` (+1 permesso), `notion_service.py` (+5 funzioni Ordini/retroattività), `server.py` (payload qr_codes + sync ordini + include router + indexes), `.env` (+2 env vars)
- Frontend NEW: `pages/RetroattivitaPage.jsx`
- Frontend EDIT: `App.js` (route), `pages/DashboardPage.jsx` (card retro), `pages/ChecklistPage.jsx` (QR dialog + payload), `pages/AdminUsersPage.jsx` (+1 permesso UI)

## F13 — Disponibilità seriali: SOLO Inventario Notion colonna 16 ✅ (19/02/2026)
- **Regola nuova**: la disponibilità di un seriale è determinata ESCLUSIVAMENTE dalla presenza in colonna 16 "SN /codice" dell'Inventario Notion. Nessuna query a Entrate/Uscite/Consegne per la disponibilità.
- **Backend `notion_service.py`**:
  * `parse_item()` ora popola il campo `serials` leggendo la colonna 16 "SN /codice" per ogni item Inventario (cache O(1)).
  * Nuova funzione `find_serial_in_inventory(sn)` — cerca il SN nella lista in cache, ritorna item o `None`. Nessuna nuova chiamata HTTP nel caso comune (usa `list_inventory` con TTL cache).
- **Backend `inventory_local.py`**: aggiunta `find_serial_in_inventory(sn)` per parity — cerca in `product_serials` con `status='available'`. Contratto identico a `notion_service`.
- **Backend `server.py`** — 3 punti di verifica riscritti:
  1. `GET /api/inventory/lookup`: rimossa chiamata a `latest_serial_status`. Ora: dopo SKU-match cerca solo in colonna 16 → `in_warehouse` o `not_found`. Nessuna risposta "out" con `shipped_to/shipped_date/tracker_url`.
  2. `POST /api/checklist/send` (STRICT validation Spedizioni): sostituito `latest_serial_status` con `find_serial_in_inventory`. Messaggio errore ridotto a "SN X non disponibile in magazzino" — nessuna data/cliente uscita.
  3. `POST /api/arrivi/send` (STRICT validation Arrivi): sostituito `latest_serial_status` con `find_serial_in_inventory`. "Seriale nuovo" = non in colonna 16. Blocca se già presente.
- **Frontend `ChecklistPage.jsx`**: rimossa la stringa `SN X è stato spedito il DATA a CLIENTE`. Nuovo messaggio: `SERIALE NON DISPONIBILE IN MAGAZZINO — SN <code>`. Il branch `status === "out"` resta come no-op difensivo (backend non lo restituisce più).
- **Storico intatto**: `list_receipts_all`, `list_exits`, admin `/admin/serial-history`, `/admin/global-search` continuano a leggere Entrate/Uscite per tracciabilità — invariati.
- **Notion**: 0 modifiche a struttura/proprietà/mapping.
- **Test end-to-end reali** (backend live):
  * `GET /inventory/lookup?code=1364820` (SN reale in colonna 16) → `in_warehouse` con item correttamente identificato (Pulsar Pro 22kw 5M) ✅
  * `GET /inventory/lookup?code=SN1426770` (caso segnalato utente — era "spedito il 2026-08-18 a Casa vacanze Palmer") → ora `not_found` pulito ✅
  * `GET /inventory/lookup?code=FAKE_XXX` → `not_found` ✅
- **Funzioni che ancora usano `latest_serial_status`** (solo per storico/tracciabilità admin, NON per disponibilità): `admin_extra_routes.py:323` (Storico SN) e `:567` (Ricerca globale). Corrette by design — sono viste di history.

## F8 — Switch fonte inventario riservato al Master + fix import useAuth ✅ (18/02/2026)
- **Frontend `InventorySourceTab`**: switch Notion↔Gestionale ora visibile e operativo SOLO per l'account Master (`tecnico@eliostech.org`). Gli altri Admin vedono badge read-only "🔒 Solo Master" e bottone disabilitato.
- **Backend**: la guardia `POST /api/admin/inventory/source` era già in place (403 se non Master) — nessuna modifica.
- **Fix blocker lint**: aggiunto `import { useAuth } from "../lib/AuthContext";` in `AdminExtraTabs.jsx` (l'agente precedente l'aveva usato senza importarlo → oxlint fallito). Compilazione webpack ora 0 errori.

## F11 — Admin Impostazioni ristrutturato in Sidebar+Content ✅ (18/02/2026)
- **AdminPage.jsx** completamente ridisegnato: rimosso il TabsList orizzontale piatto ("lista di 16 tab" criticata dall'utente) → **layout Sidebar+Content professionale** con navigazione raggruppata per aree.
- **Struttura sidebar** (F11 §1) in 4 gruppi con etichette maiuscole:
  * (senza titolo) — Gestione Prodotti
  * **Impostazioni** — Generali, Magazzino, Scanner e Acquisizione, Arrivi, Spedizioni, Notifiche, Notion, Fonte Inventario
  * **Amministrazione** — Registro Attività, Sistema / Manutenzione
  * **Strumenti** — Storico, Ricerca globale, Storico SN, Sessioni, Cleanup TEST
- Bottone attivo: navy scuro + accent amber sull'icona. Sidebar sticky su desktop (`md:sticky md:top-24`).
- **Header pannello content**: eyebrow amber con nome gruppo + titolo sezione grande. Card white con border+shadow.
- **useState** invece di Radix Tabs → rendering condizionale del componente attivo. Nessun cambio ai componenti figli (tutti mantenuti).
- **Verificato**: frontend compila (0 errori runtime), login page 0 errori console, tutti i data-testid preservati (`sidebar-{key}` sui nuovi bottoni).
- **Nessun refactoring**: `AdminExtraTabs.jsx`, `AdminUsersPage.jsx`, pagine operative (Arrivi/Spedizioni/Inventario/Movimenti) e backend NON toccati.

## F10 — Impostazioni Arrivi/Spedizioni realmente configurabili ✅ (18/02/2026)
- **Backend**: nuove sezioni Pydantic `ArriviSettings` e `SpedizioniSettings` con validazione, aggiunte a `SettingsBody` + `DEFAULT_SETTINGS` + `get_app_settings` (merge automatico).
  * Arrivi: `allow_new_serials`, `continuous_scan`, `enter_equals_add`, `final_confirmation`, `require_code_for_qty`, `require_quantity`
  * Spedizioni: `continuous_scan`, `final_check`, `allow_partial_shipment`
- **Frontend**: `SettingsArriviTab` e `SettingsSpedizioniTab` trasformate da tab info-only a **veri form configurabili** con toggle checkbox, load da `GET /admin/settings`, save via `PUT /admin/settings`, evento `elios:settings-changed` per notificare altri componenti.
- **Protezioni LOCKED** (icona lucchetto ambra, "Sempre attivo"): prodotto obbligatorio per Ricevi Seriali, verifica Notion, popup Reintegra, verifica seriale in Inventario spedizioni, blocco duplicati, blocco seriale già spedito, verifica disponibilità, blocco quantità insufficiente. Non è possibile disattivarle da UI.
- **Verificato**: backend restart OK, `/api/time` 200, `python -m py_compile` OK sia server.py che admin_extra_routes.py, frontend compila (0 errori).

## F8 — Scrittura Seriali su Colonna 16 Inventario Notion + UI Switch disattivato ✅ (17/02/2026)
- **CORE F8 §3+§13**: dopo CONFERMA ARRIVO i seriali dei prodotti A Seriale vengono ora **scritti nella colonna `SN /codice` dell'Inventario Notion** (colonna 16, tipo rich_text). Prima erano registrati solo nella tabella Entrate/Consegne.
- Nuova funzione `notion_service.update_inventory_serials(page_id, serials)`:
  * GET pagina inventario → legge colonna esistente `SN /codice`
  * `_parse_serials` gestisce i separatori esistenti (virgola/newline/spazio)
  * Merge idempotente: seriali già presenti vengono ignorati (case-insensitive)
  * PATCH con newline come separatore, troncatura a 1990 char (limite Notion rich_text 2000)
  * Invalida cache automaticamente
- Nuova funzione `notion_service.remove_inventory_serials(page_id, serials)`:
  * Chiamata dopo CONFERMA SPEDIZIONE (§18) per riflettere che i seriali NON sono più in magazzino
  * Best-effort (se fallisce non blocca la spedizione)
- `server.py submit_arrivo`: dopo `invalidate_inventory_cache()` chiama `svc.update_inventory_serials(page_id, seriali)` per ogni prodotto A Seriale. Try/except → non blocca l'arrivo se il patch fallisce.
- `server.py submit_shipment`: dopo la creazione dei tracker uscita chiama `svc.remove_inventory_serials(page_id, seriali)`. Analogo pattern best-effort.
- `inventory_local` no-op: nel gestionale i seriali sono già in `product_serials`, la colonna 16 è specifica di Notion. Interfaccia uniforme mantenuta.
- **Frontend `InventorySourceTab` F8 §22-24**: switch fonte **disattivato per questa fase**. Notion sempre "Attivo", GESTIONALE marcato "Futuro" con bottone disabilitato. Backend resta predisposto ma UI non permette il cambio.
- **Verificato REALE con test end-to-end su Notion**: script che chiama update+remove su un prodotto reale, verifica presenza in colonna 16 → cleanup → confronta stato finale = originale. RESULT: ADD OK, REMOVE OK, back-to-original OK.
- Nessuna modifica a struttura Notion (0 nuove colonne/proprietà/tipi). Nessuna modifica a card, ScannerBar, ProductPicker, QtyDialog, SerialCollector.

## F8 — Inventario Gestionale ATTIVABILE (§14-20) ✅ (17/02/2026)
- **Backend nuovo servizio** `inventory_local.py` (400 righe) — MongoDB-backed che replica esattamente l'interfaccia pubblica di `notion_service`: `is_configured/invalidate_inventory_cache/list_inventory/get_item/update_tipo_gestione/latest_serial_status/create_receipt/create_pick/archive_page/list_receipts_all/list_exits`. Interfacce 100% allineate → nessuna condizione nel resto del codice.
- **Router selezione fonte** `inventory_router.py`: `get_svc(db)` restituisce il modulo attivo (`notion_service` | `inventory_local`) leggendo `settings.general.inventory_source` (default `"notion"`).
- **`server.py`**: sostituite tutte le chiamate `notion_service.X` → `svc.X` con `svc = await _get_inv_svc(db)` in `/inventory`, `/inventory/lookup`, `/checklist/send` (spedizioni), `/arrivi/send`, `/movimenti`, `/dashboard/kpi`, `/admin/inventory`, `/admin/inventory/tipo-gestione`, `/admin/inventory/serial`. Notion rimane invariato: se fonte=notion, nulla cambia.
- **Nuove Mongo collections**: `products`, `product_serials`, `local_receipts`, `local_picks` con indici unici su `code` e `(product_id, serial_lower)`.
- **CRUD Prodotti** (Admin JWT): `GET/POST/PATCH/DELETE /api/admin/products` + `GET/POST/DELETE /api/admin/products/{id}/serials/{serial}`. Audit log su create/update/delete.
- **Switch fonte** `POST /api/admin/inventory/source {source: 'notion'|'gestionale', confirm: true}` — richiede conferma esplicita, audit log.
- **Import da Notion** `POST /api/admin/inventory/import-from-notion` — copia Prodotti+Quantità da Notion → collezione locale (idempotente su codice, no duplicati). Notion NON modificato. Audit log.
- **Frontend `ProductsAdminTab`** — CRUD completo con form (nome/codice/categoria/gestione/quantità/unità/soglia/note/attivo), dialog seriali per prodotti A Seriale (aggiungi/rimuovi), pulsante "Importa da Notion" con conferma. Search inline. Badge disponibilità.
- **Frontend `InventorySourceTab`** — Card interattive con switch attivo (Notion ↔ Gestionale), dialog conferma modale con messaggio chiaro, bottone GESTIONALE disabilitato se 0 prodotti locali (obbliga import prima). `elios:settings-changed` dispatch per refresh cache.
- **Regole preservate**: Notion mai modificato dall'import né dalle scritture quando fonte=gestionale; le due fonti non sono mai attive contemporaneamente; una sola voce menu "Inventario" (la pagina cambia comportamento in base alla fonte).
- **Verificato**: `/api/inventory` 200, `/api/movimenti` 200, `/api/dashboard/kpi` 200, `/api/admin/products` 401 (auth), interfacce `notion_service`↔`inventory_local` allineate al 100% via reflection Python. Frontend compila (0 errori).

## F8 — Fix Admin Tab duplicati + rimozione "Inventario (avanzato)" ✅ (17/02/2026)
- Rimossi 3 tab DUPLICATI in AdminPage TabsList: `value="inventory"` (era listato 2 volte come "Prodotti" e come "Inventario avanzato"), `value="recipients"` (2×), `value="history"` (2×). React DOM warning risolto.
- Rimosso completamente il tab **"Inventario (avanzato)"** da Admin (vietato dall'utente: "non posso avere 2 voci inventario e inventario avanzato"). Voce unica ora è solo la pagina principale `/inventario` in AppLayout NAV.
- Riordino tab Admin secondo §2 del prompt F8: Gestione Prodotti → Generali → Magazzino → Scanner → Arrivi → Spedizioni → Notifiche → Notion → Fonte Inventario → Registro Attività → Sistema/Manutenzione → (avanzati: Storico, Ricerca, Storico SN, Sessioni, Cleanup TEST).
- Rimosso commento morto `_AuditLogTab_unused` (tab Audit ora è renderizzata come "Registro Attività").
- Nessuna modifica a Notion, flussi Arrivi/Spedizioni, card operative, ScannerBar, ProductPicker, QtyDialog, SerialCollector.

## F8 — P0+P1 Prompt Definitivo ✅ (16/02/2026)
- **Rinomina card operative**: Arrivi → "RICEVI SERIALI / RICEVI QUANTITÀ / REINTEGRA SERIALE"; Spedizioni → "SPEDISCI SERIALI / SPEDISCI QUANTITÀ" (nessun cambio dimensioni/stile).
- **Account master `tecnico@eliostech.org` protetto a livello backend**: `auth.is_master_user()` + guardie 403 in `PATCH /admin/users/{id}` (role/active), `POST /admin/users/{id}/reset-password`, `DELETE /admin/users/{id}` (hard delete), `DELETE /admin/sessions/{sid}` (force-logout). UI Admin nasconde/disabilita i relativi pulsanti + badge "🔒 master".
- **Arrivi**: ScannerBar nascosto all'ingresso (solo card). Compare dopo scelta operazione (§7 spec). Spedizioni invariato: ScannerBar sempre visibile (§18).
- **Ruolo `responsabile`**: aggiunto a `VALID_ROLES` backend + selettore 3-way (Operatore/Responsabile/Admin) in Create + Edit user (desktop + mobile). Permessi = OPERATOR (per ora).
- **Fonte Inventario**: nuova tab Admin (`InventorySourceTab`) read-only con `🟢 NOTION Attivo` + `🔵 GESTIONALE In arrivo` (bottone switch disabilitato). Nessuna logica di switch attivata.
- Verificato: Notion invariato, `/api/time` 200, endpoint protetti (401 senza JWT), `is_master_user` case-insensitive OK, ruolo `responsabile` in VALID_ROLES.
