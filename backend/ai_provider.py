"""F20 (26/02/2026) — Astrazione AIProvider per l'Assistente AI.

Provider di default: Groq (free tier, OpenAI-compatible API).
Configurabile via env vars — server-side only, key MAI esposta al frontend.

Cambio provider: settare AI_PROVIDER=groq|openai|... + AI_API_KEY + AI_MODEL.
NON usa EMERGENT_LLM_KEY per rispettare la richiesta esplicita dell'utente.
"""
from __future__ import annotations

import os
import json
import logging
from typing import Any, Dict, List, Optional

import httpx

logger = logging.getLogger(__name__)


class AIProviderError(Exception):
    """Errore normalizzato dal provider (rate limit, quota, invalid key, timeout, offline)."""
    def __init__(self, kind: str, message: str, retryable: bool = False):
        super().__init__(message)
        self.kind = kind  # invalid_key | rate_limit | quota | timeout | offline | http_error | invalid_model
        self.retryable = retryable


class AIProvider:
    """Interfaccia base. Ogni provider implementa `chat(messages, tools)`."""
    name: str = "base"
    model: str = ""

    async def chat(
        self,
        messages: List[Dict[str, Any]],
        tools: Optional[List[Dict[str, Any]]] = None,
        temperature: float = 0.2,
        max_tokens: int = 1024,
    ) -> Dict[str, Any]:
        raise NotImplementedError


class GroqProvider(AIProvider):
    """Groq — OpenAI-compatible API. Free tier con rate limit generoso.
    Documentazione: https://console.groq.com/docs — tool/function calling supportato
    da modelli llama-3.3-70b-versatile, llama-3.1-70b-versatile, mixtral-8x7b-32768.
    """
    BASE_URL = "https://api.groq.com/openai/v1/chat/completions"

    def __init__(self, api_key: str, model: str):
        if not api_key:
            raise AIProviderError("invalid_key", "AI_API_KEY non configurata")
        if not model:
            raise AIProviderError("invalid_model", "AI_MODEL non configurato")
        self.api_key = api_key
        self.model = model
        self.name = "groq"

    async def chat(
        self,
        messages: List[Dict[str, Any]],
        tools: Optional[List[Dict[str, Any]]] = None,
        temperature: float = 0.2,
        max_tokens: int = 1024,
    ) -> Dict[str, Any]:
        payload: Dict[str, Any] = {
            "model": self.model,
            "messages": messages,
            "temperature": temperature,
            "max_tokens": max_tokens,
        }
        if tools:
            payload["tools"] = tools
            payload["tool_choice"] = "auto"
        headers = {"Authorization": f"Bearer {self.api_key}", "Content-Type": "application/json"}
        try:
            async with httpx.AsyncClient(timeout=30.0) as client:
                resp = await client.post(self.BASE_URL, headers=headers, json=payload)
        except httpx.TimeoutException:
            raise AIProviderError("timeout", "Provider AI timeout — riprova")
        except httpx.RequestError as e:
            raise AIProviderError("offline", f"Provider AI non raggiungibile: {type(e).__name__}")
        if resp.status_code == 401:
            raise AIProviderError("invalid_key", "AI API key non valida")
        if resp.status_code == 429:
            raise AIProviderError("rate_limit", "Rate limit provider raggiunto — riprova più tardi", retryable=True)
        if resp.status_code == 402 or resp.status_code == 403:
            raise AIProviderError("quota", "Quota provider esaurita")
        if resp.status_code >= 400:
            # NON loggare il body completo (potrebbe contenere echo della key). Log solo status + estratto.
            body_preview = resp.text[:200] if resp.text else ""
            logger.error(f"Groq HTTP {resp.status_code}: {body_preview}")
            raise AIProviderError("http_error", f"Errore provider ({resp.status_code})")
        data = resp.json()
        try:
            choice = data["choices"][0]
            msg = choice["message"]
            return {
                "content": msg.get("content") or "",
                "tool_calls": msg.get("tool_calls") or [],
                "finish_reason": choice.get("finish_reason"),
                "usage": data.get("usage") or {},
            }
        except (KeyError, IndexError, TypeError) as e:
            raise AIProviderError("http_error", f"Risposta provider non valida: {e}")


def get_ai_provider() -> AIProvider:
    """Factory: legge env e ritorna il provider configurato.
    Sollevata AIProviderError se non configurato correttamente.
    """
    provider_name = (os.environ.get("AI_PROVIDER") or "groq").strip().lower()
    api_key = (os.environ.get("AI_API_KEY") or "").strip()
    model = (os.environ.get("AI_MODEL") or "").strip()
    if provider_name == "groq":
        return GroqProvider(api_key=api_key, model=model or "llama-3.3-70b-versatile")
    # Estensione futura: openai/anthropic/gemini custom — ma NON via Universal Emergent Key
    raise AIProviderError("invalid_model", f"Provider AI '{provider_name}' non supportato")
