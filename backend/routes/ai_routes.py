"""F20 (26/02/2026) — Endpoints Assistente AI.

- POST /api/ai/chat            — invia messaggio → LLM → tool-use loop → risposta
- GET  /api/ai/status          — stato AI (abilitato, quota rimanente, modalità)
- GET  /api/ai/settings        — settings (Admin)
- PUT  /api/ai/settings        — aggiorna settings (Admin)
- POST /api/ai/execute/{pid}   — esegue una pending operation dopo conferma utente
- POST /api/ai/pending/{pid}/cancel — annulla una pending operation

L'AI usa Groq (o altro provider configurato via env). Chiavi mai al frontend.
"""
from __future__ import annotations

import json
import os
import logging
from datetime import datetime, timezone, timedelta
from typing import Any, Dict, List, Optional

import httpx
from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import BaseModel, ConfigDict, Field

import auth as auth_mod
import event_logger
from ai_provider import get_ai_provider, AIProviderError
from ai_tools import TOOLS_SCHEMA, dispatch_tool

logger = logging.getLogger(__name__)


DEFAULT_AI_SETTINGS = {
    "enabled": False,
    "mode": "consultation",  # consultation | operational | full_operational
    "confirm_before_modify": True,
    "auto_execute": False,   # solo se mode=full_operational
    "daily_limit": 20,
    "provider": None,        # info-only, mostrato in Admin
    "model": None,
}


class ChatBody(BaseModel):
    model_config = ConfigDict(extra="ignore")
    message: str = Field(min_length=1, max_length=4000)
    session_id: Optional[str] = None
    context_section: Optional[str] = None  # inventario|arrivi|spedizioni|movimenti|anomalie|dashboard|retroattivita


class SettingsBody(BaseModel):
    model_config = ConfigDict(extra="ignore")
    enabled: Optional[bool] = None
    mode: Optional[str] = None
    confirm_before_modify: Optional[bool] = None
    auto_execute: Optional[bool] = None
    daily_limit: Optional[int] = Field(default=None, ge=0, le=10000)


async def get_ai_settings(db) -> Dict[str, Any]:
    doc = await db.settings.find_one({"_id": "ai_settings"}) or {}
    out = dict(DEFAULT_AI_SETTINGS)
    for k, v in doc.items():
        if k in out and v is not None:
            out[k] = v
    # Provider/model info-only da env
    out["provider"] = os.environ.get("AI_PROVIDER") or "groq"
    out["model"] = os.environ.get("AI_MODEL") or "llama-3.3-70b-versatile"
    return out


async def _count_today_requests(db, user_id: str) -> int:
    since = datetime.now(timezone.utc) - timedelta(hours=24)
    return await db.ai_requests.count_documents({"user_id": user_id, "created_at": {"$gte": since}})


SYSTEM_PROMPT_BASE = """Sei l'Assistente AI del gestionale Magazzino Elios Tech. Rispondi SEMPRE in italiano.
Usa i tool a disposizione per rispondere: non inventare mai dati (prodotti, quantità, seriali, spedizioni).
Sii conciso, diretto e professionale. Rispondi in modo naturale, come un collega esperto — NON usare etichette
in maiuscolo come "DATO CERTO", "DATO VERIFICATO" o simili prima delle informazioni recuperate.
Quando fornisci risultati, includi nome prodotto, codice, quantità, seriale, cliente e data se disponibili.
Se un tool non trova risultati, dillo semplicemente e in modo utile (es. "Non ho trovato un prodotto
corrispondente. Prova con il nome completo, il codice o una caratteristica del prodotto.").
NON usare mai l'etichetta "POSSIBILE ANOMALIA" per un semplice mancato match o ricerca senza risultati.

REGOLE OPERAZIONI MODIFICATIVE:
- Se l'utente chiede di CREARE una spedizione o un arrivo, usa `prepare_shipment` o `prepare_arrival`.
- Questi tool NON eseguono l'operazione: creano solo un'anteprima. L'utente deve confermare manualmente nella UI.
- Non dichiarare mai "operazione eseguita" — dopo `prepare_*` il tuo output deve essere un riepilogo chiaro con il preview_id.

ANOMALIE REALI:
Continua a segnalare le VERE incoerenze quando le rilevi (es. quantità dichiarata ≠ numero di seriali disponibili,
seriali duplicati, dati contraddittori). Fallo con linguaggio naturale — esempio:
"Ho rilevato un'incoerenza: risultano 26 pezzi disponibili ma sono presenti solo 24 seriali."
Le ipotesi e i pattern sospetti vanno presentati come tali, non come fatti certi.
"""

