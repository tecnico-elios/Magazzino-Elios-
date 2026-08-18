from fastapi import FastAPI, APIRouter, HTTPException, Header, Depends, Request
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
import os
import logging
import uuid
import html as html_lib
from pathlib import Path
from pydantic import BaseModel, Field, ConfigDict, EmailStr
from typing import List, Optional, Dict, Any
from datetime import datetime, timezone
import httpx

# Load .env BEFORE importing notion_service so it can read NOTION_* vars at import time
ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

import notion_service
import inventory_local
from inventory_router import get_svc as _get_inv_svc, get_source as _get_inv_source
import auth as auth_mod
from routes import auth_routes, admin_users_routes, admin_extra_routes
try:
    from zoneinfo import ZoneInfo
    ROME_TZ = ZoneInfo("Europe/Rome")
except Exception:  # pragma: no cover — fallback if tzdata missing
    ROME_TZ = timezone.utc


def _now_rome() -> datetime:
    """Wall-clock time in Europe/Rome — used for emails and 'today' KPIs."""
    return datetime.now(ROME_TZ)


def _today_rome_iso() -> str:
    return _now_rome().date().isoformat()


def _fmt_rome_stamp() -> str:
    """Human-readable Rome timestamp for emails, e.g. '14/02/2026 14:35 (Ora italiana)'."""
    return _now_rome().strftime("%d/%m/%Y %H:%M") + " (Ora italiana)"

# MongoDB
mongo_url = os.environ['MONGO_URL']
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ['DB_NAME']]

# Email (Emergent-managed Resend proxy)
EMAIL_BASE_URL = "https://integrations.emergentagent.com"
EMAIL_KEY = os.environ["EMERGENT_EMAIL_KEY"]
EMAIL_FROM_NAME = os.environ["EMAIL_FROM_NAME"]

# Admin
ADMIN_PASSWORD = os.environ.get("ADMIN_PASSWORD", "admin123")

# Recipient seed
DEFAULT_RECIPIENTS_SEED = [
    r.strip()
    for r in os.environ.get("CHECKLIST_RECIPIENTS", "tecnico@eliostech.org").split(",")
    if r.strip()
]

# Eventi notifica supportati (F9 §28). enabled=True conserva retro-compat.
NOTIFICATION_EVENTS = ["arrivi", "spedizioni", "sotto_scorta", "esauriti", "anomalie", "errori_notion"]
DEFAULT_EVENTS = {ev: True for ev in NOTIFICATION_EVENTS}


# ---------- Settings helpers ----------
def _normalize_recipient(entry: Any) -> Optional[Dict[str, Any]]:
    """Normalizza un destinatario a `{email, enabled, events{...}}`. Retro-compat con legacy list[str]."""
    if isinstance(entry, str):
        e = entry.strip().lower()
        return {"email": e, "enabled": True, "events": dict(DEFAULT_EVENTS)} if e else None
    if isinstance(entry, dict):
        e = str(entry.get("email") or "").strip().lower()
        if not e:
            return None
        enabled = entry.get("enabled")
        events_in = entry.get("events") or {}
        events = {ev: bool(events_in.get(ev, True)) for ev in NOTIFICATION_EVENTS}
        return {
            "email": e,
            "enabled": True if enabled is None else bool(enabled),
            "events": events,
        }
    return None


async def get_recipients_full() -> List[Dict[str, Any]]:
    """Ritorna lista completa `[{email, enabled, events}]` per l'Admin UI.
    Migra automaticamente il vecchio formato list[str] mantenendo enabled=True e tutti gli eventi ON.
    """
    doc = await db.settings.find_one({"_id": "recipients"}, {"_id": 0})
    if doc and isinstance(doc.get("items"), list):
        out = [r for r in (_normalize_recipient(x) for x in doc["items"]) if r]
        return out
    # Legacy: emails come list[str] → migra a items
    if doc and isinstance(doc.get("emails"), list):
        migrated = [r for r in (_normalize_recipient(x) for x in doc["emails"]) if r]
        await db.settings.update_one(
            {"_id": "recipients"},
            {"$set": {"items": migrated}, "$unset": {"emails": ""}},
            upsert=True,
        )
        return migrated
    # Seed default (tutti attivi, tutti gli eventi ON)
    seed = [{"email": e, "enabled": True, "events": dict(DEFAULT_EVENTS)} for e in DEFAULT_RECIPIENTS_SEED]
    await db.settings.update_one(
        {"_id": "recipients"},
        {"$set": {"items": seed}},
        upsert=True,
    )
    return seed


async def get_recipients() -> List[str]:
    """Retro-compat: SOLO email dei destinatari ATTIVI (indipendente dal tipo evento).
    Preferisci `get_recipients_for_event(event)` per il filtro tipizzato F9.
    """
    full = await get_recipients_full()
    return [r["email"] for r in full if r.get("enabled", True)]


async def get_recipients_for_event(event: str) -> List[str]:
    """Ritorna le email attive che hanno il flag `events[event]` ON. Fallback: se manca
    il campo events (record vecchio) si considera ON per retro-compat.
    """
    full = await get_recipients_full()
    out = []
    for r in full:
        if not r.get("enabled", True):
            continue
        events = r.get("events")
        if events is None or events.get(event, True):
            out.append(r["email"])
    return out


async def set_recipients_full(items: List[Dict[str, Any]]) -> None:
    """Salva la lista completa `[{email, enabled, events}]`."""
    await db.settings.update_one(
        {"_id": "recipients"},
        {"$set": {"items": items}, "$unset": {"emails": ""}},
        upsert=True,
    )


async def set_recipients(emails: List[str]) -> None:
    """Retro-compat: salva solo le email (tutte attive, tutti gli eventi ON)."""
    await set_recipients_full([{"email": e, "enabled": True, "events": dict(DEFAULT_EVENTS)} for e in emails])


def resolve_serialized(item: Dict[str, Any]) -> Optional[bool]:
    """F5: Tipo Gestione = Notion Single Source of Truth.
    Returns True (A Seriale), False (A Quantità), or None (NON CONFIGURATO)."""
    tg = item.get("tipo_gestione")
    if tg == "a_seriale":
        return True
    if tg == "a_quantita":
        return False
    return None


def annotate_item(it: Dict[str, Any]) -> Dict[str, Any]:
    """Attach `serialized` (bool) + `configured` (bool) derived from Notion Tipo gestione."""
    ser = resolve_serialized(it)
    it["serialized"] = bool(ser) if ser is not None else False
    it["configured"] = ser is not None
    return it


def require_admin(x_admin_password: Optional[str] = Header(default=None)):
    """LEGACY — kept only for backward compat during Phase 2 migration.
    Use `auth_deps.require_admin` for new admin routes. Will be removed in Phase 3."""
    if not x_admin_password or x_admin_password != ADMIN_PASSWORD:
        raise HTTPException(status_code=401, detail="Non autorizzato")
    return True


# JWT-based auth deps — bound to the same db handle.
auth_deps = auth_mod.AuthDependencies(db)


# Module-level dependency wrappers so FastAPI can introspect signatures.
async def dep_current_user(request: Request, authorization: Optional[str] = Header(default=None)):
    return await auth_deps.get_current_user(request, authorization)


async def dep_require_admin(request: Request, authorization: Optional[str] = Header(default=None)):
    return await auth_deps.require_admin(request, authorization)


# ---------- Models ----------
class ProductItem(BaseModel):
    model_config = ConfigDict(extra="ignore")
    page_id: str
    name: str
    category: Optional[str] = None
    unit: Optional[str] = "pz"
    serialized: bool = False
    quantity: float = 0
    serials: List[str] = Field(default_factory=list)


