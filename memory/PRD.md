# PRD — Checklist Magazzino Spedizioni (Elios Tech)

## Original Problem Statement
Applicazione web/mobile responsive per gestione magazzino e controllo checklist spedizioni.
Form ottimizzato per tablet/smartphone in magazzino.
- Campi generali: Nome Operatore, Data Spedizione (default oggi), Struttura destinazione
- 3 Categorie prodotti: Cat1 Wallbox e Daze / Cat2 Meter e Misuratori (quantità + seriali obbligatori), Cat3 Accessori (solo quantità)
- Quando quantità > 0 (Cat1/Cat2): generare dinamicamente N campi S/N + pulsante scan barcode/QR
- Pulsante "INVIA CHECKLIST": valida serials → genera HTML email → invia via Resend a destinatari prefissati → conferma + reset
- Nessuna autenticazione, nessun DDT

## User Choices
- Servizio email: **Resend gestito da Emergent** (nessuna API key richiesta)
- Destinatario prefissato: `tecnico@eliostech.org` (env `CHECKLIST_RECIPIENTS`)
- Struttura: campo testo libero
- App aperta, senza login

## Architecture
- **Backend**: FastAPI + Motor (MongoDB) + httpx per Resend proxy
- **Frontend**: React + Shadcn UI + Tailwind + Sonner + html5-qrcode + @phosphor-icons/react
- **DB**: collection `checklists` (documenti record spedizione)
- **Email**: `EMAIL_BASE_URL=https://integrations.emergentagent.com` (costante), header `X-Email-Key`

## Environment Variables
- `EMERGENT_EMAIL_KEY` (backend/.env) — gestito da Emergent
- `EMAIL_FROM_NAME=Elios Tech Magazzino` — nome mittente visibile
- `CHECKLIST_RECIPIENTS=tecnico@eliostech.org` — CSV di destinatari, modificabile

## What's Been Implemented (2026-02-12)
- Form checklist responsive (mobile/tablet/desktop) con header sticky e footer sticky "INVIA CHECKLIST"
- 3 categorie prodotti con quantità (bottoni +/- e input numerico)
- Campi S/N generati dinamicamente per Cat1/Cat2 con pulsante scan barcode/QR (html5-qrcode via fotocamera)
- Validazione lato client + server (operatore, struttura, serials matching quantity)
- Endpoint `POST /api/checklist/send` genera HTML email formattata con tabella riassuntiva (Operatore, Data, Struttura, prodotti raggruppati per categoria con seriali) e la invia tramite Resend proxy
- Persistenza record in MongoDB (`checklists`) + endpoint `GET /api/checklist/history`
- Endpoint `GET /api/catalog` per esporre catalogo e destinatari
- Toast Sonner per conferme/errori; reset form automatico dopo invio riuscito

## Test Coverage
- Backend: 100% pass su smoke, validazione, happy-path invio, persistenza, sort history

## Prioritized Backlog
- P1 **Storico Spedizioni**: pagina UI che consuma `/api/checklist/history` con filtri per data/operatore/struttura
- P1 **Export PDF/DDT**: generare DDT/PDF scaricabile della checklist (jspdf o backend reportlab)
- P2 **Multi-destinatari UI**: pannello admin per gestire array destinatari via form invece che env
- P2 **Firma Operatore**: canvas per firma digitale dell'operatore in fondo al form
- P2 **Modalità Offline**: cache localStorage per riprendere una checklist non inviata (rete instabile in magazzino)
- P3 **Ruoli & Login opzionale**: se in futuro si vuole tracciare operatori con account