MODE_ADDENDUM = {
    "consultation": "\nMODALITÀ: SOLO CONSULTAZIONE. Non hai accesso a tool operativi (`prepare_*` non disponibili). Rispondi con analisi/report/riepiloghi.",
    "operational": "\nMODALITÀ: OPERATIVA. Puoi preparare operazioni con `prepare_*` ma l'esecuzione richiede conferma esplicita dell'utente.",
    "full_operational": "\nMODALITÀ: OPERATIVA COMPLETA. Puoi preparare operazioni. L'esecuzione avviene comunque dopo conferma utente (o automatica se abilitato dall'Admin).",
}


def _tools_for_mode(mode: str) -> List[Dict[str, Any]]:
    if mode == "consultation":
        return [t for t in TOOLS_SCHEMA if not t["function"]["name"].startswith("prepare_")]
    return TOOLS_SCHEMA


def build_router(db, deps: auth_mod.AuthDependencies) -> APIRouter:
    router = APIRouter(prefix="/ai", tags=["ai"], dependencies=[Depends(deps.get_current_user)])

    @router.get("/status")
    async def status(current=Depends(deps.get_current_user)):
        settings = await get_ai_settings(db)
        used = await _count_today_requests(db, str(current.get("_id")))
        remaining = max(0, int(settings.get("daily_limit") or 0) - used)
        return {
            "enabled": settings["enabled"], "mode": settings["mode"],
            "confirm_before_modify": settings["confirm_before_modify"],
            "auto_execute": settings["auto_execute"],
            "daily_limit": settings["daily_limit"],
            "requests_today": used, "requests_remaining": remaining,
            "provider": settings["provider"], "model": settings["model"],
        }

    @router.get("/settings", dependencies=[Depends(deps.require_admin)])
    async def get_settings():
        return await get_ai_settings(db)

    @router.put("/settings", dependencies=[Depends(deps.require_admin)])
    async def put_settings(body: SettingsBody, current=Depends(deps.require_admin)):
        updates = {k: v for k, v in body.model_dump(exclude_unset=True).items() if v is not None}
        # Validazioni
        if "mode" in updates and updates["mode"] not in ("consultation", "operational", "full_operational"):
            raise HTTPException(400, "mode non valido")
        # auto_execute solo se full_operational
        current_doc = await get_ai_settings(db)
        merged = {**current_doc, **updates}
        if merged.get("auto_execute") and merged.get("mode") != "full_operational":
            raise HTTPException(400, "auto_execute richiede mode=full_operational")
        await db.settings.update_one({"_id": "ai_settings"}, {"$set": updates}, upsert=True)
        # Audit
        await event_logger.log_event(
            db, category="AI", event_type="AI_SETTINGS_CHANGED",
            action="ai.settings.update", level="INFO", status="SUCCESS",
            user=current.get("username"), user_role=current.get("role"),
            endpoint="PUT /api/ai/settings",
            message=f"Impostazioni AI aggiornate: {list(updates.keys())}",
            details={"updates": updates},
        )
        return await get_ai_settings(db)

    @router.post("/chat")
    async def chat(body: ChatBody, request: Request, current=Depends(deps.get_current_user)):
        settings = await get_ai_settings(db)
        if not settings.get("enabled"):
            raise HTTPException(403, "Assistente AI disabilitato dall'Admin")
        # Quota giornaliera
        user_id = str(current.get("_id"))
        used = await _count_today_requests(db, user_id)
        if used >= int(settings.get("daily_limit") or 0):
            await event_logger.log_event(
                db, category="AI", event_type="AI_LIMIT_REACHED",
                action="ai.chat", level="WARNING", status="FAILURE",
                user=current.get("username"), endpoint="POST /api/ai/chat",
                message=f"Limite giornaliero AI raggiunto ({used}/{settings.get('daily_limit')})",
            )
            raise HTTPException(429, f"Limite giornaliero AI raggiunto ({used}/{settings.get('daily_limit')}). Riprova domani.")

        # Persisti la richiesta (per quota + log)
        req_at = datetime.now(timezone.utc)
        op_id = event_logger.new_operation_id("AI")
        await db.ai_requests.insert_one({
            "user_id": user_id, "username": current.get("username"),
            "created_at": req_at, "operation_id": op_id,
            "context_section": body.context_section,
        })

        # Costruisci provider e messaggi
        try:
            provider = get_ai_provider()
        except AIProviderError as e:
            await event_logger.log_event(
                db, category="AI", event_type="AI_PROVIDER_ERROR",
                action="ai.chat.provider_init", level="ERROR", status="FAILURE",
                user=current.get("username"), operation_id=op_id,
                message=f"Provider AI non configurato: {e.kind} — {str(e)}",
            )
            raise HTTPException(503, f"Provider AI non configurato: {str(e)}")

        # Recupera sessione (thread) se session_id fornito
        session_id = body.session_id or f"session-{user_id}-{req_at.timestamp()}"
        prior: List[Dict[str, Any]] = []
        if body.session_id:
            doc = await db.ai_sessions.find_one({"session_id": body.session_id, "user_id": user_id})
            if doc:
                prior = doc.get("messages", [])[-30:]  # ultimi 30 messaggi

        mode = settings.get("mode") or "consultation"
        system = SYSTEM_PROMPT_BASE + MODE_ADDENDUM.get(mode, "")
        if body.context_section:
            system += f"\n\nCONTESTO CORRENTE UTENTE: {body.context_section}. Se la domanda è ambigua, interpreta rispetto a questa sezione."

        messages = [{"role": "system", "content": system}] + prior + [{"role": "user", "content": body.message}]

        # Loop tool-use — max 6 giri
        # Ottieni inventory service condiviso
        from inventory_router import get_svc as _get_svc
        svc = await _get_svc(db)

        tools = _tools_for_mode(mode)
        tool_calls_used: List[Dict[str, Any]] = []
        final_reply = ""
        pending_operation: Optional[Dict[str, Any]] = None

        try:
            for turn in range(6):
                result = await provider.chat(messages, tools=tools, temperature=0.2, max_tokens=1024)
                reply = result.get("content") or ""
                calls = result.get("tool_calls") or []
                if not calls:
                    final_reply = reply
                    break
                # Aggiungi il turno assistant al thread
                messages.append({"role": "assistant", "content": reply or None, "tool_calls": calls})
                # Esegui ogni tool call
                for tc in calls:
                    fn = tc.get("function") or {}
                    tname = fn.get("name") or ""
                    try:
                        targs = json.loads(fn.get("arguments") or "{}")
                    except json.JSONDecodeError:
                        targs = {}
                    if mode == "consultation" and tname.startswith("prepare_"):
                        tres = {"error": "not_allowed_in_consultation_mode"}
                    else:
                        tres = await dispatch_tool(db, svc, tname, targs, current)
                    tool_calls_used.append({"tool": tname, "args": targs, "result_summary": {k: v for k, v in tres.items() if k in ("error", "preview_id", "preview_ready", "total_found", "total_returned")}})
                    # Se ha preparato un'operazione, salvala per il popup di conferma
                    if isinstance(tres, dict) and tres.get("preview_ready"):
                        pending_operation = {"preview_id": tres.get("preview_id"), "summary": tres.get("summary")}
                    # Log del tool call
                    await event_logger.log_event(
                        db, category="AI", event_type="AI_TOOL_CALL",
                        action=f"ai.tool.{tname}", level="INFO",
                        status="FAILURE" if (isinstance(tres, dict) and tres.get("error")) else "SUCCESS",
                        user=current.get("username"), operation_id=op_id,
                        message=f"Tool {tname} chiamato",
                        details={"args_keys": list(targs.keys()), "result_type": type(tres).__name__},
                    )
                    messages.append({
                        "role": "tool", "tool_call_id": tc.get("id"),
                        "name": tname,
                        "content": json.dumps(tres, ensure_ascii=False, default=str)[:8000],
                    })
            else:
                final_reply = final_reply or "Ho eseguito troppi passaggi senza completare. Riprova con una domanda più specifica."
        except AIProviderError as e:
            await event_logger.log_event(
                db, category="AI", event_type="AI_PROVIDER_ERROR",
                action="ai.chat", level="ERROR", status="FAILURE",
                user=current.get("username"), operation_id=op_id,
                message=f"Provider {e.kind}: {str(e)}",
            )
            raise HTTPException(502, f"Errore provider AI: {str(e)}")

        # Aggiorna sessione
        new_msgs = prior + [{"role": "user", "content": body.message}, {"role": "assistant", "content": final_reply}]
        await db.ai_sessions.update_one(
            {"session_id": session_id, "user_id": user_id},
            {"$set": {"session_id": session_id, "user_id": user_id, "updated_at": datetime.now(timezone.utc),
                      "messages": new_msgs[-60:]}},
            upsert=True,
        )

        # Log risposta AI
        await event_logger.log_event(
            db, category="AI", event_type="AI_RESPONSE",
            action="ai.chat", level="INFO", status="SUCCESS",
            user=current.get("username"), operation_id=op_id,
            endpoint="POST /api/ai/chat",
            message=f"AI risposta ({len(tool_calls_used)} tool calls){' — pending op' if pending_operation else ''}",
            details={"context_section": body.context_section, "tool_calls_count": len(tool_calls_used),
                     "message_preview": body.message[:200], "provider": provider.name, "model": provider.model,
                     "pending_operation_id": (pending_operation or {}).get("preview_id")},
        )

        return {
            "reply": final_reply, "session_id": session_id,
            "operation_id": op_id, "tool_calls": tool_calls_used,
            "pending_operation": pending_operation,
            "requests_remaining": max(0, int(settings.get("daily_limit") or 0) - used - 1),
        }

    @router.post("/execute/{preview_id}")
    async def execute_pending(preview_id: str, request: Request, current=Depends(deps.get_current_user)):
        """Esegue una pending operation. Chiama gli endpoint HTTP esistenti (submit_checklist,
        submit_arrivo) con l'auth JWT del user → SSOT/logging/inventory update automatici."""
        settings = await get_ai_settings(db)
        if not settings.get("enabled"):
            raise HTTPException(403, "Assistente AI disabilitato")
        if settings.get("mode") == "consultation":
            raise HTTPException(403, "Modalità solo consultazione: nessuna operazione consentita")
        doc = await db.ai_pending_ops.find_one({"preview_id": preview_id, "user_id": str(current.get("_id"))})
        if not doc:
            raise HTTPException(404, "Preview non trovata (o scaduta)")
        if doc.get("status") != "pending":
            raise HTTPException(409, f"Preview già in stato {doc.get('status')}")
        op = doc.get("operation") or {}
        auth_header = request.headers.get("Authorization") or ""
        # Base URL loopback: preserviamo Notion/DB via HTTP interno all'app
        base = os.environ.get("INTERNAL_API_BASE") or "http://localhost:8001"
        result: Dict[str, Any] = {}
        try:
            async with httpx.AsyncClient(timeout=60.0, headers={"Authorization": auth_header}) as client:
                if op.get("operation_type") == "shipment":
                    payload = {
                        "operator": current.get("username"), "structure": op.get("cliente"),
                        "taken_by": op.get("taken_by") or current.get("username"),
                        "items": [{
                            "page_id": op.get("product_page_id"), "name": op.get("product_name"),
                            "serialized": (op.get("tipo_gestione") == "a_seriale"),
                            "serials": op.get("serials") or [],
                            "quantity": op.get("quantity"), "unit": "pz",
                        }],
                    }
                    r = await client.post(f"{base}/api/checklist/send", json=payload)
                elif op.get("operation_type") == "arrival":
                    payload = {
                        "operator": current.get("username"),
                        "fornitore": op.get("fornitore") or "AI",
                        "items": [{
                            "page_id": op.get("product_page_id"), "name": op.get("product_name"),
                            "serialized": (op.get("tipo_gestione") == "a_seriale"),
                            "serials": op.get("serials") or [],
                            "quantity": op.get("quantity"), "unit": "pz",
                        }],
                    }
                    r = await client.post(f"{base}/api/arrivi/send", json=payload)
                else:
                    raise HTTPException(400, f"Tipo operazione non supportato: {op.get('operation_type')}")
                if r.status_code >= 400:
                    await db.ai_pending_ops.update_one({"preview_id": preview_id},
                        {"$set": {"status": "failed", "error": r.text[:500], "executed_at": datetime.now(timezone.utc)}})
                    await event_logger.log_event(
                        db, category="AI", event_type="AI_OPERATION_FAILED",
                        action="ai.execute", level="ERROR", status="FAILURE",
                        user=current.get("username"),
                        message=f"Esecuzione AI fallita ({op.get('operation_type')}): {r.status_code}",
                        details={"preview_id": preview_id, "status_code": r.status_code, "error": r.text[:400]},
                    )
                    raise HTTPException(r.status_code, f"Operazione fallita: {r.text[:200]}")
                result = r.json()
        except HTTPException:
            raise
        except Exception as e:
            await db.ai_pending_ops.update_one({"preview_id": preview_id},
                {"$set": {"status": "failed", "error": str(e)[:500]}})
            raise HTTPException(500, f"Errore esecuzione AI: {e}")

        # Verifica coerenza — leggi l'esito dal backend
        await db.ai_pending_ops.update_one(
            {"preview_id": preview_id},
            {"$set": {"status": "executed", "executed_at": datetime.now(timezone.utc), "backend_result": result}},
        )
        await event_logger.log_event(
            db, category="AI", event_type="AI_OPERATION_EXECUTED",
            action="ai.execute", level="INFO", status="SUCCESS",
            user=current.get("username"),
            product=op.get("product_name"), product_code=op.get("product_code"),
            customer=op.get("cliente"),
            quantity_change=(op.get("quantity") if op.get("operation_type") == "shipment" else op.get("quantity")),
            message=f"AI ha eseguito {op.get('operation_type')} — {op.get('product_name')} × {op.get('quantity')}",
            details={"preview_id": preview_id, "backend": {k: v for k, v in (result or {}).items() if k in ("status", "message", "checklist_id", "arrivo_id")}},
        )
        return {"ok": True, "backend_result": result}

    @router.post("/pending/{preview_id}/cancel")
    async def cancel_pending(preview_id: str, current=Depends(deps.get_current_user)):
        doc = await db.ai_pending_ops.find_one({"preview_id": preview_id, "user_id": str(current.get("_id"))})
        if not doc:
            raise HTTPException(404, "Preview non trovata")
        await db.ai_pending_ops.update_one({"preview_id": preview_id},
            {"$set": {"status": "cancelled", "cancelled_at": datetime.now(timezone.utc)}})
        await event_logger.log_event(
            db, category="AI", event_type="AI_OPERATION_CANCELLED",
            action="ai.cancel", level="INFO", status="SUCCESS",
            user=current.get("username"),
            message=f"AI operation annullata dall'utente",
            details={"preview_id": preview_id},
        )
        return {"ok": True}

    return router
