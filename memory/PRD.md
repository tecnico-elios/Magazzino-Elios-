# PRD — Checklist Magazzino Spedizioni (Elios Tech)

## Original Problem Statement
Applicazione web/mobile responsive per gestione magazzino e controllo checklist spedizioni. Integrata con Notion come single-source-of-truth per le quantità.

## User Choices
- **Servizio email**: Resend gestito da Emergent
- **Destinatario prefissato**: `tecnico@eliostech.org` (modificabile da admin)
- **Notion Database**: `INVENTARIO` (id `279a9b09-6783-8059-95c0-cc6bcab9ed80`), data source `Inventario` (materiali) + `Inventory Tracker` (uscite/picks)
- **Password admin**: `admin123` (env `ADMIN_PASSWORD`)
- **Campo "Cliente / Destinazione"** al posto di "Struttura"
- **Nessuna autenticazione operatore** per la checklist

## Architecture
- **Backend**: FastAPI + Motor (MongoDB) + httpx (Resend + Notion)
- **Frontend**: React + Shadcn UI + Tailwind + Sonner + html5-qrcode + @phosphor-icons/react
- **Notion**: API v2025-09-03, data-source endpoint. Legge `Inventario` (con formula `QTA in magazzino`), scrive un record in `Inventory Tracker` per ogni spedizione (audit trail nativo)
- **DB Mongo**: `checklists` (storico), `settings` (destinatari + override "serializzato" per page_id)

## Environment Variables (backend/.env)
- `EMERGENT_EMAIL_KEY`, `EMAIL_FROM_NAME` — Resend gestito da Emergent
- `CHECKLIST_RECIPIENTS` — seed destinatari
- `ADMIN_PASSWORD`
- `NOTION_TOKEN` — Internal Integration Token
- `NOTION_INVENTARIO_DS_ID` — data source "Inventario"
- `NOTION_TRACKER_DS_ID` — data source "Inventory Tracker"
- `NOTION_VERSION=2025-09-03`

## What's Been Implemented
### v1 — MVP checklist (12/02/2026)
- Form spedizione responsive con 3 categorie hardcoded, quantità + seriali, scanner QR/barcode, invio email Resend.

### v2 — Pannello admin (12/02/2026)
- `/admin` protetto da password, tab Catalogo (edit), Destinatari, Storico. Catalogo in MongoDB.

### v3 — Integrazione Notion (12/02/2026)
- **Notion diventa la fonte primaria** dei materiali e delle quantità disponibili.
- `GET /api/inventory`: legge live da Notion (data source Inventario) con quantità formula `QTA in magazzino`, categorie, unità, override "serializzato" locale.
- `POST /api/checklist/send`: **re-legge** ogni item da Notion al momento della conferma → verifica disponibilità → crea record in `Inventory Tracker` (uno per SN per materiali serializzati, uno aggregato per non-serializzati) → Notion aggiorna la quantità via formula/rollup → invia email → persiste storico. Rollback (archive) dei tracker in caso di errore.
- Frontend: `useInventory` hook, filtri per categoria, badge "S/N" e "disponibili X pz" per riga, bottone **Aggiorna Magazzino** (rileggi da Notion), errore chiaro se Notion non raggiungibile, disabilita quantità > disponibile.
- Admin tab "Catalogo" sostituito da **"Inventario Notion"** (read-only + toggle Serializzato per page_id — salvato in MongoDB `settings.serial_overrides`).
- Storico admin: mostra ora "Cliente" + movimenti (before → after) per ogni riga.
- Rinominato campo form da "Struttura" a "Cliente / Destinazione".

## Test Coverage — v3 E2E
Tutti passati (verifica manuale via curl su URL pubblico):
- ✅ 400 se manca operatore/cliente/data
- ✅ 400 se nessun materiale con quantità > 0
- ✅ 400 se materiale serializzato senza seriali completi (esatto match tra n. serials e quantity)
- ✅ 409 "Quantità non disponibile. {nome}: disponibili {X} {unit} — richiesti {Y} {unit}"
- ✅ 200 spedizione reale: Cavo Molex 5→4 su Notion (record Inventory Tracker creato) + email inviata + storico salvato
- ✅ /api/inventory ritorna 42 items live da Notion, 5 categorie corrette
- ✅ Frontend: carica 42 items in ~2s, filtri categoria funzionanti, WWallbox marcato serializzato di default

## Prioritized Backlog
- P1 **Storico su Notion**: leggere Inventory Tracker per mostrare uscite anche fatte fuori app
- P1 **Multi-spedizione per cliente**: gruppo di uscite sotto un unico DDT
- P2 **PWA/Installabile**: manifest + service worker per icona home screen
- P2 **Filtro storico**: per cliente, data range, materiale
- P2 **Export PDF/DDT**: dallo storico admin
- P3 **Notion Serializzato nativo**: se l'utente aggiunge una colonna checkbox "Serializzato" in Notion, il codice la usa automaticamente (già supportato) invece dell'override locale