class ChecklistPayload(BaseModel):
    model_config = ConfigDict(extra="ignore")
    operator: str
    shipping_date: str  # ISO date YYYY-MM-DD
    structure: str      # Cliente / Destinazione
    taken_by: str = ""  # F3: "Da chi è stato preso" — testo libero (Notion rich_text)
    items: List[ProductItem]
    notes: Optional[str] = None


class ChecklistRecord(BaseModel):
    model_config = ConfigDict(extra="ignore")
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    operator: str
    shipping_date: str
    structure: str
    taken_by: str = ""
    items: List[ProductItem]
    notes: Optional[str] = None
    recipients: List[str] = Field(default_factory=list)
    movements: List[dict] = Field(default_factory=list)
    tracker_page_ids: List[str] = Field(default_factory=list)
    status: str = "completed"
    created_at: str = Field(default_factory=lambda: datetime.now(timezone.utc).isoformat())


class LoginRequest(BaseModel):
    password: str


class ArrivoItem(BaseModel):
    model_config = ConfigDict(extra="ignore")
    page_id: str
    name: str
    unit: Optional[str] = "pz"
    serialized: bool = False
    quantity: float = 0
    serials: List[str] = Field(default_factory=list)


class ArrivoPayload(BaseModel):
    model_config = ConfigDict(extra="ignore")
    operator: str
    arrival_date: str   # ISO date
    fornitore: str      # ONLY for email — NOT stored in Notion
    items: List[ArrivoItem]
    notes: Optional[str] = None


class ArrivoRecord(BaseModel):
    model_config = ConfigDict(extra="ignore")
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    operator: str
    arrival_date: str
    fornitore: str
    items: List[ArrivoItem]
    notes: Optional[str] = None
    recipients: List[str] = Field(default_factory=list)
    receipts_page_ids: List[str] = Field(default_factory=list)
    status: str = "completed"
    created_at: str = Field(default_factory=lambda: datetime.now(timezone.utc).isoformat())


class NotificationEvents(BaseModel):
    model_config = ConfigDict(extra="ignore")
    arrivi: bool = True
    spedizioni: bool = True
    sotto_scorta: bool = True
    esauriti: bool = True
    anomalie: bool = True
    errori_notion: bool = True


class RecipientItem(BaseModel):
    email: EmailStr
    enabled: bool = True
    events: Optional[NotificationEvents] = None


class RecipientsUpdate(BaseModel):
    # Retro-compat: accetta sia list[str] (legacy) sia list[RecipientItem] (nuovo formato F8/F9).
    emails: Optional[List[EmailStr]] = None
    items: Optional[List[RecipientItem]] = None


class SerialOverrideUpdate(BaseModel):
    page_id: str
    serialized: bool


# ---------- Validation ----------
def validate_checklist_basic(payload: ChecklistPayload) -> None:
    if not payload.operator.strip():
        raise HTTPException(400, "Nome operatore obbligatorio")
    if not payload.structure.strip():
        raise HTTPException(400, "Cliente / Destinazione obbligatorio")
    # NOTA F2: `taken_by` NON è più obbligatorio nel payload. Il backend lo
    # imposta automaticamente dal JWT dell'operatore loggato (submit_checklist).
    if not payload.shipping_date.strip():
        raise HTTPException(400, "Data spedizione obbligatoria")

    filled = [i for i in payload.items if i.quantity > 0]
    if not filled:
        raise HTTPException(400, "Inserisci almeno un prodotto con quantità maggiore di zero")

    for item in filled:
        if item.serialized:
            expected = int(item.quantity)
            serials = [s.strip() for s in item.serials]
            if len(serials) != expected or any(not s for s in serials):
                raise HTTPException(
                    400,
                    f"Seriali mancanti per {item.name} (attesi {expected})",
                )


# ---------- Email ----------
def build_html_email(payload: ChecklistPayload, movements: List[dict]) -> str:
    esc = html_lib.escape
    filled = [i for i in payload.items if i.quantity > 0]
    # Group by category for readability
    by_cat: Dict[str, List[ProductItem]] = {}
    for it in filled:
        by_cat.setdefault(it.category or "Altro", []).append(it)

    move_map = {m["page_id"]: m for m in movements}
    rows_html = []
    for cat_name in sorted(by_cat.keys()):
        rows_html.append(
            f'<tr><td colspan="4" style="background:#0f172a;color:#fff;padding:10px 14px;'
            f'font-family:Arial,sans-serif;font-size:13px;letter-spacing:.08em;'
            f'text-transform:uppercase;font-weight:700;">{esc(cat_name)}</td></tr>'
        )
        for it in by_cat[cat_name]:
            m = move_map.get(it.page_id, {})
            serials_html = (
                "<ul style='margin:6px 0 0 18px;padding:0;font-family:Consolas,monospace;font-size:13px;color:#0f172a;'>"
                + "".join(f"<li>{esc(s)}</li>" for s in it.serials)
                + "</ul>"
                if it.serialized and it.serials
                else '<span style="color:#64748b;font-size:13px;">—</span>'
            )
            unit = it.unit or "pz"
            stock_after = m.get("after")
            stock_txt = (
                f'<span style="color:#0f172a;font-weight:700;">{stock_after}</span> '
                f'<span style="color:#64748b;">{esc(unit)}</span>'
                if stock_after is not None
                else "—"
            )
            rows_html.append(
                f"<tr>"
                f'<td style="padding:12px 14px;border-bottom:1px solid #e2e8f0;font-family:Arial,sans-serif;font-size:14px;color:#0f172a;vertical-align:top;">{esc(it.name)}</td>'
                f'<td style="padding:12px 14px;border-bottom:1px solid #e2e8f0;font-family:Arial,sans-serif;font-size:14px;color:#0f172a;text-align:center;font-weight:700;vertical-align:top;width:110px;">{esc(str(_qty_fmt(it.quantity)))} {esc(unit)}</td>'
                f'<td style="padding:12px 14px;border-bottom:1px solid #e2e8f0;vertical-align:top;">{serials_html}</td>'
                f'<td style="padding:12px 14px;border-bottom:1px solid #e2e8f0;font-family:Arial,sans-serif;font-size:13px;text-align:right;vertical-align:top;width:130px;">Stock: {stock_txt}</td>'
                f"</tr>"
            )

    table_body = "".join(rows_html) or (
        '<tr><td colspan="4" style="padding:20px;text-align:center;color:#64748b;">Nessun prodotto</td></tr>'
    )
    notes_block = (
        f'<div style="margin-top:20px;padding:14px;background:#fef3c7;border-left:4px solid #f59e0b;'
        f'font-family:Arial,sans-serif;font-size:14px;color:#78350f;">'
        f'<strong>Note:</strong> {esc(payload.notes)}</div>'
        if payload.notes and payload.notes.strip()
        else ""
    )

    return f"""<!DOCTYPE html>
<html><head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;background:#f1f5f9;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f1f5f9;padding:24px 0;">
  <tr><td align="center">
    <table role="presentation" width="720" cellpadding="0" cellspacing="0" style="background:#ffffff;border:1px solid #e2e8f0;">
      <tr><td style="background:#0f172a;padding:24px;">
        <div style="font-family:Arial,sans-serif;color:#94a3b8;font-size:11px;letter-spacing:.2em;text-transform:uppercase;">Magazzino Elios Tech</div>
        <div style="font-family:Arial,sans-serif;color:#ffffff;font-size:22px;font-weight:700;margin-top:6px;">Spedizione confermata — magazzino aggiornato</div>
      </td></tr>
      <tr><td style="padding:24px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e2e8f0;">
          <tr>
            <td style="padding:12px 14px;background:#f8fafc;font-family:Arial,sans-serif;font-size:12px;color:#64748b;text-transform:uppercase;letter-spacing:.08em;font-weight:700;width:35%;border-bottom:1px solid #e2e8f0;">Cliente / Destinazione</td>
            <td style="padding:12px 14px;font-family:Arial,sans-serif;font-size:15px;color:#0f172a;font-weight:600;border-bottom:1px solid #e2e8f0;">{esc(payload.structure)}</td>
          </tr>
          <tr>
            <td style="padding:12px 14px;background:#f8fafc;font-family:Arial,sans-serif;font-size:12px;color:#64748b;text-transform:uppercase;letter-spacing:.08em;font-weight:700;border-bottom:1px solid #e2e8f0;">Operatore</td>
            <td style="padding:12px 14px;font-family:Arial,sans-serif;font-size:15px;color:#0f172a;font-weight:600;border-bottom:1px solid #e2e8f0;">{esc(payload.taken_by or payload.operator or "—")}</td>
          </tr>
          <tr>
            <td style="padding:12px 14px;background:#f8fafc;font-family:Arial,sans-serif;font-size:12px;color:#64748b;text-transform:uppercase;letter-spacing:.08em;font-weight:700;">Data Spedizione</td>
            <td style="padding:12px 14px;font-family:Arial,sans-serif;font-size:15px;color:#0f172a;font-weight:600;">{esc(payload.shipping_date)}</td>
          </tr>
        </table>

        <div style="font-family:Arial,sans-serif;font-size:13px;color:#64748b;text-transform:uppercase;letter-spacing:.1em;font-weight:700;margin:24px 0 10px;">Materiali Spediti</div>
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e2e8f0;">
          <thead>
            <tr>
              <th align="left" style="padding:10px 14px;background:#f8fafc;font-family:Arial,sans-serif;font-size:12px;color:#64748b;text-transform:uppercase;letter-spacing:.08em;border-bottom:1px solid #e2e8f0;">Materiale</th>
              <th align="center" style="padding:10px 14px;background:#f8fafc;font-family:Arial,sans-serif;font-size:12px;color:#64748b;text-transform:uppercase;letter-spacing:.08em;border-bottom:1px solid #e2e8f0;">Q.tà</th>
              <th align="left" style="padding:10px 14px;background:#f8fafc;font-family:Arial,sans-serif;font-size:12px;color:#64748b;text-transform:uppercase;letter-spacing:.08em;border-bottom:1px solid #e2e8f0;">Seriali S/N</th>
              <th align="right" style="padding:10px 14px;background:#f8fafc;font-family:Arial,sans-serif;font-size:12px;color:#64748b;text-transform:uppercase;letter-spacing:.08em;border-bottom:1px solid #e2e8f0;">Residuo</th>
            </tr>
          </thead>
          <tbody>{table_body}</tbody>
        </table>
        {notes_block}
        <div style="font-family:Arial,sans-serif;font-size:12px;color:#94a3b8;margin-top:24px;border-top:1px solid #e2e8f0;padding-top:14px;">
          Magazzino Notion aggiornato automaticamente. Email generata da Magazzino Elios Tech.
        </div>
      </td></tr>
    </table>
  </td></tr>
</table>
</body></html>"""


