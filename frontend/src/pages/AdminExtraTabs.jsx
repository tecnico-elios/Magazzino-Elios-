import { useEffect, useMemo, useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { Badge } from "../components/ui/badge";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from "../components/ui/dialog";
import {
  ClockCounterClockwise, MagnifyingGlass, Warning, Broom, Gear, ListMagnifyingGlass, Trash, ArrowClockwise,
} from "@phosphor-icons/react";

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

function formatError(err) {
  const d = err?.response?.data?.detail;
  if (typeof d === "string") return d;
  if (Array.isArray(d)) return d.map((e) => e?.msg || JSON.stringify(e)).join(" • ");
  return err?.message || "Errore";
}

const fmtDate = (v) => {
  if (!v) return "—";
  try { return new Date(v).toLocaleString("it-IT"); } catch { return v; }
};

// ---------- Audit Log ----------
export function AuditLogTab() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const load = async () => {
    setLoading(true);
    try {
      const { data } = await axios.get(`${API}/admin/audit-logs`);
      setItems(data.items || []);
    } catch (e) { toast.error("Errore audit log", { description: formatError(e) }); }
    finally { setLoading(false); }
  };
  useEffect(() => { load(); }, []);

  return (
    <div className="space-y-3" data-testid="audit-log-tab">
      <div className="flex items-center justify-between">
        <div className="text-xs uppercase tracking-wider text-slate-500">{items.length} eventi</div>
        <Button variant="outline" size="sm" onClick={load} disabled={loading} data-testid="reload-audit-btn">
          <ArrowClockwise size={14} className={loading ? "animate-spin" : ""} />
        </Button>
      </div>
      <div className="bg-white border border-slate-200 rounded-md overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-slate-500 text-xs uppercase tracking-wider">
            <tr>
              <th className="text-left px-3 py-2">Quando</th>
              <th className="text-left px-3 py-2">Attore</th>
              <th className="text-left px-3 py-2">Azione</th>
              <th className="text-left px-3 py-2">Dettaglio</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {items.map((r) => (
              <tr key={r._id} data-testid={`audit-row-${r._id}`}>
                <td className="px-3 py-2 font-mono-tight text-xs text-slate-500">{fmtDate(r.at)}</td>
                <td className="px-3 py-2 font-mono-tight text-slate-800">@{r.actor_username || "—"}</td>
                <td className="px-3 py-2">
                  <Badge variant="outline" className="border-slate-300 font-mono-tight text-xs">
                    {r.action}
                  </Badge>
                </td>
                <td className="px-3 py-2 text-xs text-slate-600">
                  {r.meta && Object.keys(r.meta).length > 0
                    ? JSON.stringify(r.meta)
                    : <span className="text-slate-400">—</span>}
                </td>
              </tr>
            ))}
            {items.length === 0 && !loading && (
              <tr><td colSpan={4} className="px-3 py-6 text-center text-slate-400">Nessun evento.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ---------- Impostazioni ----------
export function SettingsTab() {
  const [s, setS] = useState(null);
  const [saving, setSaving] = useState(false);
  const load = async () => {
    try {
      const { data } = await axios.get(`${API}/admin/settings`);
      setS(data);
    } catch (e) { toast.error("Errore", { description: formatError(e) }); }
  };
  useEffect(() => { load(); }, []);
  if (!s) return <div className="text-slate-500">Caricamento…</div>;

  const save = async () => {
    setSaving(true);
    try {
      const { data } = await axios.put(`${API}/admin/settings`, s);
      setS(data);
      toast.success("Impostazioni salvate");
    } catch (e) { toast.error("Salvataggio fallito", { description: formatError(e) }); }
    finally { setSaving(false); }
  };

  return (
    <div className="space-y-4 max-w-lg" data-testid="settings-tab">
      <div>
        <Label className="text-sm font-semibold">Soglia sotto-scorta</Label>
        <div className="text-[11px] text-slate-500 mb-1">Prodotti con giacenza ≤ soglia (e &gt; 0) sono "sotto scorta".</div>
        <Input type="number" min={0} max={1000} value={s.low_stock_threshold}
          onChange={(e) => setS({ ...s, low_stock_threshold: parseInt(e.target.value || "0", 10) })}
          className="h-11" data-testid="setting-low-stock" />
      </div>
      <div>
        <Label className="text-sm font-semibold">Prefisso dati di test</Label>
        <div className="text-[11px] text-slate-500 mb-1">Usato dal Cleanup per identificare dati fittizi.</div>
        <Input value={s.test_prefix}
          onChange={(e) => setS({ ...s, test_prefix: e.target.value })}
          className="h-11 font-mono-tight" data-testid="setting-test-prefix" />
      </div>
      <div>
        <Label className="text-sm font-semibold">Durata feedback scanner (secondi)</Label>
        <Input type="number" min={1} max={30} value={s.feedback_seconds}
          onChange={(e) => setS({ ...s, feedback_seconds: parseInt(e.target.value || "3", 10) })}
          className="h-11" data-testid="setting-feedback-seconds" />
      </div>
      <Button onClick={save} disabled={saving} className="h-11 et-btn-primary border-0" data-testid="save-settings-btn">
        {saving ? "Salvo…" : "Salva impostazioni"}
      </Button>
    </div>
  );
}

// ---------- Cleanup TEST_ ----------
export function CleanupTestTab() {
  const [preview, setPreview] = useState(null);
  const [prefix, setPrefix] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const doPreview = async () => {
    setBusy(true);
    try {
      const params = {};
      if (prefix.trim()) params.prefix = prefix.trim();
      const { data } = await axios.get(`${API}/admin/cleanup-test-data`, { params });
      setPreview(data);
    } catch (e) { toast.error("Preview fallita", { description: formatError(e) }); }
    finally { setBusy(false); }
  };

  const doDelete = async () => {
    setBusy(true);
    try {
      const { data } = await axios.post(`${API}/admin/cleanup-test-data`, {
        confirm: true, prefix: prefix.trim() || undefined,
      });
      toast.success(`Cancellati ${data.checklists_deleted + data.arrivi_deleted + data.anomalies_deleted} record`);
      setPreview(null);
      setConfirmOpen(false);
    } catch (e) { toast.error("Cleanup fallito", { description: formatError(e) }); }
    finally { setBusy(false); }
  };

  return (
    <div className="space-y-4" data-testid="cleanup-test-tab">
      <div className="text-sm text-slate-600 bg-amber-50 border-l-2 border-amber-400 p-3 rounded-sm">
        Il cleanup elimina SOLO record locali (spedizioni/arrivi/anomalie) il cui cliente / operatore /
        fornitore inizia con il prefisso. <strong>Notion NON viene toccato mai.</strong>
      </div>
      <div className="flex gap-2 items-end">
        <div className="flex-1">
          <Label className="text-sm font-semibold">Prefisso (lascia vuoto per usare l'impostazione)</Label>
          <Input value={prefix} onChange={(e) => setPrefix(e.target.value)} className="h-11 font-mono-tight mt-1"
            placeholder="TEST_" data-testid="cleanup-prefix-input" />
        </div>
        <Button onClick={doPreview} disabled={busy} className="h-11 et-btn-primary border-0" data-testid="cleanup-preview-btn">
          {busy ? "…" : "Anteprima"}
        </Button>
      </div>
      {preview && (
        <div className="bg-white border border-slate-200 rounded-md p-4 space-y-2" data-testid="cleanup-preview">
          <div className="text-xs uppercase tracking-wider text-slate-500">
            Prefisso attivo: <span className="font-mono-tight text-slate-900">{preview.prefix}</span>
          </div>
          <div className="grid grid-cols-3 gap-3 text-sm">
            <div className="border border-slate-200 rounded p-3">
              <div className="text-xs text-slate-500">Spedizioni</div>
              <div className="font-display text-2xl">{preview.checklists.length}</div>
            </div>
            <div className="border border-slate-200 rounded p-3">
              <div className="text-xs text-slate-500">Arrivi</div>
              <div className="font-display text-2xl">{preview.arrivi.length}</div>
            </div>
            <div className="border border-slate-200 rounded p-3">
              <div className="text-xs text-slate-500">Anomalie</div>
              <div className="font-display text-2xl">{preview.anomalies.length}</div>
            </div>
          </div>
          {preview.total > 0 ? (
            <Button onClick={() => setConfirmOpen(true)} className="h-11 bg-red-600 hover:bg-red-700 text-white" data-testid="cleanup-execute-btn">
              <Trash size={16} className="mr-1" /> Elimina {preview.total} record
            </Button>
          ) : (
            <div className="text-sm text-slate-500">Nessun record da eliminare.</div>
          )}
        </div>
      )}
      <Dialog open={confirmOpen} onOpenChange={(v) => !v && setConfirmOpen(false)}>
        <DialogContent data-testid="cleanup-confirm-dialog">
          <DialogHeader>
            <DialogTitle>Conferma eliminazione</DialogTitle>
            <DialogDescription>
              Verranno eliminati <strong>{preview?.total ?? 0}</strong> record che corrispondono al prefisso{" "}
              <span className="font-mono-tight">{preview?.prefix}</span>. Notion non sarà toccato. Confermi?
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmOpen(false)}>Annulla</Button>
            <Button onClick={doDelete} disabled={busy} className="bg-red-600 hover:bg-red-700 text-white" data-testid="cleanup-confirm-btn">
              {busy ? "Elimino…" : "Sì, elimina"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ---------- Storico Seriali ----------
export function SerialHistoryTab() {
  const [sn, setSn] = useState("");
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);

  const search = async () => {
    if (!sn.trim()) return;
    setBusy(true);
    try {
      const { data } = await axios.get(`${API}/admin/serial-history/${encodeURIComponent(sn.trim())}`);
      setResult(data);
    } catch (e) { toast.error("Errore", { description: formatError(e) }); }
    finally { setBusy(false); }
  };

  return (
    <div className="space-y-4" data-testid="serial-history-tab">
      <div className="flex gap-2 items-end max-w-lg">
        <div className="flex-1">
          <Label className="text-sm font-semibold">Seriale</Label>
          <Input value={sn} onChange={(e) => setSn(e.target.value)} placeholder="es. 1384516"
            className="h-11 font-mono-tight mt-1" onKeyDown={(e) => e.key === "Enter" && search()}
            data-testid="serial-history-input" />
        </div>
        <Button onClick={search} disabled={busy || !sn.trim()} className="h-11 et-btn-primary border-0" data-testid="serial-history-search-btn">
          <MagnifyingGlass size={16} className="mr-1" /> Cerca
        </Button>
      </div>
      {result && (
        <div className="bg-white border border-slate-200 rounded-md p-4 space-y-3" data-testid="serial-history-result">
          <div>
            <span className="text-xs uppercase tracking-wider text-slate-500">SN</span>{" "}
            <span className="font-mono-tight text-slate-900 font-semibold">{result.sn}</span>
          </div>
          <div>
            <span className="text-xs uppercase tracking-wider text-slate-500">Stato attuale</span>{" "}
            <Badge variant="outline" className={
              result.status === "in_warehouse" ? "border-emerald-300 text-emerald-800 bg-emerald-50"
              : result.status === "out" ? "border-blue-300 text-blue-800 bg-blue-50"
              : "border-slate-300 text-slate-500"
            }>
              {result.status}
            </Badge>
          </div>
          {result.last_entrata && (
            <div className="border-l-2 border-emerald-400 pl-3 text-sm">
              <div className="text-xs uppercase text-emerald-700 tracking-wider font-semibold">Ultima entrata</div>
              <div className="font-mono-tight text-slate-700">Data: {result.last_entrata.date || "—"}</div>
            </div>
          )}
          {result.last_uscita && (
            <div className="border-l-2 border-blue-400 pl-3 text-sm">
              <div className="text-xs uppercase text-blue-700 tracking-wider font-semibold">Ultima uscita</div>
              <div className="font-mono-tight text-slate-700">Data: {result.last_uscita.date || "—"}</div>
              <div className="text-slate-700">Cliente: {result.last_uscita.cliente || "—"}</div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ---------- Ricerca globale ----------
export function GlobalSearchTab() {
  const [q, setQ] = useState("");
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);

  const search = async () => {
    if (!q.trim()) return;
    setBusy(true);
    try {
      const { data } = await axios.get(`${API}/admin/global-search`, { params: { q: q.trim() } });
      setResult(data);
    } catch (e) { toast.error("Errore", { description: formatError(e) }); }
    finally { setBusy(false); }
  };

  return (
    <div className="space-y-4" data-testid="global-search-tab">
      <div className="flex gap-2 items-end max-w-2xl">
        <div className="flex-1">
          <Label className="text-sm font-semibold">Cerca ovunque</Label>
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="prodotto, cliente, seriale, operatore…"
            className="h-11 mt-1" onKeyDown={(e) => e.key === "Enter" && search()}
            data-testid="global-search-input" />
        </div>
        <Button onClick={search} disabled={busy || !q.trim()} className="h-11 et-btn-primary border-0" data-testid="global-search-btn">
          <MagnifyingGlass size={16} className="mr-1" /> Cerca
        </Button>
      </div>
      {result && (
        <div className="space-y-4" data-testid="global-search-result">
          <div>
            <div className="text-xs uppercase tracking-wider text-slate-500 mb-1">
              Prodotti ({result.products.length})
            </div>
            {result.products.length === 0 ? <div className="text-slate-400 text-sm">—</div> : (
              <ul className="border border-slate-200 rounded bg-white divide-y divide-slate-100">
                {result.products.map((p) => (
                  <li key={p.id} className="px-3 py-2 flex items-center justify-between" data-testid={`gs-product-${p.id}`}>
                    <div>
                      <div className="font-semibold text-slate-900">{p.name}</div>
                      <div className="text-xs text-slate-500 font-mono-tight">{p.code} · {p.category || "—"}</div>
                    </div>
                    <div className="font-mono-tight text-sm">{p.quantity} {p.unit}</div>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div>
            <div className="text-xs uppercase tracking-wider text-slate-500 mb-1">
              Spedizioni App ({result.checklists.length})
            </div>
            {result.checklists.length === 0 ? <div className="text-slate-400 text-sm">—</div> : (
              <ul className="border border-slate-200 rounded bg-white divide-y divide-slate-100">
                {result.checklists.map((c) => (
                  <li key={c.id} className="px-3 py-2" data-testid={`gs-checklist-${c.id}`}>
                    <div className="font-semibold text-slate-900">Cliente: {c.structure}</div>
                    <div className="text-xs text-slate-500">Op: {c.operator} · {c.shipping_date}</div>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div>
            <div className="text-xs uppercase tracking-wider text-slate-500 mb-1">
              Arrivi App ({result.arrivi.length})
            </div>
            {result.arrivi.length === 0 ? <div className="text-slate-400 text-sm">—</div> : (
              <ul className="border border-slate-200 rounded bg-white divide-y divide-slate-100">
                {result.arrivi.map((a) => (
                  <li key={a.id} className="px-3 py-2" data-testid={`gs-arrivo-${a.id}`}>
                    <div className="font-semibold text-slate-900">Fornitore: {a.fornitore}</div>
                    <div className="text-xs text-slate-500">Op: {a.operator} · {a.arrival_date}</div>
                  </li>
                ))}
              </ul>
            )}
          </div>
          {result.serial_status && (
            <div className="border border-blue-200 bg-blue-50 rounded p-3" data-testid="gs-serial">
              <div className="text-xs uppercase tracking-wider text-blue-700 font-semibold">Seriale trovato</div>
              <div className="text-sm mt-1">
                Status: <Badge variant="outline">{result.serial_status.status}</Badge>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
