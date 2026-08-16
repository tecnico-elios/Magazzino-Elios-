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
  ClockCounterClockwise, MagnifyingGlass, Warning, Broom, Gear, ListMagnifyingGlass, Trash, ArrowClockwise, Globe,
} from "@phosphor-icons/react";

import { fmtDateTime as fmtDate, useTz } from "../lib/tz";

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

function formatError(err) {
  const d = err?.response?.data?.detail;
  if (typeof d === "string") return d;
  if (Array.isArray(d)) return d.map((e) => e?.msg || JSON.stringify(e)).join(" • ");
  return err?.message || "Errore";
}

const fmtDateLegacy = (v) => fmtDate(v);

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

// ---------- Impostazioni (F7 esteso) ----------
function SettingSwitch({ label, hint, checked, onChange, testid }) {
  return (
    <label className="flex items-center justify-between gap-3 py-2 cursor-pointer" data-testid={testid}>
      <div className="min-w-0">
        <div className="text-sm font-semibold text-slate-800">{label}</div>
        {hint && <div className="text-[11px] text-slate-500">{hint}</div>}
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={!!checked}
        onClick={() => onChange(!checked)}
        className={`shrink-0 w-11 h-6 rounded-full transition-colors border ${
          checked ? "bg-amber-400 border-amber-500" : "bg-slate-200 border-slate-300"
        }`}
      >
        <span
          className={`block w-5 h-5 rounded-full bg-white shadow transform transition-transform ${
            checked ? "translate-x-5" : "translate-x-0"
          }`}
        />
      </button>
    </label>
  );
}

function SettingNumber({ label, hint, value, onChange, min, max, step = 1, unit, testid }) {
  return (
    <div className="py-2">
      <Label className="text-sm font-semibold text-slate-800">{label}</Label>
      {hint && <div className="text-[11px] text-slate-500 mb-1">{hint}</div>}
      <div className="flex items-center gap-2">
        <Input
          type="number"
          min={min}
          max={max}
          step={step}
          value={value ?? ""}
          onChange={(e) => onChange(parseInt(e.target.value || "0", 10))}
          className="h-11 max-w-[140px] font-mono-tight"
          data-testid={testid}
        />
        {unit && <span className="text-xs text-slate-500">{unit}</span>}
      </div>
    </div>
  );
}

function SettingsSection({ title, icon: Icon, children }) {
  return (
    <div className="et-card p-4">
      <div className="flex items-center gap-2 pb-2 border-b border-slate-100 mb-2">
        {Icon && <Icon size={16} className="text-amber-500" />}
        <div className="text-[11px] tracking-[0.18em] uppercase text-slate-600 font-semibold">{title}</div>
      </div>
      <div className="divide-y divide-slate-100">{children}</div>
    </div>
  );
}