def _qty_fmt(q: float) -> Any:
    return int(q) if float(q).is_integer() else q


async def send_email(recipient: str, subject: str, html_content: str) -> Optional[str]:
    payload = {
        "to": [recipient],
        "subject": subject,
        "html": html_content,
        "from_name": EMAIL_FROM_NAME,
    }
    async with httpx.AsyncClient(timeout=30) as c:
        resp = await c.post(
            f"{EMAIL_BASE_URL}/api/v1/email/send",
            headers={"X-Email-Key": EMAIL_KEY},
            json=payload,
        )
    resp.raise_for_status()
    try:
        return resp.json().get("id")
    except Exception:
        return None


# ---------- FastAPI ----------
app = FastAPI()
api_router = APIRouter(prefix="/api")


@api_router.get("/")
async def root():
    return {"status": "ok", "service": "Magazzino Elios Tech", "notion_configured": notion_service.is_configured()}


@api_router.get("/inventory")
async def inventory():
    """Fresh read of current Inventory (Notion or Gestionale — switch via Admin)."""
    svc = await _get_inv_svc(db)
    if not svc.is_configured():
        raise HTTPException(503, "Fonte inventario non configurata")
    try:
        items = await svc.list_inventory(force_refresh=True)
    except httpx.HTTPStatusError as e:
        raise HTTPException(502, f"Sorgente HTTP {e.response.status_code}: {e.response.text[:200]}")
    except Exception as e:
        raise HTTPException(502, f"Impossibile leggere inventario: {e}")
    for it in items:
        annotate_item(it)
    categories = sorted({(it.get("category") or "Senza categoria") for it in items})
    return {
        "items": items,
        "categories": categories,
        "source": await _get_inv_source(db),
        "refreshed_at": datetime.now(timezone.utc).isoformat(),
    }


@api_router.get("/inventory/lookup")
async def inventory_lookup(code: str):
    """Look up a scanned code against Notion (F6-rientri).
    Returns:
      - {status:"ok",   matched_by:"sku",  item}                          — SKU match
      - {status:"in_warehouse", matched_by:"sn", item, receipt_date, ...} — SN currently in
      - {status:"out",  matched_by:"sn", item, shipped_to, shipped_date}  — SN currently out
      - {status:"not_found", code}                                        — never seen
    """
    code_clean = (code or "").strip()
    if not code_clean:
        raise HTTPException(400, "Codice mancante")
    svc = await _get_inv_svc(db)
    if not svc.is_configured():
        raise HTTPException(503, "Fonte inventario non configurata")
    try:
        items = await svc.list_inventory()
    except Exception as e:
        raise HTTPException(502, f"Errore lettura inventario: {e}")
    code_lower = code_clean.lower()

    # 1) Match on Codice prodotto (SKU)
    for it in items:
        if (it.get("code") or "").strip().lower() == code_lower:
            annotate_item(it)
            return {
                "status": "ok",
                "matched_by": "sku",
                "item": it,
                "code": code_clean,
            }

    # 2) SN → latest-movement status
    try:
        st = await svc.latest_serial_status(code_clean)
    except Exception as e:
        raise HTTPException(502, f"Errore ricerca seriale: {e}")

    if st["status"] == "unseen":
        return {"status": "not_found", "code": code_clean}

    last = st.get("last") or {}
    matched_item = None
    item_ids = last.get("item_ids") or []
    if item_ids:
        for i in items:
            if i["id"] == item_ids[0]:
                annotate_item(i)
                matched_item = i
                break

    # F6-quantita: se il prodotto è A Quantità, il valore trovato nella colonna
    # "Item"/"SN" è un BARCODE (non un seriale univoco). Trattalo come match SKU
    # → nessuna validazione seriale, apri QtyDialog.
    if matched_item and matched_item.get("tipo_gestione") == "a_quantita":
        return {
            "status": "ok",
            "matched_by": "barcode",
            "item": matched_item,
            "code": code_clean,
        }

    if st["status"] == "in_warehouse":
        return {
            "status": "in_warehouse",
            "matched_by": "sn",
            "code": code_clean,
            "serial": last.get("matched_serial") or code_clean,
            "item": matched_item,
            "receipt_date": last.get("date"),
            "receipt_url": last.get("url"),
        }
    # status == "out"
    return {
        "status": "out",
        "matched_by": "sn",
        "code": code_clean,
        "serial": last.get("matched_serial") or code_clean,
        "item": matched_item,
        "shipped_to": last.get("cliente"),
        "shipped_date": last.get("date"),
        "tracker_url": last.get("url"),
    }


