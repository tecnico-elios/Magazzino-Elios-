from fastapi import FastAPI, APIRouter, HTTPException
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
import os
import logging
import uuid
import html as html_lib
from pathlib import Path
from pydantic import BaseModel, Field, ConfigDict
from typing import List, Optional
from datetime import datetime, timezone
import httpx

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

# MongoDB connection
mongo_url = os.environ['MONGO_URL']
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ['DB_NAME']]

# Emergent managed email proxy — constant on purpose (survives deploy)
EMAIL_BASE_URL = "https://integrations.emergentagent.com"
EMAIL_KEY = os.environ["EMERGENT_EMAIL_KEY"]
EMAIL_FROM_NAME = os.environ["EMAIL_FROM_NAME"]

# Recipient list (comma-separated in .env)
DEFAULT_RECIPIENTS = [
    r.strip()
    for r in os.environ.get("CHECKLIST_RECIPIENTS", "tecnico@eliostech.org").split(",")
    if r.strip()
]

# Products catalog (source of truth also on backend for server-side validation)
CATEGORIES = {
    "cat1": {
        "name": "Wallbox e Daze",
        "requires_serial": True,
        "products": [
            "Wallbox 7,4 kW - cavo 5 mt",
            "Wallbox 22 kW - cavo 5 mt",
            "Wallbox 22 kW - cavo 7 mt",
            "Daze Duo 44 kW",
        ],
    },
    "cat2": {
        "name": "Meter e Misuratori",
        "requires_serial": True,
        "products": ["Meter Monofase", "Meter Trifase", "Meter Daze"],
    },
    "cat3": {
        "name": "Accessori e Supporti",
        "requires_serial": False,
        "products": [
            "Portacavo Pro Wallbox",
            "Portacavo Daze",
            "Stand Wallbox Single",
            "Stand Wallbox Dual",
            "Stand Daze Single",
        ],
    },
}

app = FastAPI()
api_router = APIRouter(prefix="/api")


# ------------- Models -------------
class ProductItem(BaseModel):
    model_config = ConfigDict(extra="ignore")
    category: str  # cat1 | cat2 | cat3
    name: str
    quantity: int = 0
    serials: List[str] = Field(default_factory=list)


class ChecklistPayload(BaseModel):
    operator: str
    shipping_date: str  # ISO date YYYY-MM-DD
    structure: str
    items: List[ProductItem]
    notes: Optional[str] = None


class ChecklistRecord(BaseModel):
    model_config = ConfigDict(extra="ignore")
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    operator: str
    shipping_date: str
    structure: str
    items: List[ProductItem]
    notes: Optional[str] = None
    recipients: List[str] = Field(default_factory=list)
    created_at: str = Field(default_factory=lambda: datetime.now(timezone.utc).isoformat())


# ------------- Helpers -------------
def validate_checklist(payload: ChecklistPayload) -> None:
    if not payload.operator.strip():
        raise HTTPException(400, "Nome operatore obbligatorio")
    if not payload.structure.strip():
        raise HTTPException(400, "Struttura obbligatoria")
    if not payload.shipping_date.strip():
        raise HTTPException(400, "Data spedizione obbligatoria")

    filled = [i for i in payload.items if i.quantity > 0]
    if not filled:
        raise HTTPException(400, "Inserisci almeno un prodotto con quantità maggiore di zero")

    for item in filled:
        cat = CATEGORIES.get(item.category)
        if not cat:
            raise HTTPException(400, f"Categoria non valida: {item.category}")
        if item.name not in cat["products"]:
            raise HTTPException(400, f"Prodotto non valido: {item.name}")
        if cat["requires_serial"]:
            serials = [s.strip() for s in item.serials]
            if len(serials) != item.quantity or any(not s for s in serials):
                raise HTTPException(
                    400,
                    f"Seriali mancanti per {item.name} (attesi {item.quantity})",
                )