export function SettingsTab() {
  const [s, setS] = useState(null);
  const [saving, setSaving] = useState(false);
  useTz();

  const load = async () => {
    try {
      const { data } = await axios.get(`${API}/admin/settings`);
      setS(data);
    } catch (e) { toast.error("Errore", { description: formatError(e) }); }
  };
  useEffect(() => { load(); }, []);
  if (!s) return <div className="text-slate-500">Caricamento…</div>;

  const setSection = (section, patch) => setS((prev) => ({ ...prev, [section]: { ...(prev[section] || {}), ...patch } }));

  const save = async () => {
    setSaving(true);
    try {
      const payload = {
        low_stock_threshold: s.low_stock_threshold,
        test_prefix: s.test_prefix,
        scanner: s.scanner,
        dashboard: s.dashboard,
        magazzino: s.magazzino,
        ricerca: s.ricerca,
        movimenti: s.movimenti,
        sicurezza: s.sicurezza,
        general: s.general,
      };
      const { data } = await axios.put(`${API}/admin/settings`, payload);
      setS(data);
      toast.success("Impostazioni salvate");
      if (typeof window !== "undefined") {
        window.dispatchEvent(new Event("elios:settings-changed"));
      }
    } catch (e) { toast.error("Salvataggio fallito", { description: formatError(e) }); }
    finally { setSaving(false); }
  };

  return (
    <div className="space-y-4 max-w-3xl" data-testid="settings-tab">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <SettingsSection title="Scanner" icon={ListMagnifyingGlass}>
          <SettingSwitch
            label="Focus automatico"
            hint="Riporta sempre il cursore sul campo scanner"
            checked={s.scanner?.autofocus}
            onChange={(v) => setSection("scanner", { autofocus: v })}
            testid="set-scanner-autofocus"
          />
          <SettingNumber label="Feedback verde (ms)" hint="Durata evidenza al match riuscito"
            value={s.scanner?.feedback_green_ms} min={200} max={10000} step={100} unit="ms"
            onChange={(v) => setSection("scanner", { feedback_green_ms: v })}
            testid="set-scanner-green-ms" />
          <SettingNumber label="Feedback rosso (ms)" hint="Durata evidenza in caso di errore"
            value={s.scanner?.feedback_red_ms} min={200} max={10000} step={100} unit="ms"
            onChange={(v) => setSection("scanner", { feedback_red_ms: v })}
            testid="set-scanner-red-ms" />
          <SettingSwitch label="Selezione automatica singolo risultato"
            hint="Se la ricerca trova un solo prodotto lo seleziona subito"
            checked={s.scanner?.autoselect_single_result}
            onChange={(v) => setSection("scanner", { autoselect_single_result: v })}
            testid="set-scanner-autoselect" />
          <SettingSwitch label="Suono scanner"
            hint="Beep al match riuscito (richiede audio browser abilitato)"
            checked={s.scanner?.sound_enabled}
            onChange={(v) => setSection("scanner", { sound_enabled: v })}
            testid="set-scanner-sound" />
        </SettingsSection>

        <SettingsSection title="Dashboard" icon={ArrowClockwise}>
          <SettingNumber label="Intervallo auto-refresh"
            hint="0 = disattivato. Consigliato 30-120 secondi"
            value={s.dashboard?.autorefresh_seconds} min={0} max={3600} step={5} unit="secondi"
            onChange={(v) => setSection("dashboard", { autorefresh_seconds: v })}
            testid="set-dash-autorefresh" />
          <SettingNumber label="Numero ultimi movimenti mostrati"
            hint="Nel widget 'Ultimi movimenti Notion'"
            value={s.dashboard?.recent_movements_limit} min={1} max={100} step={1} unit="movimenti"
            onChange={(v) => setSection("dashboard", { recent_movements_limit: v })}
            testid="set-dash-recent-limit" />
        </SettingsSection>

        <SettingsSection title="Magazzino" icon={Warning}>
          <SettingNumber label="Soglia minima predefinita"
            hint="Prodotti con quantità ≤ soglia (e > 0) risultano sotto scorta"
            value={s.magazzino?.low_stock_threshold ?? s.low_stock_threshold}
            min={0} max={1000} step={1} unit="pezzi"
            onChange={(v) => { setSection("magazzino", { low_stock_threshold: v }); setS((prev) => ({ ...prev, low_stock_threshold: v })); }}
            testid="set-mag-low-threshold" />
          <SettingSwitch label="Avviso sotto scorta"
            hint="Mostra badge/toast quando un prodotto scende sotto soglia"
            checked={s.magazzino?.warn_low_stock}
            onChange={(v) => setSection("magazzino", { warn_low_stock: v })}
            testid="set-mag-warn-low" />
          <SettingSwitch label="Avviso esaurito"
            hint="Mostra badge/toast quando un prodotto arriva a 0"
            checked={s.magazzino?.warn_out_of_stock}
            onChange={(v) => setSection("magazzino", { warn_out_of_stock: v })}
            testid="set-mag-warn-oos" />
        </SettingsSection>

        <SettingsSection title="Ricerca" icon={MagnifyingGlass}>
          <SettingSwitch label="Ricerca durante digitazione"
            hint="Filtra la lista mentre digiti (usa sempre la cache locale F6)"
            checked={s.ricerca?.search_on_type}
            onChange={(v) => setSection("ricerca", { search_on_type: v })}
            testid="set-ric-live" />
          <SettingNumber label="Numero massimo risultati"
            value={s.ricerca?.max_results} min={1} max={200} step={5} unit="risultati"
            onChange={(v) => setSection("ricerca", { max_results: v })}
            testid="set-ric-max" />
          <SettingSwitch label="Ricerca parziale"
            hint="Trova le corrispondenze anche a metà parola (contains)"
            checked={s.ricerca?.partial_match}
            onChange={(v) => setSection("ricerca", { partial_match: v })}
            testid="set-ric-partial" />
        </SettingsSection>

        <SettingsSection title="Movimenti" icon={ClockCounterClockwise}>
          <SettingNumber label="Numero movimenti visualizzati"
            hint="Massimo record mostrati nella pagina Movimenti"
            value={s.movimenti?.max_shown} min={10} max={1000} step={10} unit="movimenti"
            onChange={(v) => setSection("movimenti", { max_shown: v })}
            testid="set-mov-max" />
          <SettingSwitch label="Apertura automatica sul mese corrente"
            checked={s.movimenti?.auto_open_current_month}
            onChange={(v) => setSection("movimenti", { auto_open_current_month: v })}
            testid="set-mov-current" />
        </SettingsSection>

        <SettingsSection title="Sicurezza" icon={Gear}>
          <SettingNumber label="Durata sessione (minuti)"
            hint="Dopo questo tempo dal login l'utente deve rieffettuare l'accesso"
            value={s.sicurezza?.session_ttl_minutes} min={15} max={43200} step={15} unit="minuti"
            onChange={(v) => setSection("sicurezza", { session_ttl_minutes: v })}
            testid="set-sec-session-ttl" />
          <SettingNumber label="Logout automatico dopo inattività"
            hint="Chiude la sessione se l'utente non interagisce"
            value={s.sicurezza?.idle_logout_minutes} min={1} max={1440} step={1} unit="minuti"
            onChange={(v) => setSection("sicurezza", { idle_logout_minutes: v })}
            testid="set-sec-idle" />
          <SettingNumber label="Tentativi di login massimi"
            hint="Oltre questa soglia l'utente viene bloccato temporaneamente"
            value={s.sicurezza?.max_login_attempts} min={3} max={20} step={1} unit="tentativi"
            onChange={(v) => setSection("sicurezza", { max_login_attempts: v })}
            testid="set-sec-max-attempts" />
          <SettingNumber label="Durata blocco dopo troppi tentativi"
            value={s.sicurezza?.lockout_minutes} min={1} max={1440} step={1} unit="minuti"
            onChange={(v) => setSection("sicurezza", { lockout_minutes: v })}
            testid="set-sec-lockout" />
          <div className="pt-3 mt-1 text-[11px] text-slate-500 border-t border-slate-100">
            L'obbligo di cambio password al primo accesso è <strong>sempre attivo</strong> per gli utenti creati dall'Admin.
          </div>
        </SettingsSection>

        <SettingsSection title="Fuso orario" icon={Globe}>
          <div className="py-2">
            <Label className="text-sm font-semibold text-slate-800">Fuso orario del gestionale</Label>
            <div className="text-[11px] text-slate-500 mb-2">
              Data e ora mostrate in tutto il gestionale (Arrivi, Spedizioni, Movimenti, Dashboard, Audit, Storico Seriali)
              vengono formattate in questo fuso. L'ora legale/solare è gestita automaticamente.
              L'ora viene generata dal server e non dipende dall'orologio del dispositivo.
            </div>
            <select
              value={s.general?.timezone || "Europe/Rome"}
              onChange={(e) => setSection("general", { timezone: e.target.value })}
              className="h-11 w-full max-w-sm rounded-md border border-slate-200 bg-white px-3 text-sm font-mono-tight focus:outline-none focus:border-slate-500"
              data-testid="setting-timezone"
            >
              <option value="Europe/Rome">Europe/Rome — Italia (predefinito)</option>
              <option value="Europe/London">Europe/London — Regno Unito</option>
              <option value="Europe/Paris">Europe/Paris — Francia</option>
              <option value="Europe/Berlin">Europe/Berlin — Germania</option>
              <option value="Europe/Madrid">Europe/Madrid — Spagna</option>
              <option value="Europe/Lisbon">Europe/Lisbon — Portogallo</option>
              <option value="America/New_York">America/New_York — USA Est</option>
              <option value="America/Chicago">America/Chicago — USA Centro</option>
              <option value="America/Denver">America/Denver — USA Montagna</option>
              <option value="America/Los_Angeles">America/Los_Angeles — USA Ovest</option>
              <option value="Asia/Dubai">Asia/Dubai — Emirati</option>
              <option value="Asia/Tokyo">Asia/Tokyo — Giappone</option>
              <option value="Australia/Sydney">Australia/Sydney</option>
              <option value="UTC">UTC — Tempo universale</option>
            </select>
          </div>
        </SettingsSection>

        <SettingsSection title="Manutenzione / Test" icon={Broom}>
          <div className="py-2">
            <Label className="text-sm font-semibold text-slate-800">Prefisso dati di test</Label>
            <div className="text-[11px] text-slate-500 mb-1">
              Usato dal tab Cleanup per identificare dati fittizi da eliminare (mai su Notion).
            </div>
            <Input value={s.test_prefix}
              onChange={(e) => setS({ ...s, test_prefix: e.target.value })}
              className="h-11 font-mono-tight max-w-[220px]" data-testid="setting-test-prefix" />
          </div>
        </SettingsSection>
      </div>

      <div className="sticky bottom-3 z-10 flex justify-end">
        <Button onClick={save} disabled={saving} className="h-11 et-btn-primary border-0 shadow-lg" data-testid="save-settings-btn">
          {saving ? "Salvo…" : "Salva tutte le impostazioni"}
        </Button>
      </div>
    </div>
  );
}

