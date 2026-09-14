import { useEffect, useRef, useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { PaperPlaneRight, Robot, Warning, CheckCircle, XCircle } from "@phosphor-icons/react";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Badge } from "../components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "../components/ui/dialog";

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

export default function AIAssistantPage() {
  const [status, setStatus] = useState(null); // {enabled, mode, requests_remaining, ...}
  const [loadingStatus, setLoadingStatus] = useState(true);
  const [messages, setMessages] = useState([]); // {role: user|ai|system, content, pending?, toolCalls?}
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [sessionId, setSessionId] = useState(null);
  const [pendingOp, setPendingOp] = useState(null); // {preview_id, summary}
  const scrollRef = useRef(null);

  // Contesto sezione: se query param ?from=inventario o l'utente arriva da una pagina, invia il contesto.
  const contextSection = (() => {
    if (typeof window === "undefined") return null;
    const params = new URLSearchParams(window.location.search);
    return params.get("from") || null;
  })();

  const loadStatus = async () => {
    setLoadingStatus(true);
    try {
      const { data } = await axios.get(`${API}/ai/status`);
      setStatus(data);
    } catch (e) {
      setStatus({ enabled: false });
    } finally { setLoadingStatus(false); }
  };
  useEffect(() => { loadStatus(); }, []);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages, sending]);

  const send = async (text) => {
    const q = (text ?? input).trim();
    if (!q || sending || !status?.enabled) return;
    setMessages((m) => [...m, { role: "user", content: q }]);
    setInput("");
    setSending(true);
    try {
      const payload = { message: q };
      if (sessionId) payload.session_id = sessionId;
      if (contextSection) payload.context_section = contextSection;
      const { data } = await axios.post(`${API}/ai/chat`, payload);
      setSessionId(data.session_id);
      setMessages((m) => [...m, { role: "ai", content: data.reply || "(nessuna risposta)", toolCalls: data.tool_calls || [], op_id: data.operation_id }]);
      if (data.pending_operation) {
        setPendingOp(data.pending_operation);
      }
      // Ricarica quota
      setStatus((s) => (s ? { ...s, requests_remaining: data.requests_remaining } : s));
    } catch (e) {
      const msg = e?.response?.data?.detail || e?.message || "Errore sconosciuto";
      setMessages((m) => [...m, { role: "error", content: msg }]);
      toast.error("AI: errore", { description: msg });
    } finally { setSending(false); }
  };

  const confirmPending = async () => {
    if (!pendingOp) return;
    try {
      const { data } = await axios.post(`${API}/ai/execute/${pendingOp.preview_id}`);
      toast.success("Operazione AI eseguita", { description: data?.backend_result?.message || "" });
      setMessages((m) => [...m, { role: "system", content: `✓ Operazione ${pendingOp.summary?.operation_type} eseguita: ${pendingOp.summary?.product_name} × ${pendingOp.summary?.quantity} → ${pendingOp.summary?.cliente || pendingOp.summary?.fornitore || ""}` }]);
      setPendingOp(null);
    } catch (e) {
      const msg = e?.response?.data?.detail || e?.message;
      toast.error("Esecuzione AI fallita", { description: msg });
      setMessages((m) => [...m, { role: "error", content: `Operazione FALLITA: ${msg}` }]);
      setPendingOp(null);
    }
  };

  const cancelPending = async () => {
    if (!pendingOp) return;
    try { await axios.post(`${API}/ai/pending/${pendingOp.preview_id}/cancel`); } catch {}
    setMessages((m) => [...m, { role: "system", content: "Operazione annullata dall'utente. Nessuna modifica applicata." }]);
    setPendingOp(null);
  };

  if (loadingStatus) {
    return <div className="max-w-4xl mx-auto p-8 text-slate-500">Caricamento…</div>;
  }

  if (!status?.enabled) {
    return (
      <div className="max-w-3xl mx-auto p-6 sm:p-8" data-testid="ai-disabled">
        <div className="et-card p-8 text-center">
          <Robot size={56} weight="duotone" className="mx-auto text-slate-400" />
          <h1 className="mt-4 text-2xl font-display font-black text-slate-800">Assistente AI disabilitato</h1>
          <p className="mt-2 text-sm text-slate-600 max-w-md mx-auto">
            L'Assistente AI è al momento disattivato. Un Admin può abilitarlo da
            <b> Admin → Assistente AI</b> configurando il provider gratuito (Groq).
          </p>
        </div>
      </div>
    );
  }

  const modeLabel = { consultation: "Solo Consultazione", operational: "Operativa", full_operational: "Operativa Completa" }[status.mode] || status.mode;

  return (
    <div className="w-full max-w-4xl xl:max-w-5xl 2xl:max-w-6xl mx-auto px-2 py-2 sm:px-4 sm:py-3 lg:px-6 lg:py-4 flex flex-col" style={{ height: "calc(100dvh - 64px)" }} data-testid="ai-page">
      {/* Header compatto — riduce altezza per lasciare spazio a chat */}
      <div className="et-card p-2 sm:p-3 mb-2 flex items-center gap-2 sm:gap-3 shrink-0">
        <div className="w-8 h-8 sm:w-9 sm:h-9 rounded-lg bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center text-white shrink-0">
          <Robot size={18} weight="bold" />
        </div>
        <div className="flex-1 min-w-0">
          <h1 className="font-display text-sm sm:text-base lg:text-lg font-black text-slate-900 truncate leading-tight">Assistente AI Magazzino</h1>
          <div className="flex items-center gap-1.5 mt-0 flex-wrap">
            <Badge className="bg-indigo-100 text-indigo-800 border-indigo-200 text-[9px] sm:text-[10px] px-1.5 py-0">{modeLabel}</Badge>
            {contextSection && <Badge className="bg-amber-100 text-amber-800 border-amber-200 text-[9px] sm:text-[10px] px-1.5 py-0">Contesto: {contextSection}</Badge>}
            <span className="text-[10px] text-slate-400 truncate max-w-full">{status.provider} · {status.model}</span>
          </div>
        </div>
      </div>

      {/* Chat area — flex-1 riempie tutto lo spazio disponibile, scroll interno */}
      <div ref={scrollRef} className="flex-1 min-h-0 overflow-y-auto bg-white border border-slate-200 rounded-md p-2 sm:p-3 lg:p-4 space-y-2 sm:space-y-3" data-testid="ai-chat-area">
        {messages.map((m, i) => (
          <div key={i} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
            <div className={`max-w-[92%] sm:max-w-[85%] lg:max-w-[75%] px-2.5 sm:px-3 lg:px-4 py-1.5 sm:py-2 lg:py-2.5 rounded-lg text-[13px] sm:text-sm lg:text-[15px] ${
              m.role === "user" ? "bg-indigo-600 text-white" :
              m.role === "error" ? "bg-red-50 border border-red-200 text-red-800" :
              m.role === "system" ? "bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs lg:text-sm" :
              "bg-slate-100 text-slate-900"
            }`} data-testid={`ai-msg-${m.role}-${i}`}>
              {m.role === "ai" && <div className="text-[9px] sm:text-[10px] lg:text-[11px] uppercase tracking-wider text-slate-500 font-bold mb-1">Assistente AI</div>}
              <div className="whitespace-pre-wrap break-words overflow-wrap-anywhere leading-relaxed" style={{ wordBreak: "break-word", overflowWrap: "anywhere" }}>{m.content}</div>
              {m.toolCalls?.length > 0 && (
                <div className="mt-1.5 text-[9px] sm:text-[10px] lg:text-[11px] text-slate-400 break-words">
                  Tool: {m.toolCalls.map((t) => t.tool).join(", ")}
                </div>
              )}
            </div>
          </div>
        ))}
        {sending && (
          <div className="flex justify-start">
            <div className="bg-slate-100 px-2.5 lg:px-4 py-1.5 lg:py-2.5 rounded-lg text-xs sm:text-sm lg:text-[15px] text-slate-500 flex items-center gap-2" data-testid="ai-thinking">
              <div className="flex gap-1">
                <span className="w-2 h-2 bg-indigo-400 rounded-full animate-bounce" style={{ animationDelay: "0ms" }} />
                <span className="w-2 h-2 bg-indigo-400 rounded-full animate-bounce" style={{ animationDelay: "150ms" }} />
                <span className="w-2 h-2 bg-indigo-400 rounded-full animate-bounce" style={{ animationDelay: "300ms" }} />
              </div>
              Sto elaborando…
            </div>
          </div>
        )}
      </div>

      {/* Input — sempre visibile in fondo, non scrolla mai */}
      <div className="mt-2 flex gap-2 shrink-0">
        <Input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey && !sending) { e.preventDefault(); send(); } }}
          placeholder="Chiedi qualcosa al magazzino…"
          className="h-11 lg:h-12 flex-1 text-sm sm:text-base lg:text-[15px]"
          disabled={sending}
          data-testid="ai-input"
        />
        <Button
          onClick={() => send()}
          disabled={sending || !input.trim()}
          className="h-11 lg:h-12 bg-indigo-600 hover:bg-indigo-700 text-white px-4 sm:px-5 lg:px-6 shrink-0"
          data-testid="ai-send-btn"
          aria-label="Invia"
        >
          <PaperPlaneRight size={16} weight="bold" className="lg:hidden" />
          <PaperPlaneRight size={18} weight="bold" className="hidden lg:block" />
          <span className="hidden lg:inline ml-2 text-sm font-semibold">Invia</span>
        </Button>
      </div>

      {/* Popup di conferma operazione */}
      {pendingOp && (
        <Dialog open={true} onOpenChange={(v) => !v && cancelPending()}>
          <DialogContent className="max-w-md w-[95vw] sm:w-full" data-testid="ai-confirm-dialog">
            <DialogHeader>
              <DialogTitle className="text-amber-700 flex items-center gap-2 text-base sm:text-lg">
                <Warning size={20} weight="bold" /> Conferma operazione AI
              </DialogTitle>
              <DialogDescription className="text-xs sm:text-sm">L'AI ha preparato questa operazione. Vuoi eseguirla realmente?</DialogDescription>
            </DialogHeader>
            <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-xs sm:text-sm space-y-1.5" style={{ wordBreak: "break-word" }}>
              <div><b>Tipo:</b> {pendingOp.summary?.operation_type === "shipment" ? "Spedizione" : "Arrivo"}</div>
              <div><b>Prodotto:</b> {pendingOp.summary?.product_name} <span className="text-slate-500">({pendingOp.summary?.product_code})</span></div>
              <div><b>Quantità:</b> {pendingOp.summary?.quantity}</div>
              {pendingOp.summary?.serials?.length > 0 && (
                <div><b>Seriali:</b> <span className="font-mono-tight break-all">{pendingOp.summary.serials.join(", ")}</span></div>
              )}
              {pendingOp.summary?.cliente && <div><b>Cliente:</b> {pendingOp.summary.cliente}</div>}
              {pendingOp.summary?.fornitore && <div><b>Fornitore:</b> {pendingOp.summary.fornitore}</div>}
              {pendingOp.summary?.taken_by && <div><b>Preso da:</b> {pendingOp.summary.taken_by}</div>}
              <div className="text-[11px] sm:text-xs text-slate-500 mt-2 break-all">
                Preview ID: <span className="font-mono-tight">{pendingOp.preview_id}</span>
              </div>
            </div>
            <DialogFooter className="flex-col-reverse sm:flex-row gap-2">
              <Button variant="outline" onClick={cancelPending} data-testid="ai-cancel-op" className="w-full sm:w-auto">
                <XCircle size={16} /> Annulla
              </Button>
              <Button onClick={confirmPending} className="bg-emerald-600 hover:bg-emerald-700 text-white w-full sm:w-auto" data-testid="ai-confirm-op">
                <CheckCircle size={16} /> Conferma esecuzione
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