def build_html_email(payload: ChecklistPayload) -> str:
    esc = html_lib.escape
    rows = []
    for cat_key, cat in CATEGORIES.items():
        cat_items = [i for i in payload.items if i.category == cat_key and i.quantity > 0]
        if not cat_items:
            continue
        rows.append(
            f'<tr><td colspan="3" style="background:#0f172a;color:#fff;padding:10px 14px;'
            f'font-family:Arial,sans-serif;font-size:13px;letter-spacing:.08em;'
            f'text-transform:uppercase;font-weight:700;">{esc(cat["name"])}</td></tr>'
        )
        for it in cat_items:
            serials_html = (
                "<ul style='margin:6px 0 0 18px;padding:0;font-family:Consolas,monospace;font-size:13px;color:#0f172a;'>"
                + "".join(f"<li>{esc(s)}</li>" for s in it.serials)
                + "</ul>"
                if cat["requires_serial"]
                else '<span style="color:#64748b;font-size:13px;">—</span>'
            )
            rows.append(
                f'<tr>'
                f'<td style="padding:12px 14px;border-bottom:1px solid #e2e8f0;font-family:Arial,sans-serif;font-size:14px;color:#0f172a;vertical-align:top;">{esc(it.name)}</td>'
                f'<td style="padding:12px 14px;border-bottom:1px solid #e2e8f0;font-family:Arial,sans-serif;font-size:14px;color:#0f172a;text-align:center;font-weight:700;vertical-align:top;width:80px;">{it.quantity}</td>'
                f'<td style="padding:12px 14px;border-bottom:1px solid #e2e8f0;vertical-align:top;">{serials_html}</td>'
                f'</tr>'
            )

    table_body = "".join(rows) or (
        '<tr><td colspan="3" style="padding:20px;text-align:center;color:#64748b;font-family:Arial,sans-serif;">Nessun prodotto</td></tr>'
    )

    notes_block = (
        f'<tr><td style="padding:14px;background:#fef3c7;border-left:4px solid #f59e0b;'
        f'font-family:Arial,sans-serif;font-size:14px;color:#78350f;">'
        f'<strong>Note:</strong> {esc(payload.notes)}</td></tr>'
        if payload.notes and payload.notes.strip()
        else ""
    )

    return f"""<!DOCTYPE html>
<html><head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;background:#f1f5f9;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f1f5f9;padding:24px 0;">
  <tr><td align="center">
    <table role="presentation" width="640" cellpadding="0" cellspacing="0" style="background:#ffffff;border:1px solid #e2e8f0;">
      <tr><td style="background:#0f172a;padding:24px;">
        <div style="font-family:Arial,sans-serif;color:#94a3b8;font-size:11px;letter-spacing:.2em;text-transform:uppercase;">Checklist Spedizione</div>
        <div style="font-family:Arial,sans-serif;color:#ffffff;font-size:22px;font-weight:700;margin-top:6px;">Nuova spedizione dal magazzino</div>
      </td></tr>
      <tr><td style="padding:24px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e2e8f0;">
          <tr>
            <td style="padding:12px 14px;background:#f8fafc;font-family:Arial,sans-serif;font-size:12px;color:#64748b;text-transform:uppercase;letter-spacing:.08em;font-weight:700;width:38%;border-bottom:1px solid #e2e8f0;">Operatore</td>
            <td style="padding:12px 14px;font-family:Arial,sans-serif;font-size:15px;color:#0f172a;font-weight:600;border-bottom:1px solid #e2e8f0;">{esc(payload.operator)}</td>
          </tr>
          <tr>
            <td style="padding:12px 14px;background:#f8fafc;font-family:Arial,sans-serif;font-size:12px;color:#64748b;text-transform:uppercase;letter-spacing:.08em;font-weight:700;border-bottom:1px solid #e2e8f0;">Data Spedizione</td>
            <td style="padding:12px 14px;font-family:Arial,sans-serif;font-size:15px;color:#0f172a;font-weight:600;border-bottom:1px solid #e2e8f0;">{esc(payload.shipping_date)}</td>
          </tr>
          <tr>
            <td style="padding:12px 14px;background:#f8fafc;font-family:Arial,sans-serif;font-size:12px;color:#64748b;text-transform:uppercase;letter-spacing:.08em;font-weight:700;">Struttura Destinazione</td>
            <td style="padding:12px 14px;font-family:Arial,sans-serif;font-size:15px;color:#0f172a;font-weight:600;">{esc(payload.structure)}</td>
          </tr>
        </table>

        <div style="font-family:Arial,sans-serif;font-size:13px;color:#64748b;text-transform:uppercase;letter-spacing:.1em;font-weight:700;margin:24px 0 10px;">Prodotti Spediti</div>
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e2e8f0;">
          <thead>
            <tr>
              <th align="left" style="padding:10px 14px;background:#f8fafc;font-family:Arial,sans-serif;font-size:12px;color:#64748b;text-transform:uppercase;letter-spacing:.08em;border-bottom:1px solid #e2e8f0;">Prodotto</th>
              <th align="center" style="padding:10px 14px;background:#f8fafc;font-family:Arial,sans-serif;font-size:12px;color:#64748b;text-transform:uppercase;letter-spacing:.08em;border-bottom:1px solid #e2e8f0;width:80px;">Q.tà</th>
              <th align="left" style="padding:10px 14px;background:#f8fafc;font-family:Arial,sans-serif;font-size:12px;color:#64748b;text-transform:uppercase;letter-spacing:.08em;border-bottom:1px solid #e2e8f0;">Seriali S/N</th>
            </tr>
          </thead>
          <tbody>{table_body}</tbody>
        </table>

        {'<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:20px;">' + notes_block + '</table>' if notes_block else ''}

        <div style="font-family:Arial,sans-serif;font-size:12px;color:#94a3b8;margin-top:24px;border-top:1px solid #e2e8f0;padding-top:14px;">
          Email generata automaticamente dalla checklist di magazzino.
        </div>
      </td></tr>
    </table>
  </td></tr>
</table>
</body></html>"""