@api_router.post("/checklist/send")
async def submit_checklist(
    payload: ChecklistPayload,
    current_user: Dict[str, Any] = Depends(dep_current_user),
):
    # NOTA: risolto tramite override sotto (app.dependency_overrides) → auth_deps
    # OVERRIDE server-side (Prompt 220 §Operatore Automatico): l'identità
    # dell'operatore proviene ESCLUSIVAMENTE dal token, non dal payload.
    payload.operator = f"{current_user.get('first_name','')} {current_user.get('last_name','')}".strip() or current_user.get("username") or ""
    payload.taken_by = payload.operator
    validate_checklist_basic(payload)
    svc = await _get_inv_svc(db)
    if not svc.is_configured():
        raise HTTPException(503, "Fonte inventario non configurata")

    filled = [i for i in payload.items if i.quantity > 0]

    # 1) Re-read fresh stock from source
    fresh_map: Dict[str, Dict[str, Any]] = {}
    for it in filled:
        try:
            fresh_map[it.page_id] = await svc.get_item(it.page_id)
        except Exception as e:
            raise HTTPException(502, f"Impossibile aggiornare il magazzino. Riprova. ({it.name}: {e})")

    # F5: BLOCK if any product has no `Tipo gestione` configured on Notion.
    not_configured = [
        fresh_map[it.page_id].get("name") or it.name
        for it in filled
        if fresh_map[it.page_id].get("tipo_gestione") not in ("a_seriale", "a_quantita")
    ]
    if not_configured:
        await log_anomaly(
            kind="tipo_gestione_missing",
            description=f"Prodotti senza Tipo Gestione: {', '.join(not_configured)}",
            operator=payload.operator,
            product=", ".join(not_configured),
            source="spedizione",
        )
        raise HTTPException(
            400,
            "TIPO DI GESTIONE NON CONFIGURATO su Notion per: "
            + ", ".join(not_configured)
            + ". Configurarlo dall'Admin prima di procedere.",
        )

    # 2) STRICT SERIAL VALIDATION for serialized items — LATEST-MOVEMENT rule.
    #    Un seriale è spedibile SOLO se il suo ultimo movimento è ENTRATA.
    #    Il check è LIVE al submit per proteggere da race multi-operatore.
    serial_errors: List[str] = []
    seen_serials: set = set()
    for it in filled:
        if not it.serialized:
            continue
        for sn in (it.serials or []):
            sn_c = (sn or "").strip()
            if not sn_c:
                continue
            sn_key = sn_c.lower()
            if sn_key in seen_serials:
                serial_errors.append(f"{it.name} — SN {sn_c} inserito più volte nella stessa spedizione")
                continue
            seen_serials.add(sn_key)
            try:
                st = await svc.latest_serial_status(sn_c)
            except Exception as e:
                raise HTTPException(502, f"Errore verifica stato seriale: {e}")
            if st["status"] == "unseen":
                serial_errors.append(f"{it.name} — SN {sn_c} non risulta mai entrato in magazzino")
                continue
            if st["status"] == "out":
                last = st.get("last") or {}
                serial_errors.append(
                    f"{it.name} — SN {sn_c} non disponibile in magazzino"
                    + (f" (uscito il {last.get('date')}" if last.get("date") else "")
                    + (f" — cliente {last.get('cliente')})" if last.get("cliente") else (")" if last.get("date") else ""))
                )
    if serial_errors:
        # F4: log anomaly for auditability
        await log_anomaly(
            kind="submit_blocked_serials",
            description=" • ".join(serial_errors),
            operator=payload.operator,
            product=", ".join({i.name for i in filled if i.serialized}) or None,
            serial_or_code=", ".join({s for i in filled if i.serialized for s in (i.serials or [])})[:400] or None,
            source="spedizione",
        )
        raise HTTPException(
            409,
            "Impossibile confermare la spedizione. " + " • ".join(serial_errors),
        )

    # 3) Verify availability
    shortages = []
    for it in filled:
        avail = fresh_map[it.page_id].get("quantity") or 0
        if it.quantity > avail:
            unit = it.unit or "pz"
            shortages.append(f"{it.name}: disponibili {_qty_fmt(avail)} {unit} — richiesti {_qty_fmt(it.quantity)} {unit}")
    if shortages:
        await log_anomaly(
            kind="shipment_shortage",
            description=" • ".join(shortages),
            operator=payload.operator,
            product=", ".join({i.name for i in filled}) or None,
            source="spedizione",
        )
        raise HTTPException(409, "Quantità non disponibile. " + " • ".join(shortages))

    # 3) Create Inventory Tracker rows in Notion (one per SN for serialized, one aggregated otherwise)
    tracker_ids: List[str] = []
    movements: List[dict] = []
    try:
        for it in filled:
            fresh = fresh_map[it.page_id]
            before = fresh.get("quantity") or 0
            # STRICT Notion mapping (Prompt 220 §11):
            #   SN (title)  = SOLO seriale (o nome prodotto per A Quantità — MAI concatenato)
            #   Preso per   = SOLO cliente/struttura
            #   Preso da    = SOLO operatore
            operator_name = (payload.taken_by or payload.operator or "").strip()
            if it.serialized and it.serials:
                for s in it.serials:
                    pid = await svc.create_pick(
                        item_page_id=it.page_id,
                        sn_title=s.strip(),
                        quantity=1,
                        cliente=payload.structure,
                        data_uscita=payload.shipping_date,
                        taken_by=operator_name,
                    )
                    tracker_ids.append(pid)
            else:
                # A Quantità: nessun seriale → title = SOLO nome prodotto (nessuna concatenazione)
                pid = await svc.create_pick(
                    item_page_id=it.page_id,
                    sn_title=it.name,
                    quantity=it.quantity,
                    cliente=payload.structure,
                    data_uscita=payload.shipping_date,
                    taken_by=operator_name,
                )
                tracker_ids.append(pid)
            movements.append({
                "page_id": it.page_id,
                "name": it.name,
                "unit": it.unit or "pz",
                "before": before,
                "shipped": it.quantity,
                "after": before - it.quantity,
                "serials": it.serials if it.serialized else [],
            })
    except Exception as e:
        # Best-effort rollback
        for pid in tracker_ids:
            await svc.archive_page(pid)
        raise HTTPException(502, f"Impossibile aggiornare il magazzino. Riprova. ({e})")

    # F8 §18: rimuovi i seriali spediti dalla colonna 16 "SN /codice" dell'Inventario Notion
    # (no-op quando fonte=gestionale). Best-effort: se fallisce non blocca la spedizione.
    try:
        for it in filled:
            if it.serialized and it.serials:
                await svc.remove_inventory_serials(it.page_id, [s.strip() for s in it.serials if s and s.strip()])
    except Exception as e:
        logging.warning(f"remove_inventory_serials fallito (non blocca la spedizione): {e}")
    svc.invalidate_inventory_cache()

    # 4) Send email(s) — email failure does not invalidate the shipment
    # F9 §28: filtra per evento "spedizioni"
    recipients = await get_recipients_for_event("spedizioni")
    html_content = build_html_email(payload, movements)
    subject = f"Spedizione — {payload.structure} — {payload.shipping_date}"
    sent = []
    errors = []
    for r in recipients:
        try:
            eid = await send_email(r, subject, html_content)
            sent.append({"recipient": r, "id": eid})
        except Exception as e:
            logging.error(f"Email send error for {r}: {e}")
            errors.append({"recipient": r, "error": str(e)})

    # 5) Persist history
    record = ChecklistRecord(
        operator=payload.operator,
        shipping_date=payload.shipping_date,
        structure=payload.structure,
        taken_by=payload.taken_by,
        items=filled,
        notes=payload.notes,
        recipients=[s["recipient"] for s in sent],
        movements=movements,
        tracker_page_ids=tracker_ids,
        status="completed",
    )
    await db.checklists.insert_one(record.model_dump())

    return {
        "status": "success",
        "message": f"Spedizione confermata. Magazzino Notion aggiornato ({len(movements)} articoli).",
        "movements": movements,
        "sent": sent,
        "errors": errors,
        "checklist_id": record.id,
    }


