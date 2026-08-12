# PRD — Checklist Magazzino Spedizioni (Elios Tech)

## Original Problem Statement
Applicazione web/mobile responsive per gestione magazzino e controllo checklist spedizioni. Integrata con Notion (DB INVENTARIO) come single-source-of-truth per le quantità disponibili.

## User Choices
- Servizio email: **Resend gestito da Emergent** → `tecnico@eliostech.org`
- Notion Database: **INVENTARIO**, data source `Inventario` (materiali con formula `QTA in magazzino`) + `Inventory Tracker` (uscite/picks)
- Password admin: `admin123` (env `ADMIN_PASSWORD`)
- Campo shipment: **"Cliente / Destinazione"** + **"Numero DDT"** (opzionale)
- Nessuna autenticazione operatore

## Architecture
- **Backend**: FastAPI + Motor (Mongo) + httpx (Resend + Notion) + reportlab (PDF)
- **Frontend**: React + Shadcn UI + Sonner + html5-qrcode + @phosphor-icons/react
- **Notion**: API v2025-09-03, endpoint data-source
- **DB Mongo**: `checklists` (storico app), `settings.recipients` (destinatari email), `settings.serial_overrides` (override "serializzato" per page_id)

## Env vars (backend/.env)
- `EMERGENT_EMAIL_KEY`, `EMAIL_FROM_NAME`, `CHECKLIST_RECIPIENTS`
- `ADMIN_PASSWORD`
- `NOTION_TOKEN`, `NOTION_INVENTARIO_DS_ID`, `NOTION_TRACKER_DS_ID`, `NOTION_VERSION`

## Implementation Timeline

### v1 — MVP checklist (12/02/2026)
Form spedizione responsive, 3 categorie hardcoded, quantità + seriali, scanner QR/barcode, invio email Resend.

### v2 — Pannello admin (12/02/2026)
`/admin` con password, tab Catalogo (edit), Destinatari, Storico. Catalogo su MongoDB.

### v3 — Integrazione Notion (12/02/2026)
`GET /api/inventory` live da Notion, `POST /api/checklist/send` re-legge + verifica + crea pick in Tracker + email + storico. Rollback su errore. Frontend: filtri per categoria, badge S/N, bottone Aggiorna. Admin: Catalogo → Inventario Notion (read-only + toggle Serializzato locale).

### v4 — DDT, Storico completo, Filtri, PDF, Fix QR (12/02/2026)
- **Numero DDT**: nuovo campo opzionale nel form spedizione, mostrato in badge nello storico + prominente nel PDF
- **Storico Uscite Notion**: `GET /api/admin/notion-exits` legge live Inventory Tracker, risolve nomi materiali via inventario map, filtra righe vuote (475 righe reali). Sezione dedicata nel tab Storico admin (con toggle on/off)
- **Filtri Storico**: Cliente, Materiale, Numero DDT, Data da/a. Applicati sia a spedizioni app (query MongoDB) sia a uscite Notion (filtro post-fetch)
- **PDF DDT**: `GET /api/admin/history/{id}/pdf` genera PDF professionale con reportlab: header con DDT number, info block (Cliente/Data/Operatore), tabella materiali (Codice, Q.tà, Unità, Seriali), note, area firma operatore + firma cliente. Download via axios blob
- **Fix BarcodeScanner**: refactor per fixare `sconosciuto` error causato da Radix Dialog portal mount timing. Ora usa `requestAnimationFrame` loop fino a 60 frames per attendere il div nel DOM prima di costruire Html5Qrcode. Callback ref pattern per onDetected. Guard su start/stop concurrent calls. Messaggi errore specifici (permission/https/notfound/inuse)
- **Fix clearFilters**: passa override object direttamente a loadLocal/loadNotion (no più stale closure via setTimeout)

## Test Coverage — v4
- **Backend**: 15/15 pytest passed (iteration_2). Filtri storico, notion-exits, PDF 200 con Content-Disposition, PDF 404 su id inesistente, magic bytes PDF verificati
- **Frontend**: 100% (iteration_4). ClearFilters ripristina baseline count, BarcodeScanner 3 cicli open/close puliti, PDF download DDT-*.pdf, filtri riducono correttamente, Notion exits toggle
- **PDF visivo verificato**: layout professionale, testo leggibile, aree firma con linee, DDT number prominente

## Prioritized Backlog
- P1 **Modifica/annulla spedizione**: dallo storico ripristinare quantità Notion se una spedizione è stata registrata per errore
- P1 **Aggiungi colonne Notion**: opzionalmente aggiungere `Serializzato` (checkbox) e `Unità` (select) direttamente in Notion per dismettere override locale
- P2 **PWA installabile**: manifest + service worker per icona home + funzionamento offline base
- P2 **Multi-utente**: login operatore con tracciamento "Preso da" (people) su Notion Tracker
- P2 **Export CSV storico**: bulk download di tutti i record filtrati
- P3 **Notifiche in tempo reale**: dashboard che mostra soglie sotto stock minimo (QTA Minima in Stock esiste già in Notion)
- P3 **Split file server.py**: refactoring in moduli (admin_routes.py, notion_routes.py) — attualmente ~600 righe
