"""F18 (26/02/2026) — Registro Log applicativo strutturato.

Persistenza: MongoDB collection `app_events` (separata da `audit_logs` così che
CANCELLAZIONE_MASSIVA del Registro Attività NON tocchi questi log).

Non altera nessun altro flusso. È chiamato in modo best-effort: se il logging
fallisce, l'operazione principale (spedizione/arrivo/…) non viene bloccata.

Livelli: DEBUG | INFO | WARNING | ERROR | CRITICAL
Categorie: INVENTARIO | ARRIVO | SPEDIZIONE | CANCELLAZIONE | ANOMALIA | NOTION | AUTH | ERRORE | RETRO
Status: SUCCESS | FAILURE | WARNING | PARTIAL

Ogni evento supporta un `operation_id` (correlation id) per raggruppare più
eventi che fanno parte della stessa operazione.
"""
from __future__ import annotations

import logging
import re
import uuid
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

_logger = logging.getLogger(__name__)

# Regex di redazione segreti (password/token/api_key/authorization/cookie/bearer)
_SECRET_RE = re.compile(
    r'(password|passwd|pwd|token|api[_-]?key|secret|authorization|cookie|bearer)\s*[:=]\s*["\']?([^"\'\s,;}]+)',
    re.IGNORECASE,
)
# Chiavi vietate dentro dict `details`
_FORBIDDEN_KEYS = {
    "password", "passwd", "pwd", "token", "api_key", "apikey",
    "authorization", "cookie", "secret", "bearer", "jwt", "hash",
    "password_hash",
}


def _redact_string(s: Any) -> Any:
    if not isinstance(s, str):
        return s
    return _SECRET_RE.sub(lambda m: f'{m.group(1)}=***REDACTED***', s)


def _redact_details(obj: Any, depth: int = 0) -> Any:
    """Redazione ricorsiva di dict/list/str. Max 5 livelli per sicurezza."""
    if depth > 5:
        return "…"
    if isinstance(obj, dict):
        return {
            k: ("***REDACTED***" if k.lower() in _FORBIDDEN_KEYS else _redact_details(v, depth + 1))
            for k, v in obj.items()
        }
    if isinstance(obj, list):
        return [_redact_details(v, depth + 1) for v in obj[:200]]
    if isinstance(obj, str):
        return _redact_string(obj)
    return obj


def new_operation_id(prefix: str = "OP") -> str:
    """Genera un correlation id human-readable: OP-YYYYMMDD-<8chars>."""
    day = datetime.now(timezone.utc).strftime("%Y%m%d")
    return f"{prefix}-{day}-{uuid.uuid4().hex[:8].upper()}"


async def log_event(
    db,
    *,
    category: str,
    event_type: str,
    action: str,
    level: str = "INFO",
    status: str = "SUCCESS",
    message: Optional[str] = None,
    user: Optional[str] = None,
    user_role: Optional[str] = None,
    resource: Optional[str] = None,
    product: Optional[str] = None,
    product_code: Optional[str] = None,
    serial: Optional[str] = None,
    serials: Optional[List[str]] = None,
    quantity_before: Optional[float] = None,
    quantity_change: Optional[float] = None,
    quantity_after: Optional[float] = None,
    customer: Optional[str] = None,
    taken_by: Optional[str] = None,
    operation_id: Optional[str] = None,
    endpoint: Optional[str] = None,
    stack_trace: Optional[str] = None,
    details: Optional[Dict[str, Any]] = None,
) -> Optional[str]:
    """Persiste un evento applicativo strutturato in `db.app_events`.
    Non solleva mai eccezioni: se il salvataggio fallisce, logga a WARNING e ritorna None.
    """
    try:
        now = datetime.now(timezone.utc)
        doc = {
            "id": str(uuid.uuid4()),
            "timestamp": now.isoformat(),
            "created_at": now,
            "level": (level or "INFO").upper(),
            "category": (category or "INVENTARIO").upper(),
            "event_type": (event_type or "").upper(),
            "action": action or "",
            "status": (status or "SUCCESS").upper(),
            "message": _redact_string(message) if message else "",
            "user": user or None,
            "user_role": user_role or None,
            "resource": resource,
            "product": product,
            "product_code": product_code,
            "serial": serial,
            "serials": (serials or None),
            "quantity_before": quantity_before,
            "quantity_change": quantity_change,
            "quantity_after": quantity_after,
            "customer": customer,
            "taken_by": taken_by,
            "operation_id": operation_id or new_operation_id(),
            "endpoint": endpoint,
            "stack_trace": _redact_string(stack_trace) if stack_trace else None,
            "details": _redact_details(details) if details else None,
            "source": "app",
        }
        await db.app_events.insert_one(doc)
        return doc["id"]
    except Exception as e:  # pragma: no cover — logging must never break the request
        _logger.warning(f"event_logger.log_event failed: {e}")
        return None


async def ensure_indexes(db) -> None:
    """Crea gli indici richiesti per query performanti. Idempotente."""
    try:
        await db.app_events.create_index([("created_at", -1)])
        await db.app_events.create_index([("category", 1), ("created_at", -1)])
        await db.app_events.create_index([("event_type", 1), ("created_at", -1)])
        await db.app_events.create_index([("operation_id", 1)])
        await db.app_events.create_index([("user", 1), ("created_at", -1)])
        await db.app_events.create_index([("serial", 1)])
        await db.app_events.create_index([("product_code", 1)])
        await db.app_events.create_index([("level", 1), ("created_at", -1)])
        await db.app_events.create_index([("status", 1), ("created_at", -1)])
    except Exception as e:  # pragma: no cover
        _logger.warning(f"event_logger.ensure_indexes failed: {e}")