async def log_anomaly(kind: str, description: str, operator: Optional[str] = None,
                      product: Optional[str] = None, serial_or_code: Optional[str] = None,
                      source: Optional[str] = None) -> None:
    """F4: Register an operational anomaly in Mongo. Best-effort, non-blocking failure."""
    try:
        await db.anomalies.insert_one({
            "id": str(uuid.uuid4()),
            "created_at": datetime.now(timezone.utc).isoformat(),
            "kind": kind, "description": description, "operator": operator,
            "product": product, "serial_or_code": serial_or_code, "source": source,
        })
    except Exception as e:
        logging.error(f"log_anomaly failed: {e}")


@api_router.get("/anomalie")
async def list_anomalie(limit: int = 100):
    docs = await db.anomalies.find({}, {"_id": 0}).sort("created_at", -1).to_list(limit)
    return {"items": docs, "count": len(docs)}


@api_router.get("/movimenti")
async def list_movimenti(
    limit: int = 500,
    month: Optional[str] = None,  # 'YYYY-MM' → filtra server-side su Notion
):
    """Unified movements view — LIVE dalla sorgente attiva (Notion o Gestionale).
    Se `month` è passato (YYYY-MM), il filtro avviene DIRETTAMENTE alla sorgente.
    Mongo NON è mai la fonte quando la sorgente è Notion."""
    svc = await _get_inv_svc(db)
    if not svc.is_configured():
        raise HTTPException(503, "Fonte inventario non configurata")

    date_from = date_to = None
    if month:
        try:
            y, m = month.split("-")
            y_i, m_i = int(y), int(m)
            if not (1 <= m_i <= 12):
                raise ValueError("mese fuori range")
            from calendar import monthrange
            last = monthrange(y_i, m_i)[1]
            date_from = f"{y_i:04d}-{m_i:02d}-01"
            date_to = f"{y_i:04d}-{m_i:02d}-{last:02d}"
        except Exception:
            raise HTTPException(400, "Parametro 'month' non valido (formato atteso: YYYY-MM)")

    try:
        entrate = await svc.list_receipts_all(date_from=date_from, date_to=date_to)
        uscite = await svc.list_exits(date_from=date_from, date_to=date_to)
    except Exception as e:
        raise HTTPException(502, f"Impossibile leggere inventario: {e}")
    items: List[Dict[str, Any]] = []
    for r in entrate:
        items.append({
            "id": r.get("id"), "type": "arrivo", "date": r.get("date"),
            "created_time": r.get("created_time"), "product": r.get("item_name"),
            "quantity": r.get("quantity"), "unit": r.get("unit") or "pz",
            "serial_or_code": r.get("sn") or "", "cliente": None, "taken_by": None,
        })
    for u in uscite:
        items.append({
            "id": u.get("id"), "type": "spedizione", "date": u.get("date"),
            "created_time": u.get("created_time"), "product": u.get("item_name"),
            "quantity": u.get("quantity"), "unit": u.get("unit") or "pz",
            "serial_or_code": u.get("sn") or "", "cliente": u.get("cliente"),
            "taken_by": u.get("taken_by"),
        })
    items.sort(key=lambda x: (x.get("date") or "", x.get("created_time") or ""), reverse=True)
    return {
        "items": items[:limit],
        "count": min(len(items), limit),
        "month": month,
        "date_from": date_from,
        "date_to": date_to,
    }


@api_router.get("/dashboard/kpi")
async def dashboard_kpi():
    """Aggregated KPIs — LIVE dalla sorgente attiva (Notion o Gestionale)."""
    svc = await _get_inv_svc(db)
    if not svc.is_configured():
        raise HTTPException(503, "Fonte inventario non configurata")
    try:
        items = await svc.list_inventory()
        entrate = await svc.list_receipts_all()
        uscite = await svc.list_exits()
    except Exception as e:
        raise HTTPException(502, f"Impossibile leggere inventario: {e}")

    for it in items:
        annotate_item(it)

    today = _today_rome_iso()
    total_products = len(items)
    total_units = sum(float(it.get("quantity") or 0) for it in items)
    arrivi_today = sum(1 for r in entrate if (r.get("date") or "") == today)
    spedizioni_today = sum(1 for u in uscite if (u.get("date") or "") == today)

    LOW_STOCK_THRESHOLD = 2
    sotto_scorta = [
        {
            "id": it["id"],
            "name": it["name"],
            "code": it.get("code"),
            "quantity": it.get("quantity") or 0,
            "unit": it.get("unit") or "pz",
        }
        for it in items
        if 0 < (float(it.get("quantity") or 0)) <= LOW_STOCK_THRESHOLD
    ]
    esauriti = [
        {
            "id": it["id"],
            "name": it["name"],
            "code": it.get("code"),
            "unit": it.get("unit") or "pz",
        }
        for it in items
        if (float(it.get("quantity") or 0)) <= 0
    ]

    non_configurati = [
        {"id": it["id"], "name": it["name"], "code": it.get("code")}
        for it in items
        if not it.get("configured")
    ]

    movements: List[Dict[str, Any]] = []
    for r in entrate:
        movements.append({
            "type": "arrivo",
            "date": r.get("date"),
            "created_time": r.get("created_time"),
            "product": r.get("item_name"),
            "quantity": r.get("quantity"),
            "unit": r.get("unit") or "pz",
            "serial_or_code": r.get("sn") or "",
        })
    for u in uscite:
        movements.append({
            "type": "spedizione",
            "date": u.get("date"),
            "created_time": u.get("created_time"),
            "product": u.get("item_name"),
            "quantity": u.get("quantity"),
            "unit": u.get("unit") or "pz",
            "serial_or_code": u.get("sn") or "",
            "cliente": u.get("cliente"),
        })
    movements.sort(
        key=lambda x: (x.get("date") or "", x.get("created_time") or ""),
        reverse=True,
    )

    return {
        "total_products": total_products,
        "total_units": total_units,
        "arrivi_today": arrivi_today,
        "spedizioni_today": spedizioni_today,
        "low_stock_threshold": LOW_STOCK_THRESHOLD,
        "sotto_scorta": sotto_scorta,
        "esauriti": esauriti,
        "non_configurati": non_configurati,
        "recent_movements": movements[:10],
        "refreshed_at": datetime.now(timezone.utc).isoformat(),
    }


@api_router.get("/checklist/history")
async def history(limit: int = 20):
    docs = await db.checklists.find({}, {"_id": 0}).sort("created_at", -1).to_list(limit)
    return {"items": docs}