async def send_email(recipient: str, subject: str, html_content: str) -> Optional[str]:
    payload = {
        "to": [recipient],
        "subject": subject,
        "html": html_content,
        "from_name": EMAIL_FROM_NAME,
    }
    async with httpx.AsyncClient(timeout=30) as http_client:
        resp = await http_client.post(
            f"{EMAIL_BASE_URL}/api/v1/email/send",
            headers={"X-Email-Key": EMAIL_KEY},
            json=payload,
        )
    resp.raise_for_status()
    try:
        return resp.json().get("id")
    except Exception:
        return None


# ------------- Routes -------------
@api_router.get("/")
async def root():
    return {"status": "ok", "service": "Checklist Magazzino"}


@api_router.get("/catalog")
async def get_catalog():
    return {"categories": CATEGORIES, "recipients": DEFAULT_RECIPIENTS}


@api_router.post("/checklist/send")
async def submit_checklist(payload: ChecklistPayload):
    validate_checklist(payload)
    html_content = build_html_email(payload)
    subject = f"Checklist Spedizione — {payload.structure} — {payload.shipping_date}"

    sent_ids = []
    errors = []
    for r in DEFAULT_RECIPIENTS:
        try:
            eid = await send_email(r, subject, html_content)
            sent_ids.append({"recipient": r, "id": eid})
        except httpx.HTTPStatusError as e:
            logging.error(f"Email send failed for {r}: {e.response.status_code} {e.response.text}")
            errors.append({"recipient": r, "error": f"HTTP {e.response.status_code}"})
        except Exception as e:
            logging.error(f"Email send error for {r}: {e}")
            errors.append({"recipient": r, "error": str(e)})

    if not sent_ids:
        raise HTTPException(502, f"Invio email fallito: {errors}")

    # Persist record
    record = ChecklistRecord(
        operator=payload.operator,
        shipping_date=payload.shipping_date,
        structure=payload.structure,
        items=[i for i in payload.items if i.quantity > 0],
        notes=payload.notes,
        recipients=[s["recipient"] for s in sent_ids],
    )
    doc = record.model_dump()
    await db.checklists.insert_one(doc)

    return {
        "status": "success",
        "message": f"Checklist inviata a {len(sent_ids)} destinatario/i",
        "sent": sent_ids,
        "errors": errors,
        "checklist_id": record.id,
    }


@api_router.get("/checklist/history")
async def history(limit: int = 20):
    docs = await db.checklists.find({}, {"_id": 0}).sort("created_at", -1).to_list(limit)
    return {"items": docs}


app.include_router(api_router)

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
