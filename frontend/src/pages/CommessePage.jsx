import { useEffect, useMemo, useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { Package, Plus, ArrowLeft, QrCode, Trash, CheckCircle, Truck, XCircle, User, Clock, PencilSimple, ArrowCounterClockwise } from "@phosphor-icons/react";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { Textarea } from "../components/ui/textarea";
import { Badge } from "../components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "../components/ui/dialog";
import { normalizeQrCode, parseDazeQr } from "../lib/qr";
import { formatDateIT } from "../lib/dateFmt";
import BarcodeScanner from "../components/BarcodeScanner";
import QrSlotAssociationDialog, { fetchQrRequirements } from "../components/QrSlotAssociationDialog";
import { useAuth } from "../lib/AuthContext";

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

const STATO_LABEL = {
  da_preparare: { txt: "Da preparare", cls: "bg-red-100 text-red-800 border-red-200", icon: "🔴" },
  in_preparazione: { txt: "In preparazione", cls: "bg-yellow-100 text-yellow-800 border-yellow-200", icon: "🟡" },
  parziale: { txt: "Parziale", cls: "bg-orange-100 text-orange-800 border-orange-200", icon: "🟠" },
  pronta: { txt: "Pronta", cls: "bg-emerald-100 text-emerald-800 border-emerald-200", icon: "🟢" },
  bozza_spedizione: { txt: "Bozza spedizione", cls: "bg-indigo-100 text-indigo-800 border-indigo-200", icon: "📝" },
  parzialmente_spedita: { txt: "Parzialmente spedita", cls: "bg-amber-100 text-amber-800 border-amber-200", icon: "📦" },
  spedita: { txt: "Spedita", cls: "bg-slate-200 text-slate-700 border-slate-300", icon: "🚚" },
  annullata: { txt: "Annullata", cls: "bg-slate-100 text-slate-500 border-slate-200", icon: "⚪" },
};
const PRIO_LABEL = {
  urgente: { txt: "Urgente", cls: "bg-red-500 text-white", icon: "🔴" },
  alta: { txt: "Alta", cls: "bg-orange-500 text-white", icon: "🟠" },
  normale: { txt: "Normale", cls: "bg-yellow-400 text-slate-900", icon: "🟡" },
  bassa: { txt: "Bassa", cls: "bg-emerald-400 text-slate-900", icon: "🟢" },
};

function CommessePage() {
  const { isAdmin, hasPermission } = useAuth();
  const canManage = isAdmin || hasPermission("gestione_commesse");
  const [selected, setSelected] = useState(null);
  const [creating, setCreating] = useState(false);
  // F23.b — Deep-link dalla Dashboard: /commesse?stato=xxx apre già filtrato
  // e /commesse?open=<id> apre direttamente il dettaglio.
  const [initialStato, setInitialStato] = useState("");
  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const st = params.get("stato") || "";
    const open = params.get("open") || "";
    if (st) setInitialStato(st);
    if (open) setSelected(open);
  }, []);
  return (
    <div className="max-w-6xl mx-auto px-2 py-3 sm:px-4 sm:py-6" data-testid="commesse-page">
      {selected ? (
        <CommessaDetail id={selected} onBack={() => setSelected(null)} />
      ) : creating ? (
        <CommessaCreate onDone={(id) => { setCreating(false); if (id) setSelected(id); }} />
      ) : (
        <CommesseList onOpen={setSelected} onCreate={canManage ? () => setCreating(true) : null} initialStato={initialStato} />
      )}
    </div>
  );
}

export default CommessePage;