# ---------- Arrivi (F2) ----------
def build_arrivo_email(payload: ArrivoPayload, tz_name: str = "Europe/Rome") -> str:
    esc = html_lib.escape
    filled = [i for i in payload.items if i.quantity > 0]
    rows_html = []
    for it in filled:
        serials_html = (
            "<ul style='margin:6px 0 0 18px;padding:0;font-family:Consolas,monospace;font-size:13px;color:#0f172a;'>"
            + "".join(f"<li>{esc(s)}</li>" for s in it.serials)
            + "</ul>"
            if it.serialized and it.serials
            else '<span style="color:#64748b;font-size:13px;">—</span>'
        )
        unit = it.unit or "pz"
        rows_html.append(
            f"<tr>"
            f'<td style="padding:12px 14px;border-bottom:1px solid #e2e8f0;font-family:Arial,sans-serif;font-size:14px;color:#0f172a;vertical-align:top;">{esc(it.name)}</td>'
            f'<td style="padding:12px 14px;border-bottom:1px solid #e2e8f0;font-family:Arial,sans-serif;font-size:14px;color:#0f172a;text-align:center;font-weight:700;vertical-align:top;width:110px;">{esc(str(_qty_fmt(it.quantity)))} {esc(unit)}</td>'
            f'<td style="padding:12px 14px;border-bottom:1px solid #e2e8f0;vertical-align:top;">{serials_html}</td>'
            f"</tr>"
        )
    table_body = "".join(rows_html) or (
        '<tr><td colspan="3" style="padding:20px;text-align:center;color:#64748b;">Nessun prodotto</td></tr>'
    )
    notes_block = (
        f'<div style="margin-top:20px;padding:14px;background:#dcfce7;border-left:4px solid #16a34a;'
        f'font-family:Arial,sans-serif;font-size:14px;color:#166534;">'
        f'<strong>Note:</strong> {esc(payload.notes)}</div>'
        if payload.notes and payload.notes.strip()
        else ""
    )
    # F8 fix: usa il fuso orario configurato in Admin → Impostazioni → Fuso orario
    # (default Europe/Rome). Prima era hardcoded UTC → l'operatore in Italia vedeva
    # l'ora indietro di 1-2h rispetto all'orologio reale. ZoneInfo gestisce auto DST.
    try:
        tz = ZoneInfo(tz_name)
    except Exception:
        tz = ROME_TZ
    now_it = datetime.now(timezone.utc).astimezone(tz).strftime("%H:%M")
    return f"""<!DOCTYPE html>
<html><head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;background:#f1f5f9;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f1f5f9;padding:24px 0;">
  <tr><td align="center">
    <table role="presentation" width="720" cellpadding="0" cellspacing="0" style="background:#ffffff;border:1px solid #e2e8f0;">
      <tr><td style="background:#065f46;padding:24px;">
        <div style="font-family:Arial,sans-serif;color:#a7f3d0;font-size:11px;letter-spacing:.2em;text-transform:uppercase;">Magazzino Elios Tech</div>
        <div style="font-family:Arial,sans-serif;color:#ffffff;font-size:22px;font-weight:700;margin-top:6px;">Arrivo registrato — magazzino aggiornato</div>
      </td></tr>
      <tr><td style="padding:24px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e2e8f0;">
          <tr><td style="padding:12px 14px;background:#f8fafc;font-family:Arial,sans-serif;font-size:12px;color:#64748b;text-transform:uppercase;letter-spacing:.08em;font-weight:700;width:35%;border-bottom:1px solid #e2e8f0;">Fornitore / Mittente</td>
              <td style="padding:12px 14px;font-family:Arial,sans-serif;font-size:15px;color:#0f172a;font-weight:700;border-bottom:1px solid #e2e8f0;">{esc(payload.fornitore)}</td></tr>
          <tr><td style="padding:12px 14px;background:#f8fafc;font-family:Arial,sans-serif;font-size:12px;color:#64748b;text-transform:uppercase;letter-spacing:.08em;font-weight:700;border-bottom:1px solid #e2e8f0;">Data Arrivo</td>
              <td style="padding:12px 14px;font-family:Arial,sans-serif;font-size:15px;color:#0f172a;font-weight:600;border-bottom:1px solid #e2e8f0;">{esc(payload.arrival_date)}</td></tr>
          <tr><td style="padding:12px 14px;background:#f8fafc;font-family:Arial,sans-serif;font-size:12px;color:#64748b;text-transform:uppercase;letter-spacing:.08em;font-weight:700;border-bottom:1px solid #e2e8f0;">Ora Registrazione</td>
              <td style="padding:12px 14px;font-family:Arial,sans-serif;font-size:15px;color:#0f172a;font-weight:600;border-bottom:1px solid #e2e8f0;">{esc(now_it)}</td></tr>
          <tr><td style="padding:12px 14px;background:#f8fafc;font-family:Arial,sans-serif;font-size:12px;color:#64748b;text-transform:uppercase;letter-spacing:.08em;font-weight:700;">Operatore</td>
              <td style="padding:12px 14px;font-family:Arial,sans-serif;font-size:15px;color:#0f172a;font-weight:600;">{esc(payload.operator)}</td></tr>
        </table>
        <div style="font-family:Arial,sans-serif;font-size:13px;color:#64748b;text-transform:uppercase;letter-spacing:.1em;font-weight:700;margin:24px 0 10px;">Materiali in Ingresso</div>
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e2e8f0;">
          <thead><tr>
            <th align="left" style="padding:10px 14px;background:#f8fafc;font-family:Arial,sans-serif;font-size:12px;color:#64748b;text-transform:uppercase;letter-spacing:.08em;border-bottom:1px solid #e2e8f0;">Materiale</th>
            <th align="center" style="padding:10px 14px;background:#f8fafc;font-family:Arial,sans-serif;font-size:12px;color:#64748b;text-transform:uppercase;letter-spacing:.08em;border-bottom:1px solid #e2e8f0;">Q.tà</th>
            <th align="left" style="padding:10px 14px;background:#f8fafc;font-family:Arial,sans-serif;font-size:12px;color:#64748b;text-transform:uppercase;letter-spacing:.08em;border-bottom:1px solid #e2e8f0;">Seriali S/N</th>
          </tr></thead>
          <tbody>{table_body}</tbody>
        </table>
        {notes_block}
        <div style="font-family:Arial,sans-serif;font-size:12px;color:#94a3b8;margin-top:24px;border-top:1px solid #e2e8f0;padding-top:14px;">
          Magazzino Notion aggiornato automaticamente. Email generata da Magazzino Elios Tech.
        </div>
      </td></tr>
    </table>
  </td></tr>
</table>
</body></html>"""


def validate_arrivo_basic(payload: ArrivoPayload) -> None:
    if not payload.operator.strip():
        raise HTTPException(400, "Nome operatore obbligatorio")
    if not payload.fornitore.strip():
        raise HTTPException(400, "Fornitore / Mittente obbligatorio")
    if not payload.arrival_date.strip():
        raise HTTPException(400, "Data arrivo obbligatoria")
    filled = [i for i in payload.items if i.quantity > 0]
    if not filled:
        raise HTTPException(400, "Aggiungi almeno un prodotto")
    for item in filled:
        if item.serialized:
            expected = int(item.quantity)
            serials = [s.strip() for s in item.serials]
            if len(serials) != expected or any(not s for s in serials):
                raise HTTPException(400, f"Seriali mancanti per {item.name}")


