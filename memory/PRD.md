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

## F8 — P0+P1 Prompt Definitivo ✅ (16/02/2026)
- **Rinomina card operative**: Arrivi → "RICEVI SERIALI / RICEVI QUANTITÀ / REINTEGRA SERIALE"; Spedizioni → "SPEDISCI SERIALI / SPEDISCI QUANTITÀ" (nessun cambio dimensioni/stile).
- **Account master `tecnico@eliostech.org` protetto a livello backend**: `auth.is_master_user()` + guardie 403 in `PATCH /admin/users/{id}` (role/active), `POST /admin/users/{id}/reset-password`, `DELETE /admin/users/{id}` (hard delete), `DELETE /admin/sessions/{sid}` (force-logout). UI Admin nasconde/disabilita i relativi pulsanti + badge "🔒 master".
- **Arrivi**: ScannerBar nascosto all'ingresso (solo card). Compare dopo scelta operazione (§7 spec). Spedizioni invariato: ScannerBar sempre visibile (§18).
- **Ruolo `responsabile`**: aggiunto a `VALID_ROLES` backend + selettore 3-way (Operatore/Responsabile/Admin) in Create + Edit user (desktop + mobile). Permessi = OPERATOR (per ora).
- **Fonte Inventario**: nuova tab Admin (`InventorySourceTab`) read-only con `🟢 NOTION Attivo` + `🔵 GESTIONALE In arrivo` (bottone switch disabilitato). Nessuna logica di switch attivata.
- Verificato: Notion invariato, `/api/time` 200, endpoint protetti (401 senza JWT), `is_master_user` case-insensitive OK, ruolo `responsabile` in VALID_ROLES.