function CommesseList({ onOpen, onCreate, initialStato = "" }) {
  const [items, setItems] = useState([]);
  const [kpi, setKpi] = useState({});
  const [loading, setLoading] = useState(true);
  const [filterStato, setFilterStato] = useState(initialStato);
  const load = (silent = false) => {
    if (!silent) setLoading(true);
    axios.get(`${API}/commesse`, { params: filterStato ? { stato: filterStato } : {} })
      .then(({ data }) => { setItems(data.items || []); setKpi(data.kpi || {}); })
      .catch((e) => !silent && toast.error("Errore caricamento", { description: e?.response?.data?.detail }))
      .finally(() => setLoading(false));
  };
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [filterStato]);
  // F25.b — Polling leggero 8s per aggiornamento automatico stato commesse tra operatori.
  // Riusa lo stesso endpoint /commesse (cache side-effect-free, restituisce kpi+items).
  useEffect(() => {
    const id = setInterval(() => load(true), 8000);
    return () => clearInterval(id);
    /* eslint-disable-next-line */
  }, [filterStato]);
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 flex-wrap">
        <h1 className="font-display text-xl sm:text-2xl font-black text-slate-900 flex items-center gap-2 flex-1"><Package weight="duotone" size={28} /> Commesse</h1>
        <Button onClick={onCreate} className="bg-indigo-600 hover:bg-indigo-700 text-white" data-testid="commessa-new-btn"><Plus size={16} /> Nuova</Button>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 sm:gap-3" data-testid="commesse-overview">
        {["da_preparare", "in_preparazione", "parziale", "pronta"].map((s) => (
          <button key={s} onClick={() => setFilterStato(filterStato === s ? "" : s)}
            className={`et-card p-3 sm:p-4 text-left flex flex-col justify-between min-h-[92px] sm:min-h-[104px] transition-all hover:shadow-md ${filterStato === s ? "ring-2 ring-indigo-500" : ""}`}
            data-testid={`kpi-${s}`}>
            <div className="flex items-center gap-1.5 text-[11px] sm:text-xs text-slate-500 leading-tight">
              <span className="text-base sm:text-lg shrink-0" aria-hidden>{STATO_LABEL[s].icon}</span>
              <span className="font-semibold truncate">{STATO_LABEL[s].txt}</span>
            </div>
            <div className="text-2xl sm:text-3xl font-black text-slate-900 font-mono-tight mt-2 leading-none">{kpi[s] ?? 0}</div>
          </button>
        ))}
      </div>
      {loading ? (
        <div className="text-slate-500 text-center py-8">Caricamento…</div>
      ) : items.length === 0 ? (
        <div className="et-card p-8 text-center text-slate-500">Nessuna commessa {filterStato ? `con stato "${STATO_LABEL[filterStato]?.txt}"` : ""}.</div>
      ) : (
        <div className="space-y-2">
          {items.map((c) => (
            <div key={c.id} onClick={() => onOpen(c.id)}
              className="et-card p-3 cursor-pointer hover:border-indigo-300 transition-colors"
              data-testid={`commessa-row-${c.number}`}>
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-mono-tight font-bold text-slate-800">#{c.number}</span>
                <Badge className={STATO_LABEL[c.stato]?.cls + " text-[10px]"}>{STATO_LABEL[c.stato]?.icon} {STATO_LABEL[c.stato]?.txt}</Badge>
                <Badge className={PRIO_LABEL[c.priorita]?.cls + " text-[10px]"}>{PRIO_LABEL[c.priorita]?.txt}</Badge>
                <span className="text-sm text-slate-700 flex-1 min-w-0 truncate">{c.cliente}</span>
              </div>
              <div className="mt-1 text-xs text-slate-500 flex items-center gap-3 flex-wrap">
                {c.data_prevista && <span title="Data di spedizione prevista">📅 {formatDateIT(c.data_prevista)}</span>}
                {c.operatore_carico && <span><User size={11} className="inline" /> {c.operatore_carico}</span>}
                <span>{c.righe?.length ?? 0} righe</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function CommessaCreate({ onDone }) {
  const [form, setForm] = useState({ number: "", cliente: "", data_ordine: "", data_prevista: "", priorita: "normale", note: "" });
  // F24 §6 — Autocomplete cliente da Notion (stesso endpoint delle Spedizioni, SSOT unico)
  const [clienteOrderId, setClienteOrderId] = useState(null);
  const [cliSuggestions, setCliSuggestions] = useState([]);
  const [cliOpen, setCliOpen] = useState(false);
  const [cliLoading, setCliLoading] = useState(false);
  const [righe, setRighe] = useState([]);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const addRiga = (p) => {
    setRighe((r) => [...r, {
      product_page_id: p.page_id || p.id, product_name: p.name, product_code: p.code,
      tipo_gestione: p.tipo_gestione, qty_richiesta: 1,
    }]);
    setPickerOpen(false);
  };
  const searchCliente = (v) => {
    setForm((f) => ({ ...f, cliente: v }));
    setClienteOrderId(null);
    setCliOpen(true);
    if (window.__cmCliSug) clearTimeout(window.__cmCliSug);
    window.__cmCliSug = setTimeout(async () => {
      const q = (v || "").trim();
      if (q.length < 2) { setCliSuggestions([]); return; }
      setCliLoading(true);
      try {
        const { data } = await axios.get(`${API}/orders/search`, { params: { q, limit: 20 } });
        setCliSuggestions(data.items || []);
      } catch { setCliSuggestions([]); }
      finally { setCliLoading(false); }
    }, 220);
  };
  const submit = async () => {
    if (!form.number.trim() || !form.cliente.trim() || righe.length === 0) {
      toast.error("Numero, cliente e almeno una riga sono obbligatori"); return;
    }
    setSaving(true);
    try {
      // Se cliente non è in Notion, l'operatore lo crea implicitamente via testo libero
      // (Notion accetterà il valore come nuova struttura — stessa semantica di /checklist/send).
      const payload = { ...form, righe };
      if (clienteOrderId) payload.order_page_id = clienteOrderId;
      const { data } = await axios.post(`${API}/commesse`, payload);
      toast.success(`Commessa #${data.number} creata`);
      onDone(data.id);
    } catch (e) {
      toast.error("Errore creazione", { description: e?.response?.data?.detail || e.message });
    } finally { setSaving(false); }
  };
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Button variant="outline" onClick={() => onDone(null)} data-testid="commessa-back"><ArrowLeft size={16} /> Indietro</Button>
        <h1 className="font-display text-lg sm:text-xl font-black flex-1">Nuova commessa</h1>
      </div>
      <div className="et-card p-3 sm:p-4 space-y-3">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div><Label>Numero *</Label><Input value={form.number} onChange={(e) => setForm({ ...form, number: e.target.value })} className="mt-1" data-testid="new-number" /></div>
          <div>
            <Label>Cliente *</Label>
            <div className="relative mt-1">
              <Input
                value={form.cliente}
                onChange={(e) => searchCliente(e.target.value)}
                onFocus={() => form.cliente.trim().length >= 2 && setCliOpen(true)}
                onBlur={() => setTimeout(() => setCliOpen(false), 180)}
                placeholder="🔍 Cerca cliente…"
                autoComplete="off"
                className="pr-9"
                data-testid="new-cliente"
              />
              {clienteOrderId && (
                <span className="absolute right-2 top-1/2 -translate-y-1/2 text-emerald-600 text-sm" title="Cliente Notion selezionato">✓</span>
              )}
              {cliOpen && form.cliente.trim().length >= 2 && (
                <div className="absolute z-40 left-0 right-0 mt-1 bg-white border border-slate-200 rounded-md shadow-xl max-h-64 overflow-auto"
                     data-testid="cliente-suggestions">
                  {cliLoading && <div className="px-3 py-2 text-xs text-slate-400">Cerco…</div>}
                  {!cliLoading && cliSuggestions.length === 0 && (
                    <div className="px-3 py-3 text-sm" data-testid="cliente-no-results">
                      <div className="text-red-600 mb-1">Nessun cliente trovato</div>
                      <div className="text-xs text-slate-500">"{form.cliente}" verrà registrato come nuovo cliente su Notion al primo utilizzo.</div>
                    </div>
                  )}
                  {cliSuggestions.map((s) => (
                    <button key={s.id} type="button"
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => { setForm((f) => ({ ...f, cliente: s.structure })); setClienteOrderId(s.id); setCliOpen(false); setCliSuggestions([]); }}
                      className="w-full text-left px-3 py-2 hover:bg-indigo-50 border-b border-slate-100 last:border-0 min-h-[44px]"
                      data-testid={`cliente-sug-${s.id}`}>
                      <div className="font-semibold text-sm text-slate-900 truncate">{s.structure}</div>
                      {s.title && s.title !== s.structure && (
                        <div className="text-xs text-slate-500 truncate">{s.title}</div>
                      )}
                    </button>
                  ))}
                </div>
              )}
            </div>
            {!clienteOrderId && form.cliente.trim().length >= 2 && (
              <p className="text-[11px] text-amber-700 mt-1">
                ℹ️ Seleziona un cliente dall'elenco oppure procedi per crearne uno nuovo.
              </p>
            )}
          </div>
          <div><Label>Data ordine</Label><Input type="date" value={form.data_ordine} onChange={(e) => setForm({ ...form, data_ordine: e.target.value })} className="mt-1" /></div>
          <div><Label>Data di spedizione prevista</Label><Input type="date" value={form.data_prevista} onChange={(e) => setForm({ ...form, data_prevista: e.target.value })} className="mt-1" /></div>
          <div><Label>Priorità</Label>
            <select value={form.priorita} onChange={(e) => setForm({ ...form, priorita: e.target.value })}
              className="mt-1 h-10 w-full border border-slate-300 rounded-md px-2 text-sm bg-white">
              <option value="urgente">🔴 Urgente</option><option value="alta">🟠 Alta</option>
              <option value="normale">🟡 Normale</option><option value="bassa">🟢 Bassa</option>
            </select>
          </div>
          <div className="sm:col-span-2"><Label>Note</Label><Textarea value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} rows={2} className="mt-1" /></div>
        </div>
        <div className="border-t pt-3">
          <div className="flex items-center gap-2 mb-2">
            <h3 className="font-bold text-slate-800 flex-1">Materiale richiesto</h3>
            <Button size="sm" onClick={() => setPickerOpen(true)} data-testid="new-add-riga"><Plus size={14} /> Aggiungi</Button>
          </div>
          {righe.length === 0 ? (
            <div className="text-sm text-slate-500 italic py-2">Aggiungi almeno un prodotto…</div>
          ) : (
            <div className="space-y-2">
              {righe.map((r, i) => (
                <div key={i} className="flex items-center gap-2 bg-slate-50 rounded p-2">
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-semibold truncate">{r.product_name}</div>
                    <div className="text-[11px] text-slate-500">{r.product_code} · {r.tipo_gestione === "a_seriale" ? "A Seriale" : "A Quantità"}</div>
                  </div>
                  <Input type="number" min={1} value={r.qty_richiesta}
                    onChange={(e) => { const v = parseFloat(e.target.value) || 1; setRighe(righe.map((rr, j) => j === i ? { ...rr, qty_richiesta: v } : rr)); }}
                    className="w-20 h-9" data-testid={`riga-qty-${i}`} />
                  <Button size="sm" variant="ghost" onClick={() => setRighe(righe.filter((_, j) => j !== i))}><Trash size={14} /></Button>
                </div>
              ))}
            </div>
          )}
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={() => onDone(null)}>Annulla</Button>
          <Button onClick={submit} disabled={saving} className="bg-indigo-600 hover:bg-indigo-700 text-white" data-testid="new-save-btn">
            {saving ? "Creazione…" : "Crea commessa"}
          </Button>
        </div>
      </div>
      {pickerOpen && <ProductPicker onClose={() => setPickerOpen(false)} onPick={addRiga} />}
    </div>
  );
}

function ProductPicker({ onClose, onPick }) {
  const [q, setQ] = useState("");
  const [items, setItems] = useState([]);
  useEffect(() => {
    axios.get(`${API}/inventory`).then(({ data }) => setItems(data?.items || [])).catch(() => setItems([]));
  }, []);
  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    const active = items.filter((it) => it.active !== false && it.tipo_gestione);
    if (!s) return active.slice(0, 60);
    return active.filter((it) => (it.name || "").toLowerCase().includes(s) || (it.code || "").toLowerCase().includes(s)).slice(0, 60);
  }, [items, q]);
  return (
    <Dialog open={true} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-lg w-[95vw]">
        <DialogHeader><DialogTitle>Scegli prodotto</DialogTitle></DialogHeader>
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Cerca…" className="h-10" autoFocus />
        <div className="max-h-72 overflow-y-auto border border-slate-200 rounded-md">
          {filtered.map((it) => (
            <button key={it.page_id || it.id} onClick={() => onPick({ ...it, page_id: it.page_id || it.id })}
              className="w-full text-left px-3 py-2 hover:bg-indigo-50 border-b border-slate-100 last:border-0"
              data-testid={`pick-${it.page_id || it.id}`}>
              <div className="text-sm font-semibold truncate">{it.name}</div>
              <div className="text-[11px] text-slate-500">{it.code} · {it.tipo_gestione === "a_seriale" ? "A Seriale" : "A Quantità"} · qty {it.quantity ?? 0}</div>
            </button>
          ))}
          {filtered.length === 0 && <div className="p-3 text-sm text-slate-400">Nessun prodotto.</div>}
        </div>
        <DialogFooter><Button variant="outline" onClick={onClose}>Chiudi</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function CommessaDetail({ id, onBack }) {
  const { isAdmin, hasPermission } = useAuth();
  const canManage = isAdmin || hasPermission("gestione_commesse");
  const [c, setC] = useState(null);
  const [loading, setLoading] = useState(true);
  const [scannerOpen, setScannerOpen] = useState(false);
  const [scanRigaIdx, setScanRigaIdx] = useState(null);
  const [scanMode, setScanMode] = useState("serial"); // "serial" | "qty"
  const [confirmComplete, setConfirmComplete] = useState(false);
  const [showBozza, setShowBozza] = useState(false);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [confirmCancelBozza, setConfirmCancelBozza] = useState(false);
  const [confirmReopen, setConfirmReopen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [editMode, setEditMode] = useState(false);
  const [busy, setBusy] = useState(false);
  // F30 — Dialog associazione QR post-picking (multi-slot)
  const [qrDialog, setQrDialog] = useState(null); // { serial, productPageId, productName, initialConfig }
  // F25.b — Tracciamento dello stato precedente per detection cambiamenti (toast informativo)
  const lastStatoRef = useState({ current: null })[0];

  const load = (silent = false) => {
    if (!silent) setLoading(true);
    axios.get(`${API}/commesse/${id}`)
      .then(({ data }) => {
        if (silent && lastStatoRef.current && lastStatoRef.current !== data.stato) {
          // Cambio stato rilevato da polling — notifica non invasiva
          toast.info("Commessa aggiornata", { description: `Nuovo stato: ${STATO_LABEL[data.stato]?.txt || data.stato}`, duration: 4000 });
        }
        lastStatoRef.current = data.stato;
        setC(data);
        // Riapri automaticamente la bozza se lo stato è bozza_spedizione (ripresa)
        if (data.stato === "bozza_spedizione" && !silent) setShowBozza(true);
      })
      .catch(() => !silent && toast.error("Commessa non trovata"))
      .finally(() => !silent && setLoading(false));
  };
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [id]);
  // F25.b — Polling leggero 8s per real-time cross-operatore
  useEffect(() => {
    const iv = setInterval(() => load(true), 8000);
    return () => clearInterval(iv);
    /* eslint-disable-next-line */
  }, [id]);

  const doTake = async () => {
    setBusy(true);
    try { const { data } = await axios.post(`${API}/commesse/${id}/take`); setC(data); toast.success("Commessa presa in carico"); }
    catch (e) { toast.error("Errore", { description: e?.response?.data?.detail }); }
    finally { setBusy(false); }
  };
  const doPickQty = async (idx, delta) => {
    setBusy(true);
    try { const { data } = await axios.post(`${API}/commesse/${id}/pick`, { riga_index: idx, quantity: delta }); setC(data); }
    catch (e) { toast.error("Prelievo bloccato", { description: e?.response?.data?.detail }); }
    finally { setBusy(false); }
  };
  const doPickSerial = async (idx, sn) => {
    const clean = normalizeQrCode(sn);
    const { serial } = parseDazeQr(clean);
    if (!serial) return;
    setBusy(true);
    try {
      const { data } = await axios.post(`${API}/commesse/${id}/pick`, { riga_index: idx, serial });
      setC(data); toast.success(`Prelevato ${serial}`);
      // F30 — Se il prodotto è configurato per usare QR e non tutti gli slot sono associati, prompt.
      const r = data.righe?.[idx];
      if (r?.product_page_id) {
        const cfg = await fetchQrRequirements(r.product_page_id, serial);
        if (cfg.enabled && (cfg.slots || []).length > 0) {
          const remaining = (cfg.slots || []).filter((s) => !cfg.existingBySlot?.[s]);
          if (remaining.length > 0) {
            setQrDialog({
              serial,
              productPageId: r.product_page_id,
              productName: r.product_name,
              initialConfig: cfg,
            });
          }
        }
      }
    }
    catch (e) { toast.error("Seriale non valido", { description: e?.response?.data?.detail }); }
    finally { setBusy(false); }
  };
  const doRemoveSerial = async (idx, sn) => {
    setBusy(true);
    try {
      const { data } = await axios.post(`${API}/commesse/${id}/pick`, { riga_index: idx, serial: sn, remove: true });
      setC(data);
      toast.success(`Seriale ${sn} rimosso`);
    } catch (e) { toast.error("Rimozione fallita", { description: e?.response?.data?.detail }); }
    finally { setBusy(false); }
  };
  const doComplete = async () => {
    setBusy(true);
    try { const { data } = await axios.post(`${API}/commesse/${id}/complete`); setC(data); setConfirmComplete(false); toast.success("Commessa pronta per spedizione"); }
    catch (e) { toast.error("Errore", { description: e?.response?.data?.detail }); }
    finally { setBusy(false); }
  };
  const doCreateDraft = async () => {
    // F25.b — Crea/recupera bozza persistente lato server prima di mostrare il dialog
    setBusy(true);
    try {
      const { data } = await axios.post(`${API}/commesse/${id}/draft`);
      setC(data.commessa);
      setShowBozza(true);
      if (data.resumed) toast.info("Bozza esistente recuperata", { description: `Creata da ${data.draft?.created_by || "operatore"}` });
      else toast.success("Bozza spedizione creata");
    } catch (e) { toast.error("Errore creazione bozza", { description: e?.response?.data?.detail }); }
    finally { setBusy(false); }
  };
  const doConfirmShip = async (opts = {}) => {
    setBusy(true);
    try {
      const body = opts && opts.shipping_date ? { shipping_date: opts.shipping_date } : {};
      const { data } = await axios.post(`${API}/commesse/${id}/ship`, body);
      setC(data.commessa); setShowBozza(false);
      if (data.already_shipped) {
        toast.info("Commessa già spedita", { description: `Rif: ${data.shipment?.checklist_id}` });
      } else {
        toast.success("Spedizione confermata", { description: data.shipment?.message });
      }
      if (data.shipment?.inventory_warnings?.length) toast.warning("Attenzione Inventario", { description: data.shipment.inventory_warnings.join(" · "), duration: 15000 });
    } catch (e) { toast.error("Spedizione fallita", { description: e?.response?.data?.detail }); }
    finally { setBusy(false); }
  };
  const doCancelDraft = async () => {
    setBusy(true);
    try { const { data } = await axios.post(`${API}/commesse/${id}/draft/cancel`); setC(data.commessa); setShowBozza(false); setConfirmCancelBozza(false); toast.success("Bozza annullata"); }
    catch (e) { toast.error("Errore", { description: e?.response?.data?.detail }); }
    finally { setBusy(false); }
  };
  const doCancel = async () => {
    setBusy(true);
    try {
      const { data } = await axios.post(`${API}/commesse/${id}/cancel`, {});
      setC(data); setConfirmCancel(false);
      toast.success("Commessa annullata", { description: willRollback ? "Rollback delle spedizioni completato" : undefined });
    }
    catch (e) {
      const d = e?.response?.data?.detail || "Errore";
      toast.error("Annullamento fallito", { description: typeof d === "string" ? d : JSON.stringify(d), duration: 15000 });
    }
    finally { setBusy(false); }
  };
  const doReopen = async () => {
    setBusy(true);
    try {
      const { data } = await axios.post(`${API}/commesse/${id}/reopen`);
      setC(data);
      setConfirmReopen(false);
      toast.success("Commessa riaperta", { description: `Nuovo stato: ${STATO_LABEL[data.stato]?.txt || data.stato}` });
    } catch (e) { toast.error("Riapertura fallita", { description: e?.response?.data?.detail }); }
    finally { setBusy(false); }
  };
  const doReopenPreparation = async () => {
    setBusy(true);
    try {
      const { data } = await axios.post(`${API}/commesse/${id}/reopen-preparation`);
      setC(data);
      toast.success("Preparazione riaperta", { description: "Ora puoi continuare il picking" });
    } catch (e) { toast.error("Riapertura fallita", { description: e?.response?.data?.detail }); }
    finally { setBusy(false); }
  };
  const doDelete = async () => {
    setBusy(true);
    try {
      await axios.delete(`${API}/commesse/${id}`);
      toast.success("Commessa eliminata definitivamente");
      setConfirmDelete(false);
      onBack();
    } catch (e) { toast.error("Eliminazione bloccata", { description: e?.response?.data?.detail }); }
    finally { setBusy(false); }
  };
  // F27 — Scanner A Quantità: verifica che il codice scansionato corrisponda al product_code della riga
  const doScanQty = (idx, scannedValue) => {
    const norm = normalizeQrCode(scannedValue);
    const { serial } = parseDazeQr(norm);
    const code = (serial || norm || "").trim();
    const r = c.righe[idx];
    const expected = (r.product_code || "").trim();
    if (!expected) {
      toast.error("Prodotto senza codice", { description: "Impossibile validare la scansione. Usa i pulsanti +/−." });
      return;
    }
    if (code.toLowerCase() !== expected.toLowerCase()) {
      toast.error("Codice non valido per questo prodotto",
        { description: `Atteso "${expected}", ricevuto "${code}"` });
      return;
    }
    if (r.qty_prelevata >= r.qty_richiesta) {
      toast.error("Quantità richiesta già raggiunta");
      return;
    }
    doPickQty(idx, 1);
  };

  if (loading || !c) return <div className="text-center py-8 text-slate-500">Caricamento…</div>;
  const canTake = c.stato === "da_preparare";
  const canPick = ["in_preparazione", "parziale"].includes(c.stato);
  // F30 — Totali basati sul RESIDUO (richiesta - spedita) per calcolare correttamente
  // le condizioni di completamento/spedizione dopo una parziale.
  const totalQty = (c.righe || []).reduce((s, r) => s + (r.qty_richiesta || 0), 0);
  const shippedQty = (c.righe || []).reduce((s, r) => s + (r.qty_spedita || 0), 0);
  const pickedQty = (c.righe || []).reduce((s, r) => s + (r.qty_prelevata || 0), 0);
  const residuoQty = Math.max(0, totalQty - shippedQty);
  const canComplete = residuoQty > 0 && pickedQty >= residuoQty && ["in_preparazione", "parziale"].includes(c.stato);
  const canCreateDraft = c.stato === "pronta";
  const canShipPartial = c.stato === "parziale" && pickedQty > 0 && pickedQty < residuoQty;
  const hasBozza = c.stato === "bozza_spedizione";
  const canCancel = !["annullata"].includes(c.stato);
  // F30.b — Warning per rollback pesante: sarà mostrato solo se spedizioni presenti
  const willRollback = ["spedita", "parzialmente_spedita"].includes(c.stato)
    || (c.shipments_history || []).some((h) => (h.items || []).length > 0);
  const rollbackShipmentCount = (c.shipments_history || []).filter((h) => (h.items || []).length > 0).length
    || (["spedita", "parzialmente_spedita"].includes(c.stato) ? 1 : 0);
  const canEdit = canManage && ["da_preparare", "in_preparazione", "parziale"].includes(c.stato);
  const canReopen = isAdmin && c.stato === "annullata";
  // F30.c — Elimina definitivamente: permesso anche su commesse annullate
  // (backend verifica che i checklist referenced siano tutti cancelled).
  const canDelete = isAdmin && (c.stato === "annullata" || (!["spedita"].includes(c.stato) && !c.shipment_ref));
  const canReopenPreparation = isAdmin && ["pronta", "parzialmente_spedita"].includes(c.stato);
  const canCancelByRole = isAdmin;  // F29 — solo admin annulla
  const canCreateDraftGate = canCreateDraft || c.stato === "parzialmente_spedita";

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Button variant="outline" size="sm" onClick={onBack} data-testid="commessa-back"><ArrowLeft size={16} /></Button>
        <h1 className="font-display text-lg sm:text-xl font-black flex-1 truncate">#{c.number} · {c.cliente}</h1>
      </div>
      <div className="et-card p-3 space-y-2">
        <div className="flex items-center gap-2 flex-wrap">
          <Badge className={STATO_LABEL[c.stato]?.cls}>{STATO_LABEL[c.stato]?.icon} {STATO_LABEL[c.stato]?.txt}</Badge>
          <Badge className={PRIO_LABEL[c.priorita]?.cls}>{PRIO_LABEL[c.priorita]?.txt}</Badge>
          {c.operatore_carico && <span className="text-xs text-slate-600"><User size={12} className="inline" /> {c.operatore_carico}</span>}
        </div>
        {c.data_prevista && <div className="text-xs text-slate-600"><Clock size={12} className="inline" /> Data di spedizione prevista: {formatDateIT(c.data_prevista)}</div>}
        {c.note && <div className="text-xs text-slate-600 whitespace-pre-wrap break-words">📝 {c.note}</div>}
        <div className="text-xs text-slate-500 font-mono-tight">op: {c.operation_id}</div>
      </div>

      {canTake && <Button onClick={doTake} disabled={busy} className="w-full bg-indigo-600 hover:bg-indigo-700 text-white h-12" data-testid="take-btn">Prendi in carico</Button>}

      <div className="space-y-2">
        {(c.righe || []).map((r, i) => {
          // F30 — 4 stati distinti: Richiesti / Preparati / Spediti / Rimanenti
          const qtyReq = r.qty_richiesta || 0;
          const qtyPrep = r.qty_prelevata || 0;
          const qtyShip = r.qty_spedita || 0;
          const rimanenti = Math.max(0, qtyReq - qtyShip);
          const canPickMore = qtyPrep + qtyShip < qtyReq;
          const done = qtyShip >= qtyReq;  // completo = tutto spedito
          const readyForShip = !done && qtyPrep + qtyShip >= qtyReq; // preparato+spedito raggiunge richiesta
          const spediti = r.seriali_spediti || [];
          return (
            <div key={i} className={`et-card p-3 ${done ? "border-emerald-300 bg-emerald-50/30" : readyForShip ? "border-indigo-300 bg-indigo-50/30" : ""}`} data-testid={`riga-${i}`}>
              <div className="flex items-start gap-2 flex-wrap">
                <div className="flex-1 min-w-0">
                  <div className="font-bold text-slate-900 break-words">{r.product_name}</div>
                  <div className="text-xs text-slate-500">{r.product_code} · {r.tipo_gestione === "a_seriale" ? "A Seriale" : "A Quantità"}</div>
                </div>
                <div className={`text-lg font-black font-mono-tight shrink-0 ${done ? "text-emerald-600" : readyForShip ? "text-indigo-600" : "text-slate-800"}`}>
                  {done ? "✓ Completo" : `${qtyPrep + qtyShip}/${qtyReq}`}
                </div>
              </div>
              {/* F30 — Riepilogo 4-colonne: R/P/S/Rim */}
              <div className="mt-1.5 grid grid-cols-4 gap-1 text-[11px] font-mono-tight">
                <div className="bg-slate-100 rounded px-2 py-1"><span className="text-slate-500">Richiesti:</span> <b>{qtyReq}</b></div>
                <div className={`rounded px-2 py-1 ${qtyPrep > 0 ? "bg-amber-100 text-amber-800" : "bg-slate-100"}`}><span className="text-slate-500">Preparati:</span> <b>{qtyPrep}</b></div>
                <div className={`rounded px-2 py-1 ${qtyShip > 0 ? "bg-emerald-100 text-emerald-800" : "bg-slate-100"}`}><span className="text-slate-500">Spediti:</span> <b>{qtyShip}</b></div>
                <div className={`rounded px-2 py-1 ${rimanenti === 0 ? "bg-emerald-100 text-emerald-800" : "bg-red-100 text-red-800"}`}><span className="text-slate-500">Rimanenti:</span> <b>{rimanenti}</b></div>
              </div>
              {canPick && canPickMore && r.tipo_gestione === "a_quantita" && (
                <div className="mt-2 flex items-center gap-2">
                  <Button size="sm" variant="outline" onClick={() => doPickQty(i, -1)} disabled={busy || qtyPrep <= 0} className="h-10 w-10 p-0" data-testid={`minus-${i}`}>−</Button>
                  <div className="flex-1 text-center font-mono-tight text-lg">{qtyPrep}</div>
                  <Button size="sm" onClick={() => doPickQty(i, 1)} disabled={busy || !canPickMore} className="h-10 w-10 p-0 bg-emerald-600 hover:bg-emerald-700 text-white" data-testid={`plus-${i}`}>+</Button>
                  <Button size="sm" onClick={() => { setScanRigaIdx(i); setScanMode("qty"); setScannerOpen(true); }} disabled={busy || !canPickMore}
                    className="h-10 bg-indigo-600 hover:bg-indigo-700 text-white" data-testid={`scan-qty-${i}`} title="Scansiona codice prodotto">
                    <QrCode size={14} /> Scan
                  </Button>
                </div>
              )}
              {canPick && !canPickMore && r.tipo_gestione === "a_quantita" && qtyPrep > 0 && (
                <div className="mt-2 flex items-center gap-2">
                  <Button size="sm" variant="outline" onClick={() => doPickQty(i, -1)} disabled={busy || qtyPrep <= 0} className="h-10 w-10 p-0" data-testid={`minus-${i}`}>−</Button>
                  <div className="flex-1 text-center text-xs text-indigo-700 font-semibold">Preparazione completata (in attesa di spedizione)</div>
                </div>
              )}
              {canPick && r.tipo_gestione === "a_seriale" && (
                <div className="mt-2 flex flex-col sm:flex-row gap-2">
                  <SerialInput onSubmit={(sn) => doPickSerial(i, sn)} disabled={busy || !canPickMore} testid={`sn-input-${i}`} placeholder={!canPickMore ? "Quantità richiesta raggiunta" : "Inserisci seriale…"} />
                  <Button size="sm" onClick={() => { setScanRigaIdx(i); setScanMode("serial"); setScannerOpen(true); }} disabled={busy || !canPickMore} className="bg-indigo-600 hover:bg-indigo-700 text-white h-10" data-testid={`scan-${i}`}>
                    <QrCode size={14} /> Scan
                  </Button>
                </div>
              )}
              {/* F30 — Seriali già SPEDITI (blu, non rimovibili) */}
              {spediti.length > 0 && (
                <div className="mt-2 text-xs bg-emerald-50 border border-emerald-200 rounded p-2">
                  <div className="font-semibold text-emerald-800 mb-1.5">🚚 Seriali spediti ({spediti.length}):</div>
                  <div className="flex flex-wrap gap-1.5">
                    {spediti.map((sn, j) => (
                      <span key={j} className="inline-flex items-center gap-1 bg-white border border-emerald-300 rounded px-2 py-1 font-mono-tight text-emerald-900" data-testid={`sn-ship-chip-${i}-${j}`} title="Seriale già uscito con una precedente spedizione">
                        <CheckCircle size={11} weight="fill" className="text-emerald-600" /> {sn}
                      </span>
                    ))}
                  </div>
                </div>
              )}
              {r.seriali_prelevati?.length > 0 && (
                <div className="mt-2 text-xs bg-slate-50 rounded p-2">
                  <div className="font-semibold text-slate-600 mb-1.5">Seriali preparati (non ancora spediti) ({r.seriali_prelevati.length}):</div>
                  <div className="flex flex-wrap gap-1.5">
                    {r.seriali_prelevati.map((sn, j) => (
                      <span key={j} className="inline-flex items-center gap-1 bg-white border border-slate-200 rounded px-2 py-1 font-mono-tight text-slate-800" data-testid={`sn-chip-${i}-${j}`}>
                        {sn}
                        {canPick && (
                          <button
                            type="button"
                            onClick={() => doRemoveSerial(i, sn)}
                            disabled={busy}
                            className="ml-1 text-red-500 hover:text-red-700 disabled:opacity-40"
                            title={`Rimuovi ${sn}`}
                            data-testid={`sn-remove-${i}-${j}`}
                            aria-label={`Rimuovi seriale ${sn}`}
                          >
                            <Trash size={12} weight="bold" />
                          </button>
                        )}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div className="flex flex-col sm:flex-row gap-2 flex-wrap">
        {canComplete && <Button onClick={() => setConfirmComplete(true)} className="flex-1 bg-emerald-600 hover:bg-emerald-700 text-white h-12" data-testid="complete-btn"><CheckCircle size={16} /> Completa preparazione</Button>}
        {canCreateDraft && <Button onClick={doCreateDraft} disabled={busy} className="flex-1 bg-indigo-600 hover:bg-indigo-700 text-white h-12" data-testid="ship-btn"><Truck size={16} /> Crea spedizione</Button>}
        {canShipPartial && <Button onClick={doCreateDraft} disabled={busy} className="flex-1 bg-amber-600 hover:bg-amber-700 text-white h-12" data-testid="ship-partial-btn"><Truck size={16} /> 📦 Conferma spedizione parziale</Button>}
        {hasBozza && <Button onClick={() => setShowBozza(true)} className="flex-1 bg-indigo-600 hover:bg-indigo-700 text-white h-12" data-testid="open-bozza-btn"><Truck size={16} /> Apri bozza</Button>}
        {canReopenPreparation && <Button onClick={doReopenPreparation} disabled={busy} variant="outline" className="text-amber-700 border-amber-300 hover:bg-amber-50 h-12" data-testid="reopen-prep-btn"><ArrowCounterClockwise size={16} /> {c.stato === "parzialmente_spedita" ? "📦 Completa spedizione" : "Riapri preparazione"}</Button>}
        {canEdit && <Button onClick={() => setEditMode(true)} variant="outline" className="h-12" data-testid="edit-btn"><PencilSimple size={16} /> Modifica</Button>}
        {canReopen && <Button onClick={() => setConfirmReopen(true)} className="bg-amber-600 hover:bg-amber-700 text-white h-12" data-testid="reopen-btn"><ArrowCounterClockwise size={16} /> Riapri Commessa</Button>}
        {canCancel && canCancelByRole && <Button onClick={() => setConfirmCancel(true)} variant="outline" className="text-red-700 border-red-300 hover:bg-red-50 h-12" data-testid="cancel-btn"><XCircle size={16} /> Annulla</Button>}
        {canDelete && <Button onClick={() => setConfirmDelete(true)} variant="outline" className="text-red-800 border-red-400 hover:bg-red-100 h-12" data-testid="delete-btn"><Trash size={16} /> Elimina definitivamente</Button>}
      </div>

      {/* F25.b — Banner bozza persistente attiva */}
      {hasBozza && !showBozza && (
        <div className="et-card p-3 border-l-4 border-indigo-500 bg-indigo-50/40" data-testid="bozza-banner">
          <div className="flex items-center gap-2 flex-wrap">
            <div className="flex-1 min-w-0">
              <div className="text-sm font-bold text-indigo-900">📝 Bozza spedizione in attesa</div>
              <div className="text-xs text-indigo-700 mt-0.5">
                Creata da <b>{c.shipment_draft?.created_by || "—"}</b>
                {c.shipment_draft?.created_at && ` il ${new Date(c.shipment_draft.created_at).toLocaleString("it-IT")}`}
              </div>
            </div>
            <Button size="sm" onClick={() => setShowBozza(true)} className="bg-indigo-600 hover:bg-indigo-700 text-white" data-testid="resume-bozza-btn">
              Riapri bozza →
            </Button>
          </div>
        </div>
      )}

      {scannerOpen && (
        <BarcodeScanner open={true} onClose={() => setScannerOpen(false)} label={scanMode === "qty" ? "Scansiona codice prodotto" : "Scansiona seriale"}
          onDetected={(v) => {
            setScannerOpen(false);
            if (scanRigaIdx === null) return;
            if (scanMode === "qty") doScanQty(scanRigaIdx, v);
            else doPickSerial(scanRigaIdx, v);
          }} />
      )}
      {confirmComplete && (
        <ConfirmDialog title="Completa preparazione" body={`Confermi la preparazione della commessa #${c.number}? Tutti i materiali risultano prelevati.`}
          onCancel={() => setConfirmComplete(false)} onConfirm={doComplete} busy={busy} confirmLabel="Conferma" />
      )}
      {showBozza && hasBozza && (
        <BozzaSpedizioneDialog commessa={c} busy={busy}
          onCancel={() => setShowBozza(false)}
          onCancelDraft={() => setConfirmCancelBozza(true)}
          onConfirm={doConfirmShip} />
      )}
      {confirmCancelBozza && (
        <ConfirmDialog title="Annulla bozza"
          body={`Confermi l'annullamento della bozza di spedizione? La commessa tornerà nello stato "Pronta". Nessuna modifica all'inventario.`}
          onCancel={() => setConfirmCancelBozza(false)}
          onConfirm={doCancelDraft} busy={busy}
          confirmLabel="Annulla bozza" danger />
      )}
      {confirmCancel && (
        <ConfirmDialog
          title={willRollback ? "⚠️ Annulla commessa con ROLLBACK" : "Annulla commessa"}
          body={
            willRollback
              ? `ATTENZIONE: la commessa #${c.number} ha ${rollbackShipmentCount} spedizione${rollbackShipmentCount === 1 ? "" : "i"} confermata${rollbackShipmentCount === 1 ? "" : "e"}. Confermando: (1) le uscite Notion verranno archiviate; (2) i seriali spediti torneranno disponibili in Inventario; (3) SN/QR verranno rimossi dall'ordine; (4) i QR verranno disassociati; (5) il picking verrà azzerato. L'operazione è registrata nel Registro Log. Solo Admin. Se qualche scrittura Notion fallisce, la commessa NON viene annullata.`
              : `Confermi l'annullamento della commessa #${c.number}? Prelievi registrati: ${pickedQty}/${totalQty}. L'operazione verrà registrata nel Registro Log.`
          }
          onCancel={() => setConfirmCancel(false)} onConfirm={doCancel} busy={busy}
          confirmLabel={willRollback ? "Conferma annullamento con rollback" : "Annulla commessa"} danger />
      )}
      {confirmReopen && (
        <ConfirmDialog title="Riapri commessa"
          body={`La commessa #${c.number} verrà riaperta mantenendo lo storico e i prelievi. Nuovo stato calcolato in base ai dati reali.`}
          onCancel={() => setConfirmReopen(false)} onConfirm={doReopen} busy={busy} confirmLabel="Conferma riapertura" />
      )}
      {confirmDelete && (
        <ConfirmDialog title="⚠️ Elimina definitivamente"
          body={
            c.stato === "annullata"
              ? `La commessa #${c.number} (annullata) verrà cancellata DEFINITIVAMENTE dal database, insieme al suo storico. L'operazione NON è annullabile. Consentita solo se tutte le spedizioni collegate sono state annullate via rollback (verificato dal server).`
              : `ATTENZIONE: la commessa #${c.number} verrà cancellata DEFINITIVAMENTE dal database. L'operazione NON è annullabile e sarà bloccata dal server se esiste qualsiasi attività (picking, spedizioni, bozze, storico). Per commesse con storico usa "Annulla" invece. Solo Admin.`
          }
          onCancel={() => setConfirmDelete(false)} onConfirm={doDelete} busy={busy} confirmLabel="Elimina definitivamente" danger />
      )}
      {editMode && (
        <CommessaEditDialog commessa={c} onClose={() => setEditMode(false)}
          onSaved={(updated) => { setC(updated); setEditMode(false); toast.success("Commessa aggiornata"); }} />
      )}
      {/* F30 — Storico spedizioni multiple */}
      {(c.shipments_history || []).length > 0 && (
        <div className="et-card p-3 space-y-2" data-testid="shipments-history">
          <div className="text-[10px] uppercase tracking-wider text-slate-500 font-bold">📦 Storico spedizioni ({c.shipments_history.length})</div>
          <div className="space-y-2">
            {c.shipments_history.map((h, i) => (
              <div key={i} className="border border-slate-200 rounded-md p-2 bg-slate-50/40 text-xs" data-testid={`history-item-${i}`}>
                <div className="flex items-center justify-between mb-1.5">
                  <div className="font-semibold text-slate-800">Spedizione #{i + 1}</div>
                  <div className="text-slate-500">{h.shipped_at ? new Date(h.shipped_at).toLocaleString("it-IT") : "—"}</div>
                </div>
                <div className="text-[11px] text-slate-500 mb-1">
                  Operatore: <b>{h.operator || "—"}</b> · ID: <span className="font-mono-tight">{h.shipment_id || "—"}</span>
                </div>
                <ul className="pl-3 list-disc space-y-0.5">
                  {(h.items || []).map((it, j) => (
                    <li key={j}>
                      <b>{it.product_name}</b> × {it.qty}
                      {(it.seriali || []).length > 0 && (
                        <span className="ml-1 font-mono-tight text-slate-600">— {it.seriali.join(", ")}</span>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>
      )}
      {/* F30 — Dialog associazione QR post-picking */}
      {qrDialog && (
        <QrSlotAssociationDialog
          open={true}
          onClose={() => setQrDialog(null)}
          serial={qrDialog.serial}
          productPageId={qrDialog.productPageId}
          productName={qrDialog.productName}
          initialConfig={qrDialog.initialConfig}
        />
      )}
    </div>
  );
}

function SerialInput({ onSubmit, disabled, testid, placeholder = "Inserisci seriale…" }) {
  const [v, setV] = useState("");
  const submit = () => { if (v.trim()) { onSubmit(v.trim()); setV(""); } };
  return (
    <div className="flex gap-2 flex-1 min-w-0">
      <Input value={v} onChange={(e) => setV(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter") submit(); }}
        placeholder={placeholder} disabled={disabled} className="h-10 flex-1 font-mono-tight" data-testid={testid} autoComplete="off" />
      <Button size="sm" onClick={submit} disabled={disabled || !v.trim()}
        className="h-10 bg-emerald-600 hover:bg-emerald-700 text-white shrink-0" data-testid={`${testid}-add-btn`}
        title="Inserisci seriale">
        <Plus size={14} weight="bold" />
      </Button>
    </div>
  );
}

function ConfirmDialog({ title, body, onCancel, onConfirm, busy, confirmLabel = "Conferma", danger = false }) {
  return (
    <Dialog open={true} onOpenChange={(v) => !v && onCancel()}>
      <DialogContent className="max-w-md w-[95vw]">
        <DialogHeader><DialogTitle>{title}</DialogTitle><DialogDescription>{body}</DialogDescription></DialogHeader>
        <DialogFooter className="flex-col-reverse sm:flex-row gap-2">
          <Button variant="outline" onClick={onCancel} disabled={busy} className="w-full sm:w-auto">Annulla</Button>
          <Button onClick={onConfirm} disabled={busy} className={`w-full sm:w-auto ${danger ? "bg-red-600 hover:bg-red-700" : "bg-indigo-600 hover:bg-indigo-700"} text-white`}>
            {busy ? "…" : confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// F24 §15 — Bozza Spedizione: preview completa dei prodotti/seriali derivati dalla commessa.
// L'inventario Notion viene aggiornato SOLO dopo "Conferma spedizione".
function BozzaSpedizioneDialog({ commessa, busy, onCancel, onCancelDraft, onConfirm }) {
  // F25.b — Preferisce il payload persistito della bozza; fallback ai dati correnti.
  const draft = commessa.shipment_draft || {};
  const draftItems = draft?.payload?.items;
  const righeSource = draftItems && draftItems.length > 0
    ? draftItems.map((it) => ({
        product_name: it.name, product_code: it.product_code || "",
        tipo_gestione: it.serialized ? "a_seriale" : "a_quantita",
        qty_richiesta: it.quantity, qty_prelevata: it.quantity,
        seriali_prelevati: it.serials || [],
      }))
    : (commessa.righe || []).map((r) => ({
        product_name: r.product_name, product_code: r.product_code,
        tipo_gestione: r.tipo_gestione,
        qty_richiesta: r.qty_richiesta, qty_prelevata: r.qty_prelevata,
        seriali_prelevati: r.seriali_prelevati || [],
      }));
  // F29.b — Split "Da spedire" (qty_prelevata > 0) vs "Non spedito" (qty residuo > 0 e nulla preparato)
  const daSpedire = righeSource.filter((r) => (r.qty_prelevata || 0) > 0);
  // F30 — Un item è "non spedito in questa parziale" se ha residuo (richiesta > spedita) e nulla preparato ora.
  const nonSpedito = (commessa.righe || []).filter((r) => {
    const req = r.qty_richiesta || 0;
    const ship = r.qty_spedita || 0;
    const prep = r.qty_prelevata || 0;
    const residuo = Math.max(0, req - ship);
    return residuo > 0 && prep === 0;
  });
  const isPartial = nonSpedito.length > 0;
  // F28.b — Data spedizione modificabile
  const todayISO = new Date().toISOString().slice(0, 10);
  const initialDate = draft?.payload?.shipping_date || commessa.data_prevista || todayISO;
  const [shipDate, setShipDate] = useState(initialDate);
  return (
    <Dialog open={true} onOpenChange={(v) => !v && onCancel()}>
      <DialogContent className="max-w-lg w-[95vw] max-h-[90vh] overflow-y-auto" data-testid="bozza-spedizione-dialog">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Truck size={20} weight="bold" className="text-indigo-600" />
            {isPartial ? "Conferma spedizione parziale" : "Bozza Spedizione"}
            <Badge className={`text-[10px] ml-1 ${isPartial ? "bg-amber-100 text-amber-800 border-amber-200" : "bg-indigo-100 text-indigo-800 border-indigo-200"}`}>
              {isPartial ? "Parziale" : "Persistente"}
            </Badge>
          </DialogTitle>
          <DialogDescription>
            {isPartial
              ? "Verranno spediti solo i prodotti preparati. Il residuo rimarrà disponibile per una spedizione successiva."
              : "Verifica i dati prima di confermare. La bozza è salvata sul server."}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3 text-sm">
          <div className="grid grid-cols-2 gap-2 rounded-md border border-slate-200 bg-slate-50 p-3">
            <div><div className="text-[10px] uppercase tracking-wider text-slate-500 font-bold">Commessa</div><div className="font-mono-tight font-semibold">#{commessa.number}</div></div>
            <div><div className="text-[10px] uppercase tracking-wider text-slate-500 font-bold">Cliente</div><div className="font-semibold truncate">{commessa.cliente}</div></div>
          </div>
          <div>
            <Label className="text-[11px] uppercase tracking-wider text-slate-600 font-bold">Data spedizione *</Label>
            <Input type="date" value={shipDate} onChange={(e) => setShipDate(e.target.value)}
              className="mt-1 h-10 font-mono-tight" data-testid="bozza-ship-date" required />
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-wider text-emerald-600 font-bold mb-1.5">✅ DA SPEDIRE ({daSpedire.length})</div>
            <ul className="divide-y divide-slate-100 border border-emerald-200 rounded-md bg-emerald-50/30 max-h-56 overflow-y-auto">
              {daSpedire.map((r, i) => (
                <li key={i} className="px-3 py-2" data-testid={`bozza-ship-riga-${i}`}>
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="font-semibold text-slate-900 truncate">{r.product_name}</div>
                      <div className="text-[11px] text-slate-500">{r.product_code} · {r.tipo_gestione === "a_seriale" ? "A Seriale" : "A Quantità"}</div>
                    </div>
                    <div className="font-mono-tight font-bold text-emerald-700 shrink-0">× {r.qty_prelevata}</div>
                  </div>
                  {r.seriali_prelevati?.length > 0 && (
                    <div className="mt-1 text-[11px] font-mono-tight text-slate-600 break-all bg-white/60 rounded px-2 py-1">
                      Seriale: {r.seriali_prelevati.join(", ")}
                    </div>
                  )}
                </li>
              ))}
            </ul>
          </div>
          {isPartial && (
            <div>
              <div className="text-[10px] uppercase tracking-wider text-amber-700 font-bold mb-1.5">⏳ NON SPEDITO ({nonSpedito.length}) — rimane in commessa</div>
              <ul className="divide-y divide-slate-100 border border-amber-200 rounded-md bg-amber-50/30 max-h-40 overflow-y-auto">
                {nonSpedito.map((r, i) => (
                  <li key={i} className="px-3 py-2 flex items-center justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="font-semibold text-slate-900 truncate">{r.product_name}</div>
                      <div className="text-[11px] text-slate-500">{r.product_code}</div>
                    </div>
                    <div className="font-mono-tight font-bold text-amber-700 shrink-0">× {r.qty_richiesta}</div>
                  </li>
                ))}
              </ul>
            </div>
          )}
          <div className="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded p-2">
            ⚠️ Notion verrà aggiornato SOLO con i prodotti "DA SPEDIRE". Il residuo resta disponibile per una futura spedizione.
          </div>
        </div>
        <DialogFooter className="flex-col-reverse sm:flex-row gap-2">
          <Button variant="outline" onClick={onCancel} disabled={busy} className="w-full sm:w-auto" data-testid="bozza-close">Chiudi</Button>
          <Button variant="outline" onClick={onCancelDraft} disabled={busy}
            className="w-full sm:w-auto text-red-700 border-red-300 hover:bg-red-50"
            data-testid="bozza-cancel">
            <XCircle size={16} /> Annulla bozza
          </Button>
          <Button onClick={() => onConfirm({ shipping_date: shipDate })} disabled={busy || !shipDate || daSpedire.length === 0}
            className={`w-full sm:w-auto text-white ${isPartial ? "bg-amber-600 hover:bg-amber-700" : "bg-emerald-600 hover:bg-emerald-700"}`}
            data-testid="bozza-confirm">
            <CheckCircle size={16} /> {busy ? "Invio…" : (isPartial ? "Conferma spedizione parziale" : "Conferma spedizione")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}


// F27 — Dialog di modifica completa commessa con conferma diff + validazione lato client.
function CommessaEditDialog({ commessa, onClose, onSaved }) {
  const [form, setForm] = useState({
    number: commessa.number,
    cliente: commessa.cliente,
    data_ordine: commessa.data_ordine || "",
    data_prevista: commessa.data_prevista || "",
    priorita: commessa.priorita || "normale",
    note: commessa.note || "",
  });
  const [righe, setRighe] = useState(() => (commessa.righe || []).map((r) => ({ ...r })));
  const [pickerOpen, setPickerOpen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [cliSuggestions, setCliSuggestions] = useState([]);
  const [cliOpen, setCliOpen] = useState(false);
  const [cliLoading, setCliLoading] = useState(false);

  const searchCliente = (v) => {
    setForm((f) => ({ ...f, cliente: v }));
    setCliOpen(true);
    if (window.__cmEditCli) clearTimeout(window.__cmEditCli);
    window.__cmEditCli = setTimeout(async () => {
      const q = (v || "").trim();
      if (q.length < 2) { setCliSuggestions([]); return; }
      setCliLoading(true);
      try {
        const { data } = await axios.get(`${API}/orders/search`, { params: { q, limit: 20 } });
        setCliSuggestions(data.items || []);
      } catch { setCliSuggestions([]); }
      finally { setCliLoading(false); }
    }, 220);
  };

  const addRiga = (p) => {
    // Verifica che il prodotto non sia già presente
    if (righe.some((r) => r.product_page_id === (p.page_id || p.id))) {
      toast.error("Prodotto già presente nella commessa");
      return;
    }
    setRighe((r) => [...r, {
      product_page_id: p.page_id || p.id, product_name: p.name, product_code: p.code,
      tipo_gestione: p.tipo_gestione, qty_richiesta: 1,
      qty_prelevata: 0, seriali_prelevati: [],
    }]);
    setPickerOpen(false);
  };
  const removeRiga = (i) => {
    const r = righe[i];
    if ((r.qty_prelevata || 0) > 0 || (r.seriali_prelevati || []).length > 0) {
      toast.error("Prodotto con prelievi", { description: "Non puoi rimuovere una riga con materiale già preparato" });
      return;
    }
    setRighe(righe.filter((_, j) => j !== i));
  };

  // Calcolo diff per popup conferma
  const diff = useMemo(() => {
    const d = {};
    for (const k of ["number", "cliente", "data_ordine", "data_prevista", "priorita", "note"]) {
      if ((commessa[k] || "") !== (form[k] || "")) d[k] = { before: commessa[k] || "—", after: form[k] || "—" };
    }
    const oldByPid = Object.fromEntries((commessa.righe || []).map((r) => [r.product_page_id, r]));
    const newByPid = Object.fromEntries(righe.map((r) => [r.product_page_id, r]));
    const added = righe.filter((r) => !oldByPid[r.product_page_id]);
    const removed = (commessa.righe || []).filter((r) => !newByPid[r.product_page_id]);
    const changed = righe.filter((r) => oldByPid[r.product_page_id] && Number(oldByPid[r.product_page_id].qty_richiesta) !== Number(r.qty_richiesta))
      .map((r) => ({ product_name: r.product_name, before: oldByPid[r.product_page_id].qty_richiesta, after: r.qty_richiesta }));
    if (added.length || removed.length || changed.length) d.righe = { added, removed, changed };
    return d;
  }, [commessa, form, righe]);

  const hasChanges = Object.keys(diff).length > 0;

  const submit = async () => {
    if (!hasChanges) { toast.info("Nessuna modifica da salvare"); return; }
    setSaving(true);
    try {
      const payload = { ...form, righe: righe.map(({ qty_prelevata, seriali_prelevati, ...rest }) => rest) };
      const { data } = await axios.patch(`${API}/commesse/${commessa.id}`, payload);
      onSaved(data);
    } catch (e) {
      toast.error("Salvataggio bloccato", { description: e?.response?.data?.detail || e.message });
    } finally { setSaving(false); setConfirmOpen(false); }
  };

  return (
    <Dialog open={true} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-2xl w-[95vw] max-h-[90vh] overflow-y-auto" data-testid="edit-commessa-dialog">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><PencilSimple size={20} /> Modifica commessa #{commessa.number}</DialogTitle>
          <DialogDescription>Stato attuale: <b>{STATO_LABEL[commessa.stato]?.txt}</b>. Le regole di modifica dipendono dallo stato.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div><Label>Numero</Label><Input value={form.number} onChange={(e) => setForm({ ...form, number: e.target.value })} className="mt-1" data-testid="edit-number" /></div>
            <div>
              <Label>Cliente</Label>
              <div className="relative mt-1">
                <Input value={form.cliente} onChange={(e) => searchCliente(e.target.value)}
                  onFocus={() => form.cliente.trim().length >= 2 && setCliOpen(true)}
                  onBlur={() => setTimeout(() => setCliOpen(false), 180)}
                  autoComplete="off" data-testid="edit-cliente" />
                {cliOpen && form.cliente.trim().length >= 2 && (
                  <div className="absolute z-40 left-0 right-0 mt-1 bg-white border border-slate-200 rounded-md shadow-xl max-h-56 overflow-auto">
                    {cliLoading && <div className="px-3 py-2 text-xs text-slate-400">Cerco…</div>}
                    {!cliLoading && cliSuggestions.length === 0 && <div className="px-3 py-2 text-xs text-slate-500">Nessun cliente trovato</div>}
                    {cliSuggestions.map((s) => (
                      <button key={s.id} type="button"
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => { setForm((f) => ({ ...f, cliente: s.structure })); setCliOpen(false); }}
                        className="w-full text-left px-3 py-2 hover:bg-indigo-50 border-b border-slate-100 last:border-0">
                        <div className="text-sm font-semibold truncate">{s.structure}</div>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
            <div><Label>Data ordine</Label><Input type="date" value={form.data_ordine} onChange={(e) => setForm({ ...form, data_ordine: e.target.value })} className="mt-1" /></div>
            <div><Label>Data di spedizione prevista</Label><Input type="date" value={form.data_prevista} onChange={(e) => setForm({ ...form, data_prevista: e.target.value })} className="mt-1" /></div>
            <div><Label>Priorità</Label>
              <select value={form.priorita} onChange={(e) => setForm({ ...form, priorita: e.target.value })}
                className="mt-1 h-10 w-full border border-slate-300 rounded-md px-2 text-sm bg-white">
                <option value="urgente">🔴 Urgente</option><option value="alta">🟠 Alta</option>
                <option value="normale">🟡 Normale</option><option value="bassa">🟢 Bassa</option>
              </select>
            </div>
            <div className="sm:col-span-2"><Label>Note</Label><Textarea value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} rows={2} className="mt-1" /></div>
          </div>
          <div className="border-t pt-3">
            <div className="flex items-center gap-2 mb-2">
              <h3 className="font-bold text-slate-800 flex-1">Materiale richiesto</h3>
              <Button size="sm" onClick={() => setPickerOpen(true)} data-testid="edit-add-riga"><Plus size={14} /> Aggiungi prodotto</Button>
            </div>
            <div className="space-y-2">
              {righe.map((r, i) => {
                const hasPicks = (Number(r.qty_prelevata) || 0) > 0 || (r.seriali_prelevati || []).length > 0;
                return (
                  <div key={r.product_page_id} className={`flex items-center gap-2 rounded p-2 ${hasPicks ? "bg-amber-50 border border-amber-200" : "bg-slate-50"}`}>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-semibold truncate">{r.product_name}</div>
                      <div className="text-[11px] text-slate-500">
                        {r.product_code} · {r.tipo_gestione === "a_seriale" ? "A Seriale" : "A Quantità"}
                        {hasPicks && <span className="text-amber-700 font-semibold"> · Preparati: {r.qty_prelevata}</span>}
                      </div>
                    </div>
                    <Input type="number" min={hasPicks ? r.qty_prelevata : 1} value={r.qty_richiesta}
                      onChange={(e) => {
                        const v = parseFloat(e.target.value) || 1;
                        if (hasPicks && v < r.qty_prelevata) {
                          toast.error(`Minimo ${r.qty_prelevata} (già preparati)`);
                          return;
                        }
                        setRighe(righe.map((rr, j) => j === i ? { ...rr, qty_richiesta: v } : rr));
                      }}
                      className="w-20 h-9" data-testid={`edit-qty-${i}`} />
                    <Button size="sm" variant="ghost" onClick={() => removeRiga(i)} disabled={hasPicks} title={hasPicks ? "Non rimovibile: ha prelievi" : "Rimuovi"}>
                      <Trash size={14} className={hasPicks ? "text-slate-300" : "text-red-600"} />
                    </Button>
                  </div>
                );
              })}
              {righe.length === 0 && <div className="text-sm text-slate-500 italic py-2">Aggiungi almeno un prodotto…</div>}
            </div>
          </div>
        </div>
        <DialogFooter className="flex-col-reverse sm:flex-row gap-2">
          <Button variant="outline" onClick={onClose} disabled={saving} className="w-full sm:w-auto">Chiudi</Button>
          <Button onClick={() => setConfirmOpen(true)} disabled={saving || !hasChanges || righe.length === 0}
            className="w-full sm:w-auto bg-indigo-600 hover:bg-indigo-700 text-white" data-testid="edit-save-btn">
            {hasChanges ? "Salva modifiche…" : "Nessuna modifica"}
          </Button>
        </DialogFooter>
        {pickerOpen && <ProductPicker onClose={() => setPickerOpen(false)} onPick={addRiga} />}
        {confirmOpen && (
          <Dialog open={true} onOpenChange={(v) => !v && setConfirmOpen(false)}>
            <DialogContent className="max-w-md w-[95vw]" data-testid="edit-confirm-dialog">
              <DialogHeader>
                <DialogTitle>Conferma modifica Commessa</DialogTitle>
                <DialogDescription>Verifica le modifiche prima di applicarle definitivamente.</DialogDescription>
              </DialogHeader>
              <div className="space-y-2 text-sm max-h-80 overflow-y-auto">
                {Object.entries(diff).filter(([k]) => k !== "righe").map(([k, v]) => (
                  <div key={k} className="border-l-2 border-indigo-300 pl-2">
                    <div className="text-[10px] uppercase text-slate-500 font-bold">{k}</div>
                    <div className="text-xs"><span className="text-red-600 line-through">{String(v.before)}</span> → <span className="text-emerald-700 font-semibold">{String(v.after)}</span></div>
                  </div>
                ))}
                {diff.righe && (
                  <div className="border-l-2 border-indigo-300 pl-2 space-y-1">
                    <div className="text-[10px] uppercase text-slate-500 font-bold">Righe materiale</div>
                    {diff.righe.added.map((r, i) => <div key={`a${i}`} className="text-xs text-emerald-700">+ {r.product_name} × {r.qty_richiesta}</div>)}
                    {diff.righe.removed.map((r, i) => <div key={`r${i}`} className="text-xs text-red-700">− {r.product_name} × {r.qty_richiesta}</div>)}
                    {diff.righe.changed.map((r, i) => <div key={`c${i}`} className="text-xs">≠ {r.product_name}: <span className="line-through text-red-600">{r.before}</span> → <span className="text-emerald-700 font-semibold">{r.after}</span></div>)}
                  </div>
                )}
              </div>
              <DialogFooter className="flex-col-reverse sm:flex-row gap-2">
                <Button variant="outline" onClick={() => setConfirmOpen(false)} disabled={saving}>Annulla</Button>
                <Button onClick={submit} disabled={saving} className="bg-indigo-600 hover:bg-indigo-700 text-white" data-testid="edit-confirm-btn">
                  {saving ? "Salvo…" : "Conferma modifiche"}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        )}
      </DialogContent>
    </Dialog>
  );
}
