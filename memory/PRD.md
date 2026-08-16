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