// ---------- Sessioni attive (F7) ----------
export function SessionsTab() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busySid, setBusySid] = useState(null);

  const load = async () => {
    setLoading(true);
    try {
      const { data } = await axios.get(`${API}/admin/sessions`);
      setItems(data.items || []);
    } catch (e) { toast.error("Errore", { description: formatError(e) }); }
    finally { setLoading(false); }
  };
  useEffect(() => {
    load();
    const t = setInterval(load, 20000); // refresh soft ogni 20s (solo su questa tab)
    return () => clearInterval(t);
  }, []);

  const disconnect = async (sid) => {
    if (!window.confirm("Disconnettere questa sessione? L'utente dovrà rieffettuare il login.")) return;
    setBusySid(sid);
    try {
      await axios.delete(`${API}/admin/sessions/${sid}`);
      toast.success("Sessione disconnessa");
      load();
    } catch (e) { toast.error("Errore", { description: formatError(e) }); }
    finally { setBusySid(null); }
  };

  return (
    <div className="space-y-3" data-testid="sessions-tab">
      <div className="flex items-center justify-between">
        <div className="text-xs uppercase tracking-wider text-slate-500">
          {items.length} sessione{items.length === 1 ? "" : " attive"}
        </div>
        <Button variant="outline" size="sm" onClick={load} disabled={loading} data-testid="reload-sessions-btn">
          <ArrowClockwise size={14} className={loading ? "animate-spin" : ""} />
        </Button>
      </div>
      <div className="et-card-elevated overflow-hidden">
        <div className="overflow-x-auto">
          <table className="et-table">
            <thead>
              <tr>
                <th>Utente</th>
                <th>Stato</th>
                <th>Ultimo accesso</th>
                <th>Ultima attività</th>
                <th className="text-right">Azione</th>
              </tr>
            </thead>
            <tbody>
              {items.map((s) => (
                <tr key={s.sid} data-testid={`session-row-${s.sid}`}>
                  <td>
                    <div className="font-semibold text-slate-900">{s.full_name}</div>
                    <div className="text-xs text-slate-500 font-mono-tight">@{s.username} · {s.role}</div>
                  </td>
                  <td>
                    <span
                      className={`inline-flex items-center gap-1.5 px-2 py-1 rounded-full text-[11px] font-semibold ${
                        s.online
                          ? "bg-emerald-50 text-emerald-800 border border-emerald-200"
                          : "bg-slate-100 text-slate-500 border border-slate-200"
                      }`}
                      data-testid={`session-status-${s.sid}`}
                    >
                      <span className={`w-1.5 h-1.5 rounded-full ${s.online ? "bg-emerald-500 animate-pulse" : "bg-slate-400"}`}></span>
                      {s.online ? "Online" : "Offline"}
                    </span>
                  </td>
                  <td className="text-xs font-mono-tight text-slate-600">{fmtDate(s.last_login)}</td>
                  <td className="text-xs font-mono-tight text-slate-600">{fmtDate(s.last_activity)}</td>
                  <td className="text-right">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => disconnect(s.sid)}
                      disabled={busySid === s.sid}
                      className="text-red-600 border-red-200 hover:bg-red-50"
                      data-testid={`disconnect-session-${s.sid}`}
                    >
                      {busySid === s.sid ? "…" : "Disconnetti"}
                    </Button>
                  </td>
                </tr>
              ))}
              {items.length === 0 && !loading && (
                <tr><td colSpan={5} className="px-3 py-6 text-center text-slate-400">Nessuna sessione attiva.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
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