@api_router.post("/arrivi/send")
async def submit_arrivo(
    payload: ArrivoPayload,
    current_user: Dict[str, Any] = Depends(dep_current_user),
):
    payload.operator = f"{current_user.get('first_name','')} {current_user.get('last_name','')}".strip() or current_user.get("username") or ""
    validate_arrivo_basic(payload)
    svc = await _get_inv_svc(db)
    if not svc.is_configured():
        raise HTTPException(503, "Fonte inventario non configurata")

    filled = [i for i in payload.items if i.quantity > 0]

    # F5: BLOCK if any product has no `Tipo gestione` configured on Notion.
    fresh_arr: Dict[str, Dict[str, Any]] = {}
    for it in filled:
        try:
            fresh_arr[it.page_id] = await svc.get_item(it.page_id)
        except Exception as e:
            raise HTTPException(502, f"Impossibile leggere inventario ({it.name}): {e}")
    not_configured = [
        fresh_arr[it.page_id].get("name") or it.name
        for it in filled
        if fresh_arr[it.page_id].get("tipo_gestione") not in ("a_seriale", "a_quantita")
    ]
    if not_configured:
        await log_anomaly(
            kind="tipo_gestione_missing",
            description=f"Prodotti senza Tipo Gestione: {', '.join(not_configured)}",
            operator=payload.operator,
            product=", ".join(not_configured),
            source="arrivo",
        )
        raise HTTPException(
            400,
            "TIPO DI GESTIONE NON CONFIGURATO su Notion per: "
            + ", ".join(not_configured)
            + ". Configurarlo dall'Admin prima di procedere.",
        )

    # 1) STRICT SERIAL VALIDATION for serialized items (LIVE — LATEST-MOVEMENT rule):
    #      unseen         → OK (nuovo seriale)
    #      last = uscita  → OK (rientro valido)
    #      last = entrata → BLOCK (già in magazzino)
    #      duplicate in payload → BLOCK
    serial_errors: List[str] = []
    seen: set = set()
    for it in filled:
        if not it.serialized:
            continue
        for sn in (it.serials or []):
            sn_c = (sn or "").strip()
            if not sn_c:
                continue
            key = sn_c.lower()
            if key in seen:
                serial_errors.append(f"{it.name} — SN {sn_c} inserito più volte")
                continue
            seen.add(key)
            try:
                st = await svc.latest_serial_status(sn_c)
            except Exception as e:
                raise HTTPException(502, f"Errore verifica stato seriale: {e}")
            if st["status"] == "in_warehouse":
                last = st.get("last") or {}
                serial_errors.append(
                    f"{it.name} — SN {sn_c} già presente in magazzino"
                    + (f" (entrato il {last.get('date')})" if last.get("date") else "")
                )
    if serial_errors:
        await log_anomaly(
            kind="arrivo_blocked_serials",
            description=" • ".join(serial_errors),
            operator=payload.operator,
            product=", ".join({i.name for i in filled if i.serialized}) or None,
            serial_or_code=", ".join({s for i in filled if i.serialized for s in (i.serials or [])})[:400] or None,
            source="arrivo",
        )
        raise HTTPException(409, "Impossibile confermare l'arrivo. " + " • ".join(serial_errors))

    # 2) Create Receipts rows. Notion rollup on Inventario updates stock automatically.
    receipts_ids: List[str] = []
    try:
        for it in filled:
            # STRICT Notion mapping (Prompt 220 §11):
            #   Item (title) = SOLO seriale (o nome prodotto per A Quantità — MAI concatenato)
            if it.serialized and it.serials:
                for s in it.serials:
                    pid = await svc.create_receipt(
                        item_page_id=it.page_id,
                        sn_title=s.strip(),
                        quantity=1,
                        data_consegna=payload.arrival_date,
                    )
                    receipts_ids.append(pid)
            else:
                # A Quantità: nessun seriale → title = SOLO nome prodotto (nessuna concatenazione)
                pid = await svc.create_receipt(
                    item_page_id=it.page_id,
                    sn_title=it.name,
                    quantity=it.quantity,
                    data_consegna=payload.arrival_date,
                )
                receipts_ids.append(pid)
    except Exception as e:
        for pid in receipts_ids:
            await svc.archive_page(pid)
        raise HTTPException(502, f"Impossibile registrare l'arrivo. Riprova. ({e})")

    # 3) Invalidate cached inventory so subsequent reads show updated stock
    svc.invalidate_inventory_cache()

    # 3.1) F8 §3+§13: aggiorna la colonna 16 "SN /codice" dell'Inventario Notion
    # aggiungendo i seriali appena registrati per i prodotti A Seriale.
    # No-op quando fonte=gestionale (i seriali sono già in product_serials).
    try:
        for it in filled:
            if it.serialized and it.serials:
                await svc.update_inventory_serials(it.page_id, [s.strip() for s in it.serials if s and s.strip()])
    except Exception as e:
        logging.warning(f"update_inventory_serials fallito (non blocca l'arrivo): {e}")

    # 4) Email
    # F9 §28: filtra per evento "arrivi"
    recipients = await get_recipients_for_event("arrivi")
    # F8 fix: passa il fuso configurato all'email builder così l'orario di registrazione
    # riflette l'ora reale del fuso Admin (non più UTC).
    _settings = await admin_extra_routes.get_app_settings(db)
    _tz_name = ((_settings.get("general") or {}).get("timezone")) or "Europe/Rome"
    html_content = build_arrivo_email(payload, tz_name=_tz_name)
    subject = f"Arrivo — {payload.fornitore} — {payload.arrival_date}"
    sent = []
    errors = []
    for r in recipients:
        try:
            eid = await send_email(r, subject, html_content)
            sent.append({"recipient": r, "id": eid})
        except Exception as e:
            logging.error(f"Email send error for {r}: {e}")
            errors.append({"recipient": r, "error": str(e)})

    # 5) Persist to Mongo history
    record = ArrivoRecord(
        operator=payload.operator,
        arrival_date=payload.arrival_date,
        fornitore=payload.fornitore,
        items=filled,
        notes=payload.notes,
        recipients=[s["recipient"] for s in sent],
        receipts_page_ids=receipts_ids,
        status="completed",
    )
    await db.arrivi.insert_one(record.model_dump())

    return {
        "status": "success",
        "message": f"Arrivo registrato. Magazzino aggiornato ({len(filled)} prodotti, {int(sum(i.quantity for i in filled))} pz).",
        "sent": sent,
        "errors": errors,
        "arrivo_id": record.id,
    }


# ---------- Admin ----------
@api_router.post("/admin/login")
async def admin_login(req: LoginRequest):
    if req.password != ADMIN_PASSWORD:
        raise HTTPException(401, "Password non valida")
    return {"status": "ok"}


@api_router.get("/admin/inventory", dependencies=[Depends(dep_require_admin)])
async def admin_inventory():
    svc = await _get_inv_svc(db)
    if not svc.is_configured():
        raise HTTPException(503, "Fonte inventario non configurata")
    items = await svc.list_inventory(force_refresh=True)
    for it in items:
        annotate_item(it)
    return {"items": items, "source": await _get_inv_source(db)}


class TipoGestioneUpdate(BaseModel):
    page_id: str
    tipo_gestione: str  # 'a_seriale' | 'a_quantita'


@api_router.put("/admin/inventory/tipo-gestione", dependencies=[Depends(dep_require_admin)])
async def admin_set_tipo_gestione(update: TipoGestioneUpdate):
    """Update `Tipo gestione` DIRECTLY (Notion o DB locale a seconda della sorgente)."""
    if update.tipo_gestione not in ("a_seriale", "a_quantita"):
        raise HTTPException(400, "tipo_gestione deve essere 'a_seriale' o 'a_quantita'")
    svc = await _get_inv_svc(db)
    try:
        await svc.update_tipo_gestione(update.page_id, update.tipo_gestione)
    except httpx.HTTPStatusError as e:
        raise HTTPException(502, f"HTTP {e.response.status_code}: {e.response.text[:200]}")
    except Exception as e:
        raise HTTPException(502, f"Impossibile aggiornare: {e}")
    return {"status": "ok", "page_id": update.page_id, "tipo_gestione": update.tipo_gestione}


@api_router.put("/admin/inventory/serial", dependencies=[Depends(dep_require_admin)])
async def admin_set_serial(update: SerialOverrideUpdate):
    """DEPRECATED — proxies to Tipo gestione sulla sorgente attiva."""
    tipo = "a_seriale" if update.serialized else "a_quantita"
    svc = await _get_inv_svc(db)
    try:
        await svc.update_tipo_gestione(update.page_id, tipo)
    except Exception as e:
        raise HTTPException(502, f"Impossibile aggiornare: {e}")
    return {"status": "ok"}


