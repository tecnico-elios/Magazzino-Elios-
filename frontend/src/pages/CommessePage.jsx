import { useEffect, useMemo, useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { Package, Plus, ArrowLeft, QrCode, Trash, CheckCircle, Truck, XCircle, User, Clock } from "@phosphor-icons/react";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { Textarea } from "../components/ui/textarea";
import { Badge } from "../components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "../components/ui/dialog";
import { normalizeQrCode, parseDazeQr } from "../lib/qr";
import BarcodeScanner from "../components/BarcodeScanner";

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

const STATO_LABEL = {
  da_preparare: { txt: "Da preparare", cls: "bg-red-100 text-red-800 border-red-200", icon: "🔴" },
  in_preparazione: { txt: "In preparazione", cls: "bg-yellow-100 text-yellow-800 border-yellow-200", icon: "🟡" },
  parziale: { txt: "Parziale", cls: "bg-orange-100 text-orange-800 border-orange-200", icon: "🟠" },
  pronta: { txt: "Pronta", cls: "bg-emerald-100 text-emerald-800 border-emerald-200", icon: "🟢" },
  spedita: { txt: "Spedita", cls: "bg-slate-200 text-slate-700 border-slate-300", icon: "🚚" },
  annullata: { txt: "Annullata", cls: "bg-slate-100 text-slate-500 border-slate-200", icon: "⚪" },
};
const PRIO_LABEL = {
  urgente: { txt: "Urgente", cls: "bg-red-500 text-white", icon: "🔴" },
  alta: { txt: "Alta", cls: "bg-orange-500 text-white", icon: "🟠" },
  normale: { txt: "Normale", cls: "bg-yellow-400 text-slate-900", icon: "🟡" },
  bassa: { txt: "Bassa", cls: "bg-emerald-400 text-slate-900", icon: "🟢" },
};

export default function CommessePage() {
  const [selected, setSelected] = useState(null);
  const [creating, setCreating] = useState(false);
  return (
    <div className="max-w-6xl mx-auto px-2 py-3 sm:px-4 sm:py-6" data-testid="commesse-page">
      {selected ? (
        <CommessaDetail id={selected} onBack={() => setSelected(null)} />
      ) : creating ? (
        <CommessaCreate onDone={(id) => { setCreating(false); if (id) setSelected(id); }} />
      ) : (
        <CommesseList onOpen={setSelected} onCreate={() => setCreating(true)} />
      )}
    </div>
  );
}

function CommesseList({ onOpen, onCreate }) {
  const [items, setItems] = useState([]);
  const [kpi, setKpi] = useState({});
  const [loading, setLoading] = useState(true);
  const [filterStato, setFilterStato] = useState("");
  const load = () => {
    setLoading(true);
    axios.get(`${API}/commesse`, { params: filterStato ? { stato: filterStato } : {} })
      .then(({ data }) => { setItems(data.items || []); setKpi(data.kpi || {}); })
      .catch((e) => toast.error("Errore caricamento", { description: e?.response?.data?.detail }))
      .finally(() => setLoading(false));
  };
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [filterStato]);
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 flex-wrap">
        <h1 className="font-display text-xl sm:text-2xl font-black text-slate-900 flex items-center gap-2 flex-1"><Package weight="duotone" size={28} /> Commesse</h1>
        <Button onClick={onCreate} className="bg-indigo-600 hover:bg-indigo-700 text-white" data-testid="commessa-new-btn"><Plus size={16} /> Nuova</Button>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        {["da_preparare", "in_preparazione", "parziale", "pronta"].map((s) => (
          <button key={s} onClick={() => setFilterStato(filterStato === s ? "" : s)}
            className={`et-card p-3 text-left ${filterStato === s ? "ring-2 ring-indigo-500" : ""}`}
            data-testid={`kpi-${s}`}>
            <div className="text-xs text-slate-500">{STATO_LABEL[s].icon} {STATO_LABEL[s].txt}</div>
            <div className="text-2xl font-black text-slate-900">{kpi[s] ?? 0}</div>
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
                {c.data_prevista && <span>📅 {c.data_prevista}</span>}
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
  const submit = async () => {
    if (!form.number.trim() || !form.cliente.trim() || righe.length === 0) {
      toast.error("Numero, cliente e almeno una riga sono obbligatori"); return;
    }
    setSaving(true);
    try {
      const { data } = await axios.post(`${API}/commesse`, { ...form, righe });
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
          <div><Label>Cliente *</Label><Input value={form.cliente} onChange={(e) => setForm({ ...form, cliente: e.target.value })} className="mt-1" data-testid="new-cliente" /></div>
          <div><Label>Data ordine</Label><Input type="date" value={form.data_ordine} onChange={(e) => setForm({ ...form, data_ordine: e.target.value })} className="mt-1" /></div>
          <div><Label>Data prevista</Label><Input type="date" value={form.data_prevista} onChange={(e) => setForm({ ...form, data_prevista: e.target.value })} className="mt-1" /></div>
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
  const [c, setC] = useState(null);
  const [loading, setLoading] = useState(true);
  const [scannerOpen, setScannerOpen] = useState(false);
  const [scanRigaIdx, setScanRigaIdx] = useState(null);
  const [confirmComplete, setConfirmComplete] = useState(false);
  const [confirmShip, setConfirmShip] = useState(false);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = () => {
    setLoading(true);
    axios.get(`${API}/commesse/${id}`).then(({ data }) => setC(data)).catch(() => toast.error("Commessa non trovata")).finally(() => setLoading(false));
  };
  useEffect(load, [id]);

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
    try { const { data } = await axios.post(`${API}/commesse/${id}/pick`, { riga_index: idx, serial }); setC(data); toast.success(`Prelevato ${serial}`); }
    catch (e) { toast.error("Seriale non valido", { description: e?.response?.data?.detail }); }
    finally { setBusy(false); }
  };
  const doComplete = async () => {
    setBusy(true);
    try { const { data } = await axios.post(`${API}/commesse/${id}/complete`); setC(data); setConfirmComplete(false); toast.success("Commessa pronta per spedizione"); }
    catch (e) { toast.error("Errore", { description: e?.response?.data?.detail }); }
    finally { setBusy(false); }
  };
  const doShip = async () => {
    setBusy(true);
    try { const { data } = await axios.post(`${API}/commesse/${id}/ship`); setC(data.commessa); setConfirmShip(false);
      toast.success("Spedizione creata", { description: data.shipment?.message });
      if (data.shipment?.inventory_warnings?.length) toast.warning("Attenzione Inventario", { description: data.shipment.inventory_warnings.join(" · "), duration: 15000 });
    } catch (e) { toast.error("Spedizione fallita", { description: e?.response?.data?.detail }); }
    finally { setBusy(false); }
  };
  const doCancel = async () => {
    setBusy(true);
    try { const { data } = await axios.post(`${API}/commesse/${id}/cancel`); setC(data); setConfirmCancel(false); toast.success("Commessa annullata"); }
    catch (e) { toast.error("Errore", { description: e?.response?.data?.detail }); }
    finally { setBusy(false); }
  };

  if (loading || !c) return <div className="text-center py-8 text-slate-500">Caricamento…</div>;
  const canTake = c.stato === "da_preparare";
  const canPick = ["in_preparazione", "parziale"].includes(c.stato);
  const totalQty = (c.righe || []).reduce((s, r) => s + (r.qty_richiesta || 0), 0);
  const pickedQty = (c.righe || []).reduce((s, r) => s + (r.qty_prelevata || 0), 0);
  const canComplete = totalQty > 0 && pickedQty >= totalQty && ["in_preparazione", "parziale"].includes(c.stato);
  const canShip = c.stato === "pronta";
  const canCancel = !["spedita", "annullata"].includes(c.stato);

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
        {c.data_prevista && <div className="text-xs text-slate-600"><Clock size={12} className="inline" /> Prevista: {c.data_prevista}</div>}
        {c.note && <div className="text-xs text-slate-600 whitespace-pre-wrap break-words">📝 {c.note}</div>}
        <div className="text-xs text-slate-500 font-mono-tight">op: {c.operation_id}</div>
      </div>

      {canTake && <Button onClick={doTake} disabled={busy} className="w-full bg-indigo-600 hover:bg-indigo-700 text-white h-12" data-testid="take-btn">Prendi in carico</Button>}

      <div className="space-y-2">
        {(c.righe || []).map((r, i) => {
          const done = r.qty_prelevata >= r.qty_richiesta;
          return (
            <div key={i} className={`et-card p-3 ${done ? "border-emerald-300 bg-emerald-50/30" : ""}`} data-testid={`riga-${i}`}>
              <div className="flex items-start gap-2 flex-wrap">
                <div className="flex-1 min-w-0">
                  <div className="font-bold text-slate-900 break-words">{r.product_name}</div>
                  <div className="text-xs text-slate-500">{r.product_code} · {r.tipo_gestione === "a_seriale" ? "A Seriale" : "A Quantità"}</div>
                </div>
                <div className={`text-lg font-black font-mono-tight shrink-0 ${done ? "text-emerald-600" : "text-slate-800"}`}>
                  {r.qty_prelevata}/{r.qty_richiesta}
                </div>
              </div>
              {canPick && !done && r.tipo_gestione === "a_quantita" && (
                <div className="mt-2 flex items-center gap-2">
                  <Button size="sm" variant="outline" onClick={() => doPickQty(i, -1)} disabled={busy || r.qty_prelevata <= 0} className="h-10 w-10 p-0" data-testid={`minus-${i}`}>−</Button>
                  <div className="flex-1 text-center font-mono-tight text-lg">{r.qty_prelevata}</div>
                  <Button size="sm" onClick={() => doPickQty(i, 1)} disabled={busy || r.qty_prelevata >= r.qty_richiesta} className="h-10 w-10 p-0 bg-emerald-600 hover:bg-emerald-700 text-white" data-testid={`plus-${i}`}>+</Button>
                </div>
              )}
              {canPick && !done && r.tipo_gestione === "a_seriale" && (
                <div className="mt-2 flex flex-col sm:flex-row gap-2">
                  <SerialInput onSubmit={(sn) => doPickSerial(i, sn)} disabled={busy} testid={`sn-input-${i}`} />
                  <Button size="sm" onClick={() => { setScanRigaIdx(i); setScannerOpen(true); }} disabled={busy} className="bg-indigo-600 hover:bg-indigo-700 text-white h-10" data-testid={`scan-${i}`}>
                    <QrCode size={14} /> Scan
                  </Button>
                </div>
              )}
              {r.seriali_prelevati?.length > 0 && (
                <div className="mt-2 text-xs bg-slate-50 rounded p-2">
                  <div className="font-semibold text-slate-600 mb-1">Seriali prelevati:</div>
                  <div className="font-mono-tight break-all text-slate-800">{r.seriali_prelevati.join(", ")}</div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div className="flex flex-col sm:flex-row gap-2">
        {canComplete && <Button onClick={() => setConfirmComplete(true)} className="flex-1 bg-emerald-600 hover:bg-emerald-700 text-white h-12" data-testid="complete-btn"><CheckCircle size={16} /> Completa preparazione</Button>}
        {canShip && <Button onClick={() => setConfirmShip(true)} className="flex-1 bg-indigo-600 hover:bg-indigo-700 text-white h-12" data-testid="ship-btn"><Truck size={16} /> Crea spedizione</Button>}
        {canCancel && <Button onClick={() => setConfirmCancel(true)} variant="outline" className="text-red-700 border-red-300 hover:bg-red-50 h-12" data-testid="cancel-btn"><XCircle size={16} /> Annulla</Button>}
      </div>

      {scannerOpen && (
        <BarcodeScanner open={true} onClose={() => setScannerOpen(false)} label="Scansiona seriale"
          onDetected={(v) => { setScannerOpen(false); if (scanRigaIdx !== null) doPickSerial(scanRigaIdx, v); }} />
      )}
      {confirmComplete && (
        <ConfirmDialog title="Completa preparazione" body={`Confermi la preparazione della commessa #${c.number}? Tutti i materiali risultano prelevati.`}
          onCancel={() => setConfirmComplete(false)} onConfirm={doComplete} busy={busy} confirmLabel="Conferma" />
      )}
      {confirmShip && (
        <ConfirmDialog title="Crea spedizione" body={`La commessa #${c.number} verrà spedita al cliente ${c.cliente}. L'inventario Notion verrà aggiornato.`}
          onCancel={() => setConfirmShip(false)} onConfirm={doShip} busy={busy} confirmLabel="Conferma spedizione" />
      )}
      {confirmCancel && (
        <ConfirmDialog title="Annulla commessa" body={`Confermi l'annullamento della commessa #${c.number}? Prelievi registrati: ${pickedQty}/${totalQty}. L'operazione verrà registrata nel Registro Log.`}
          onCancel={() => setConfirmCancel(false)} onConfirm={doCancel} busy={busy} confirmLabel="Annulla commessa" danger />
      )}
    </div>
  );
}

function SerialInput({ onSubmit, disabled, testid }) {
  const [v, setV] = useState("");
  return (
    <Input value={v} onChange={(e) => setV(e.target.value)}
      onKeyDown={(e) => { if (e.key === "Enter" && v.trim()) { onSubmit(v.trim()); setV(""); } }}
      placeholder="SN…" disabled={disabled} className="h-10 flex-1 font-mono-tight" data-testid={testid} autoComplete="off" />
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
