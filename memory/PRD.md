# PRD — Magazzino Elios Tech

## Fasi
- **F0-F6** ✅ (scanner, cache O(1), Notion SSOT, conferma finale, mapping strict)
- **Phase-2 Auth & RBAC** ✅ (15/02/2026)
  - JWT + bcrypt + MongoDB (users, audit_logs)
  - Bootstrap sicuro primo admin (nessun autoseed) → Admin reale: **Riccardo Biuso** (`riccardo`)
  - Ruoli operator|admin, 403 su rotte admin per operator
  - Session invalidation via `password_version`
  - `Preso da` in Spedizioni = full_name(JWT), non modificabile client-side
  - Test: 94 passed, 1 skipped. Mapping strict §11: 8/8.
- **Phase-3 P1 Admin Extra** ✅ (15/02/2026)
  - Audit Log UI (`/admin` → tab Audit)
  - Anomalie: delete singolo + clear all (admin only, con conferma)
  - Storico Seriali: cerca SN → status + ultima entrata + ultima uscita
  - Ricerca Globale Admin: prodotti + spedizioni + arrivi + status seriale
  - Impostazioni: soglia sotto-scorta, prefisso TEST, durata feedback
  - Cleanup dati TEST_: preview + conferma esplicita, mai tocca Notion
  - Tutti i nuovi endpoint in `routes/admin_extra_routes.py`, JWT-admin (401 no auth verified)
- **Design System Unification (Ibrido premium)** ✅ (15/02/2026)
  - Design tokens unificati in `index.css` (navy 950/900, amber 300/400, IBM Plex + Manrope, shadow soffuse)
  - Header dark navy full-width con logo Elios (coerente con Login) su tutte le pagine + Admin
  - Nav con active/hover amber (`.et-nav-link`)
  - Card premium light (`.et-card`, `.et-card-elevated`) + tables (`.et-table`) con row-hover amber
  - Pulsante primario `.et-btn-primary` (nero navy con accento amber su hover)
  - Focus ring amber globale (input/button/textarea) via CSS override — coerente con Login
  - Dashboard: KPI cards elevated + big Arrivi/Spedizioni card con semantic glow (emerald/amber su navy)
  - Nessuna modifica a logiche, API, mapping Notion o autenticazione
- PWA — solo alla fine

## File architettura
- Backend: `server.py` (F1-F6 preservato) + `routes/{auth,admin_users,admin_extra}_routes.py`
- Frontend: `AuthContext`, `ProtectedRoute`, `LoginPage`, `AdminUsersPage`, `AdminExtraTabs`, aggiornati `AdminPage/ChecklistPage/ArriviPage/AnomaliePage/AppLayout`

## Regole invariate
- Notion = SSOT (inventario, seriali, movimenti, arrivi, uscite)
- MongoDB solo per: users, audit_logs, anomalies, history locale, settings
- Password mai in chiaro (bcrypt), mai su Notion, mai nei log/audit
- Mapping strict §11: `SN`/`Item`=solo seriale, `Preso per`=solo cliente, `Preso da`=solo operatore
- Nessuna scrittura reale di movimenti Wallbox durante i test

## Backlog
- Export CSV/Excel (P2)
- PWA installabilità (P3, ultima fase)