@api_router.get("/admin/recipients", dependencies=[Depends(dep_require_admin)])
async def admin_get_recipients():
    full = await get_recipients_full()
    return {
        # Nuovo formato — usato dalla UI Admin.
        "items": full,
        # Retro-compat con eventuali client vecchi: solo email attive.
        "emails": [r["email"] for r in full if r.get("enabled", True)],
    }


@api_router.put("/admin/recipients", dependencies=[Depends(dep_require_admin)])
async def admin_put_recipients(update: RecipientsUpdate):
    # Nuovo formato items ha priorità; se assente, fallback su emails (retro-compat).
    if update.items is not None:
        cleaned: List[Dict[str, Any]] = []
        seen = set()
        for it in update.items:
            e = str(it.email).strip().lower()
            if not e or e in seen:
                continue
            seen.add(e)
            ev_in = it.events.model_dump() if it.events is not None else DEFAULT_EVENTS
            events = {ev: bool(ev_in.get(ev, True)) for ev in NOTIFICATION_EVENTS}
            cleaned.append({"email": e, "enabled": bool(it.enabled), "events": events})
        if not cleaned:
            raise HTTPException(400, "Inserisci almeno un destinatario")
        await set_recipients_full(cleaned)
        return {"status": "ok", "items": cleaned}
    # Legacy path
    emails_in = update.emails or []
    emails = [str(e).strip().lower() for e in emails_in if str(e).strip()]
    if not emails:
        raise HTTPException(400, "Inserisci almeno un destinatario")
    unique = list(dict.fromkeys(emails))
    await set_recipients(unique)
    return {"status": "ok", "emails": unique}


@api_router.get("/admin/history", dependencies=[Depends(dep_require_admin)])
async def admin_history(
    limit: int = 500,
    cliente: Optional[str] = None,
    materiale: Optional[str] = None,
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
):
    q: Dict[str, Any] = {}
    if cliente and cliente.strip():
        q["structure"] = {"$regex": cliente.strip(), "$options": "i"}
    if materiale and materiale.strip():
        q["items"] = {"$elemMatch": {"name": {"$regex": materiale.strip(), "$options": "i"}}}
    if date_from or date_to:
        d: Dict[str, str] = {}
        if date_from:
            d["$gte"] = date_from
        if date_to:
            d["$lte"] = date_to
        q["shipping_date"] = d
    docs = await db.checklists.find(q, {"_id": 0}).sort("created_at", -1).to_list(limit)
    return {"items": docs, "count": len(docs)}


@api_router.delete("/admin/history", dependencies=[Depends(dep_require_admin)])
async def admin_history_clear(admin=Depends(dep_require_admin)):
    """Elimina TUTTE le spedizioni salvate localmente (db.checklists).
    ATTENZIONE: NON tocca Notion — che rimane la fonte di verità storica.
    Solo Admin. Registrato in audit_logs.
    """
    res = await db.checklists.delete_many({})
    await db.audit_logs.insert_one({
        "at": datetime.now(timezone.utc),
        "actor_id": str(admin["_id"]),
        "actor_username": admin.get("username"),
        "action": "history.clear_all",
        "target_user_id": None,
        "meta": {"deleted": int(res.deleted_count)},
    })
    return {"ok": True, "deleted": int(res.deleted_count)}


@api_router.get("/settings", dependencies=[Depends(dep_current_user)])
async def get_settings_public():
    """Impostazioni app leggibili da qualsiasi utente autenticato.
    Serve al client (es. beep scanner, live search) per adattare la UI.
    Le modifiche restano riservate agli Admin via PUT /admin/settings.
    """
    from routes.admin_extra_routes import get_app_settings
    return await get_app_settings(db)


@api_router.get("/time")
async def get_server_time():
    """Ritorna l'ora del server nel tz configurato (Admin → Impostazioni → Fuso orario).
    Il frontend usa questo endpoint per non dipendere dall'orologio locale.
    """
    from routes.admin_extra_routes import get_app_settings
    settings = await get_app_settings(db)
    tz_name = (settings.get("general") or {}).get("timezone") or "Europe/Rome"
    try:
        tz = ZoneInfo(tz_name)
    except Exception:
        tz_name = "Europe/Rome"
        tz = ROME_TZ
    now_utc = datetime.now(timezone.utc)
    now_local = now_utc.astimezone(tz)
    return {
        "tz": tz_name,
        "utc_iso": now_utc.isoformat(),
        "local_iso": now_local.isoformat(),
        "local_date": now_local.date().isoformat(),
        "local_datetime": now_local.strftime("%Y-%m-%d %H:%M:%S"),
    }


@api_router.get("/admin/notion-exits", dependencies=[Depends(dep_require_admin)])
async def admin_notion_exits(
    cliente: Optional[str] = None,
    materiale: Optional[str] = None,
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
):
    if not notion_service.is_configured():
        raise HTTPException(503, "Integrazione Notion non configurata")
    try:
        exits = await notion_service.list_exits()
    except Exception as e:
        raise HTTPException(502, f"Impossibile leggere Notion Tracker: {e}")

    # Which tracker page_ids were created by our app? Exclude to avoid duplicates.
    docs = await db.checklists.find({}, {"_id": 0, "tracker_page_ids": 1}).to_list(2000)
    internal_ids = set()
    for d in docs:
        for pid in (d.get("tracker_page_ids") or []):
            if pid:
                internal_ids.add(pid)

    def _match(ex: Dict[str, Any]) -> bool:
        if ex["id"] in internal_ids:
            return False
        if cliente and cliente.strip():
            if cliente.strip().lower() not in (ex.get("cliente") or "").lower():
                return False
        if materiale and materiale.strip():
            names = " | ".join(ex.get("item_names") or []).lower()
            if materiale.strip().lower() not in names:
                return False
        d = ex.get("date") or ""
        if date_from and d < date_from:
            return False
        if date_to and d > date_to:
            return False
        return True

    filtered = [e for e in exits if _match(e)]
    return {"items": filtered, "count": len(filtered)}


app.include_router(api_router)

# Auth + Admin user routers (Phase 2 — Prompt 220)
app.include_router(auth_routes.build_router(db, auth_deps, send_email_fn=send_email, frontend_base_url=os.environ.get("PUBLIC_FRONTEND_URL") or os.environ.get("REACT_APP_BACKEND_URL", "")), prefix="/api")
app.include_router(admin_users_routes.build_router(db, auth_deps), prefix="/api")
app.include_router(admin_extra_routes.build_router(db, auth_deps), prefix="/api")


@app.on_event("startup")
async def _phase2_startup_indexes():
    try:
        await db.users.create_index("username", unique=True)
        await db.audit_logs.create_index([("at", -1)])
        # Inventory Gestionale (fonte alternativa a Notion)
        inventory_local.set_db(db)
        await db.products.create_index("id", unique=True)
        await db.products.create_index("code")
        await db.product_serials.create_index([("product_id", 1), ("serial_lower", 1)], unique=True)
        await db.product_serials.create_index("serial_lower")
        await db.local_receipts.create_index([("data_consegna", -1)])
        await db.local_picks.create_index([("data_uscita", -1)])
    except Exception as e:
        logging.error(f"MongoDB index creation failed: {e}")

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=os.environ.get('CORS_ORIGINS', '*').split(','),
    allow_methods=["*"],
    allow_headers=["*"],
)

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)


@app.on_event("shutdown")
async def shutdown_db_client():
    client.close()
