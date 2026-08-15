import { useEffect, useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { Link } from "react-router-dom";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "../components/ui/card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "../components/ui/tabs";
import { Badge } from "../components/ui/badge";
import {
  Plus,
  Trash,
  FloppyDisk,
  SignOut,
  ArrowLeft,
  Envelope,
  ClockCounterClockwise,
  Package,
  ArrowsClockwise,
  MagnifyingGlass,
  Warning,
  Broom,
  Gear,
  ListMagnifyingGlass,
} from "@phosphor-icons/react";
import { AuditLogTab, SettingsTab, CleanupTestTab, SerialHistoryTab, GlobalSearchTab } from "./AdminExtraTabs";

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

// Auth is now handled by AuthContext + axios interceptor (Bearer token).
// L'endpoint richiede JWT admin (Depends(dep_require_admin) lato backend).
const authHeaders = () => ({}); // Bearer inserito dall'interceptor globale in AuthContext

function _RemovedLoginScreen() { return null; }

// ---------- F5: Gestione Prodotti — Tipo Gestione da Notion (SSOT) ----------
function InventoryTab() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState(null);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("__ALL__"); // __ALL__ | seriale | quantita | nonconfig

  const load = async () => {
    setLoading(true);
    try {
      const { data } = await axios.get(`${API}/admin/inventory`, {
        headers: authHeaders(),
      });
      setItems(data.items || []);
    } catch (e) {
      toast.error("Errore caricamento Notion", {
        description: e?.response?.data?.detail || e?.message,
      });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const setTipoGestione = async (item, tipo) => {
    // tipo: "a_seriale" | "a_quantita"
    if (item.tipo_gestione === tipo) return;
    setSavingId(item.id);
    try {
      await axios.put(
        `${API}/admin/inventory/tipo-gestione`,
        { page_id: item.id, tipo_gestione: tipo },
        { headers: authHeaders() }
      );
      setItems((prev) =>
        prev.map((x) =>
          x.id === item.id
            ? {
                ...x,
                tipo_gestione: tipo,
                serialized: tipo === "a_seriale",
                configured: true,
              }
            : x
        )
      );
      toast.success(
        `Tipo Gestione aggiornato su Notion: ${
          tipo === "a_seriale" ? "A Seriale" : "A Quantità"
        }`
      );
    } catch (e) {
      toast.error("Salvataggio Notion fallito", {
        description: e?.response?.data?.detail || e?.message,
      });
    } finally {
      setSavingId(null);
    }
  };

  const q = query.trim().toLowerCase();
  const visible = items.filter((it) => {
    if (filter === "seriale" && it.tipo_gestione !== "a_seriale") return false;
    if (filter === "quantita" && it.tipo_gestione !== "a_quantita") return false;
    if (filter === "nonconfig" && it.configured) return false;
    if (!q) return true;
    return (
      (it.name || "").toLowerCase().includes(q) ||
      (it.code || "").toLowerCase().includes(q) ||
      (it.category || "").toLowerCase().includes(q)
    );
  });

  const counts = {
    all: items.length,
    seriale: items.filter((i) => i.tipo_gestione === "a_seriale").length,
    quantita: items.filter((i) => i.tipo_gestione === "a_quantita").length,
    nonconfig: items.filter((i) => !i.configured).length,
  };

  if (loading) return <div className="text-slate-500">Caricamento Notion…</div>;

  return (
    <div className="space-y-4" data-testid="admin-gestione-prodotti">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="text-sm text-slate-600 max-w-xl">
          Prodotti letti da Notion (SSOT). Il <strong>Tipo Gestione</strong> viene
          salvato <strong>direttamente su Notion</strong> — nessuna copia
          MongoDB. Nuovi prodotti aggiunti su Notion appaiono automaticamente qui.
        </div>
        <Button
          type="button"
          variant="outline"
          onClick={load}
          className="h-11"
          data-testid="reload-inventory-btn"
        >
          <ArrowsClockwise size={16} className="mr-1" /> Aggiorna da Notion
        </Button>
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Cerca prodotto per nome, codice o categoria…"
          className="h-10 max-w-md"
          data-testid="admin-product-search"
        />
        <Button
          type="button"
          variant={filter === "__ALL__" ? "default" : "outline"}
          onClick={() => setFilter("__ALL__")}
          className={`h-9 px-3 ${filter === "__ALL__" ? "bg-slate-900 hover:bg-slate-800" : ""}`}
          data-testid="filter-all"
        >
          Tutti ({counts.all})
        </Button>
        <Button
          type="button"
          variant={filter === "seriale" ? "default" : "outline"}
          onClick={() => setFilter("seriale")}
          className={`h-9 px-3 ${filter === "seriale" ? "bg-amber-600 hover:bg-amber-700 text-white" : ""}`}
          data-testid="filter-seriale"
        >
          A Seriale ({counts.seriale})
        </Button>
        <Button
          type="button"
          variant={filter === "quantita" ? "default" : "outline"}
          onClick={() => setFilter("quantita")}
          className={`h-9 px-3 ${filter === "quantita" ? "bg-slate-700 hover:bg-slate-800 text-white" : ""}`}
          data-testid="filter-quantita"
        >
          A Quantità ({counts.quantita})
        </Button>
        <Button
          type="button"
          variant={filter === "nonconfig" ? "default" : "outline"}
          onClick={() => setFilter("nonconfig")}
          className={`h-9 px-3 ${filter === "nonconfig" ? "bg-red-600 hover:bg-red-700 text-white" : ""}`}
          data-testid="filter-nonconfig"
        >
          Non configurati ({counts.nonconfig})
        </Button>
      </div>

      <ul className="border border-slate-200 rounded-md divide-y divide-slate-200 bg-white">
        {visible.map((it) => {
          const isSaving = savingId === it.id;
          return (
            <li
              key={it.id}
              className="flex items-center justify-between gap-3 px-4 py-3 flex-wrap"
              data-testid={`admin-item-${it.id}`}
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-semibold text-slate-900">{it.name}</span>
                  {it.code && (
                    <span className="text-xs font-mono-tight text-slate-400">{it.code}</span>
                  )}
                  {it.category && (
                    <Badge variant="outline" className="border-slate-300 text-slate-600">
                      {it.category}
                    </Badge>
                  )}
                  {!it.configured && (
                    <Badge
                      variant="outline"
                      className="border-red-300 text-red-700 bg-red-50"
                      data-testid={`badge-nonconfig-${it.id}`}
                    >
                      NON CONFIGURATO
                    </Badge>
                  )}
                </div>
                <div className="text-xs text-slate-500 mt-0.5">
                  Disponibili:{" "}
                  <span className="font-mono-tight font-semibold text-slate-700">
                    {it.quantity} {it.unit}
                  </span>
                </div>
              </div>
              <div className="flex items-center gap-1 shrink-0" role="radiogroup" aria-label="Tipo Gestione">
                <button
                  type="button"
                  onClick={() => setTipoGestione(it, "a_quantita")}
                  disabled={isSaving}
                  className={`h-9 px-3 rounded-md text-xs font-semibold border transition-colors ${
                    it.tipo_gestione === "a_quantita"
                      ? "bg-slate-900 border-slate-900 text-white"
                      : "bg-white border-slate-300 text-slate-600 hover:border-slate-500"
                  } disabled:opacity-60`}
                  data-testid={`set-quantita-${it.id}`}
                >
                  A Quantità
                </button>
                <button
                  type="button"
                  onClick={() => setTipoGestione(it, "a_seriale")}
                  disabled={isSaving}
                  className={`h-9 px-3 rounded-md text-xs font-semibold border transition-colors ${
                    it.tipo_gestione === "a_seriale"
                      ? "bg-amber-600 border-amber-600 text-white"
                      : "bg-white border-slate-300 text-slate-600 hover:border-amber-500"
                  } disabled:opacity-60`}
                  data-testid={`set-seriale-${it.id}`}
                >
                  A Seriale
                </button>
              </div>
            </li>
          );
        })}
        {visible.length === 0 && (
          <li className="px-4 py-8 text-center text-slate-500 text-sm">
            Nessun prodotto corrisponde ai criteri.
          </li>
        )}
      </ul>
    </div>
  );
}

// ---------- Recipients tab ----------
function RecipientsTab() {
  const [emails, setEmails] = useState([]);
  const [newEmail, setNewEmail] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const { data } = await axios.get(`${API}/admin/recipients`, {
        headers: authHeaders(),
      });
      setEmails(data.emails || []);
    } catch (e) {
      toast.error("Errore caricamento", { description: e?.message });
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    load();
  }, []);

  const addEmail = () => {
    const v = newEmail.trim().toLowerCase();
    if (!v) return;
    const re = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!re.test(v)) {
      toast.error("Email non valida");
      return;
    }
    if (emails.includes(v)) {
      toast.error("Email già presente");
      return;
    }
    setEmails((prev) => [...prev, v]);
    setNewEmail("");
  };

  const removeEmail = (idx) => {
    setEmails((prev) => prev.filter((_, i) => i !== idx));
  };

  const save = async () => {
    if (emails.length === 0) {
      toast.error("Inserisci almeno un destinatario");
      return;
    }
    setSaving(true);
    try {
      await axios.put(
        `${API}/admin/recipients`,
        { emails },
        { headers: authHeaders() }
      );
      toast.success("Destinatari salvati");
      load();
    } catch (e) {
      toast.error("Salvataggio fallito", {
        description: e?.response?.data?.detail || e?.message,
      });
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <div className="text-slate-500">Caricamento…</div>;

  return (
    <div className="space-y-4 max-w-2xl">
      <div className="text-sm text-slate-600">
        Email a cui verrà inviata ogni spedizione registrata dal magazzino.
      </div>
      <div className="flex gap-2">
        <Input
          type="email"
          placeholder="nuova@destinatario.it"
          value={newEmail}
          onChange={(e) => setNewEmail(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), addEmail())}
          className="h-11"
          data-testid="new-recipient-input"
        />
        <Button
          type="button"
          onClick={addEmail}
          className="h-11 bg-slate-900 hover:bg-slate-800"
          data-testid="add-recipient-btn"
        >
          <Plus size={18} className="mr-1" /> Aggiungi
        </Button>
      </div>

      <ul className="border border-slate-200 rounded-md divide-y divide-slate-200 bg-white">
        {emails.map((em, idx) => (
          <li key={em} className="flex items-center justify-between px-4 py-3">
            <span className="font-mono-tight text-slate-900">{em}</span>
            <Button
              type="button"
              variant="outline"
              size="icon"
              className="h-9 w-9 border-red-200 text-red-600 hover:bg-red-50"
              onClick={() => removeEmail(idx)}
              data-testid={`remove-recipient-${idx}`}
              aria-label="Rimuovi"
            >
              <Trash size={16} />
            </Button>
          </li>
        ))}
        {emails.length === 0 && (
          <li className="px-4 py-6 text-slate-500 text-center text-sm">
            Nessun destinatario configurato.
          </li>
        )}
      </ul>

      <Button
        type="button"
        onClick={save}
        disabled={saving}
        className="h-11 bg-blue-600 hover:bg-blue-700"
        data-testid="save-recipients-btn"
      >
        <FloppyDisk size={18} className="mr-1" />
        {saving ? "Salvo…" : "Salva destinatari"}
      </Button>
    </div>
  );
}

// ---------- History tab (with filters + PDF + Notion exits) ----------
function HistoryTab() {
  const [items, setItems] = useState([]);
  const [notionExits, setNotionExits] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadingNotion, setLoadingNotion] = useState(false);
  const [expanded, setExpanded] = useState(null);

  // Filters
  const [fCliente, setFCliente] = useState("");
  const [fMateriale, setFMateriale] = useState("");
  const [fFrom, setFFrom] = useState("");
  const [fTo, setFTo] = useState("");
  const [showNotion, setShowNotion] = useState(true);

  const loadLocal = async (override) => {
    const f = override || { c: fCliente, m: fMateriale, from: fFrom, to: fTo };
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if ((f.c || "").trim()) params.set("cliente", f.c.trim());
      if ((f.m || "").trim()) params.set("materiale", f.m.trim());
      if (f.from) params.set("date_from", f.from);
      if (f.to) params.set("date_to", f.to);
      const { data } = await axios.get(
        `${API}/admin/history?${params.toString()}`,
        { headers: authHeaders() }
      );
      setItems(data.items || []);
    } catch (e) {
      toast.error("Errore caricamento", {
        description: e?.response?.data?.detail || e?.message,
      });
    } finally {
      setLoading(false);
    }
  };

  const loadNotion = async (override) => {
    if (!showNotion && !override) return;
    const f = override || { c: fCliente, m: fMateriale, from: fFrom, to: fTo };
    setLoadingNotion(true);
    try {
      const params = new URLSearchParams();
      if ((f.c || "").trim()) params.set("cliente", f.c.trim());
      if ((f.m || "").trim()) params.set("materiale", f.m.trim());
      if (f.from) params.set("date_from", f.from);
      if (f.to) params.set("date_to", f.to);
      const { data } = await axios.get(
        `${API}/admin/notion-exits?${params.toString()}`,
        { headers: authHeaders() }
      );
      setNotionExits(data.items || []);
    } catch (e) {
      setNotionExits([]);
    } finally {
      setLoadingNotion(false);
    }
  };

  useEffect(() => {
    loadLocal();
    loadNotion();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const applyFilters = () => {
    loadLocal();
    loadNotion();
  };

  const clearFilters = () => {
    setFCliente("");
    setFMateriale("");
    setFFrom("");
    setFTo("");
    const empty = { c: "", m: "", from: "", to: "" };
    loadLocal(empty);
    loadNotion(empty);
  };

  const fmtDateTime = (iso) => {
    if (!iso) return "";
    try {
      return new Date(iso).toLocaleString("it-IT");
    } catch {
      return iso;
    }
  };

  return (
    <div className="space-y-4">
      {/* Filters */}
      <div className="bg-white border border-slate-200 rounded-md p-4 space-y-3">
        <div className="text-xs font-semibold uppercase tracking-wider text-slate-500">
          Filtri
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
          <div>
            <Label className="text-xs font-semibold text-slate-600">Cliente</Label>
            <Input
              value={fCliente}
              onChange={(e) => setFCliente(e.target.value)}
              placeholder="Nome cliente…"
              className="h-10 mt-1"
              data-testid="filter-cliente"
            />
          </div>
          <div>
            <Label className="text-xs font-semibold text-slate-600">Materiale</Label>
            <Input
              value={fMateriale}
              onChange={(e) => setFMateriale(e.target.value)}
              placeholder="Nome materiale…"
              className="h-10 mt-1"
              data-testid="filter-materiale"
            />
          </div>
          <div>
            <Label className="text-xs font-semibold text-slate-600">Data da</Label>
            <Input
              type="date"
              value={fFrom}
              onChange={(e) => setFFrom(e.target.value)}
              className="h-10 mt-1"
              data-testid="filter-from"
            />
          </div>
          <div>
            <Label className="text-xs font-semibold text-slate-600">Data a</Label>
            <Input
              type="date"
              value={fTo}
              onChange={(e) => setFTo(e.target.value)}
              className="h-10 mt-1"
              data-testid="filter-to"
            />
          </div>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <Button
            type="button"
            onClick={applyFilters}
            className="h-10 bg-slate-900 hover:bg-slate-800"
            data-testid="apply-filters-btn"
          >
            Applica filtri
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={clearFilters}
            className="h-10"
            data-testid="clear-filters-btn"
          >
            Pulisci
          </Button>
          <label className="flex items-center gap-2 ml-2 text-sm text-slate-600">
            <input
              type="checkbox"
              checked={showNotion}
              onChange={(e) => setShowNotion(e.target.checked)}
              className="h-4 w-4"
            />
            Includi uscite Notion (esterne all'app)
          </label>
        </div>
      </div>

      {/* Local shipments */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <div className="text-xs font-semibold uppercase tracking-wider text-slate-500">
            Spedizioni App ({items.length})
          </div>
        </div>
        {loading ? (
          <div className="text-slate-500">Caricamento…</div>
        ) : items.length === 0 ? (
          <div className="text-center py-8 border border-dashed border-slate-300 rounded-md text-slate-500 text-sm">
            Nessuna spedizione app corrisponde ai filtri.
          </div>
        ) : (
          items.map((it) => {
            const isOpen = expanded === it.id;
            const totalUnits = (it.items || []).reduce(
              (a, i) => a + (i.quantity || 0),
              0
            );
            return (
              <div
                key={it.id}
                className="border border-slate-200 rounded-md bg-white overflow-hidden"
                data-testid={`history-${it.id}`}
              >
                <div className="w-full px-4 py-3 flex items-center justify-between gap-2 hover:bg-slate-50">
                  <button
                    type="button"
                    onClick={() => setExpanded(isOpen ? null : it.id)}
                    className="flex-1 min-w-0 text-left"
                  >
                    <div className="font-semibold text-slate-900 truncate">
                      Cliente: {it.structure} — {it.shipping_date}
                    </div>
                    <div className="text-xs text-slate-500 mt-0.5 truncate">
                      Operatore: {it.operator} • Inviato il {fmtDateTime(it.created_at)}
                    </div>
                  </button>
                  <Badge variant="outline" className="border-slate-300 shrink-0">
                    <Package size={14} className="mr-1" /> {totalUnits} pz
                  </Badge>
                </div>
                {isOpen && (
                  <div className="border-t border-slate-200 px-4 py-3 space-y-3 bg-slate-50">
                    <div className="text-xs text-slate-500">
                      Email: {(it.recipients || []).join(", ") || "—"}
                    </div>
                    <div className="space-y-2">
                      {(it.items || []).map((row, j) => {
                        const mv = (it.movements || []).find(
                          (m) => m.page_id === row.page_id
                        );
                        const rowKey = row.page_id || `${row.name}-${j}`;
                        return (
                          <div
                            key={rowKey}
                            className="bg-white border border-slate-200 rounded-md px-3 py-2"
                          >
                            <div className="flex items-center justify-between gap-2">
                              <span className="font-medium text-slate-900">{row.name}</span>
                              <span className="font-mono-tight text-sm text-slate-600">
                                × {row.quantity} {row.unit || "pz"}
                              </span>
                            </div>
                            {mv && (
                              <div className="text-xs text-slate-500 mt-1 font-mono-tight">
                                Stock: {mv.before} → {mv.after} {mv.unit || "pz"}
                              </div>
                            )}
                            {row.serials && row.serials.length > 0 && (
                              <ul className="mt-1 ml-4 text-xs font-mono-tight text-slate-600 list-disc">
                                {row.serials.map((s, k) => (
                                  <li key={`${rowKey}-sn-${s || k}`}>{s}</li>
                                ))}
                              </ul>
                            )}
                          </div>
                        );
                      })}
                    </div>
                    {it.notes && (
                      <div className="text-xs text-slate-700 bg-amber-50 border-l-2 border-amber-400 px-3 py-2 rounded-sm">
                        <strong>Note:</strong> {it.notes}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>

      {/* Notion external exits */}
      {showNotion && (
        <div className="space-y-2 pt-4">
          <div className="flex items-center justify-between">
            <div className="text-xs font-semibold uppercase tracking-wider text-slate-500">
              Uscite Notion esterne all'app ({notionExits.length})
            </div>
            {loadingNotion && <span className="text-xs text-slate-400">Caricamento…</span>}
          </div>
          {!loadingNotion && notionExits.length === 0 ? (
            <div className="text-center py-6 border border-dashed border-slate-300 rounded-md text-slate-500 text-sm">
              Nessuna uscita Notion esterna con questi filtri.
            </div>
          ) : (
            notionExits.map((ex) => (
              <div
                key={ex.id}
                className="border border-slate-200 rounded-md bg-white px-4 py-3 flex items-center justify-between gap-3"
                data-testid={`notion-exit-${ex.id}`}
              >
                <div className="flex-1 min-w-0">
                  <div className="font-semibold text-slate-900 truncate">
                    {ex.item_name || "Materiale ?"}
                    <span className="ml-2 font-mono-tight text-xs text-slate-500">
                      SN: {ex.sn || "—"}
                    </span>
                  </div>
                  <div className="text-xs text-slate-500 mt-0.5 truncate">
                    Cliente: {ex.cliente || "—"} • {ex.date || fmtDateTime(ex.created_time)}
                  </div>
                </div>
                <Badge variant="outline" className="border-slate-300 shrink-0">
                  × {ex.quantity ?? "?"} {ex.unit || "pz"}
                </Badge>
                {ex.url && (
                  <a
                    href={ex.url}
                    target="_blank"
                    rel="noreferrer"
                    className="text-xs text-blue-600 hover:underline shrink-0"
                  >
                    Notion ↗
                  </a>
                )}
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}

// ---------- Root ----------
export default function AdminPage() {
  return (
    <div className="min-h-screen bg-slate-50" data-testid="admin-page">
      <header className="sticky top-0 z-30 bg-white border-b border-slate-200">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-4 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <Link
              to="/"
              className="h-10 inline-flex items-center px-3 border border-slate-200 rounded-md text-slate-600 hover:text-slate-900 hover:border-slate-300 text-sm"
            >
              <ArrowLeft size={16} className="mr-1" /> Magazzino
            </Link>
            <div>
              <div className="text-[11px] tracking-[0.2em] uppercase text-slate-500 font-semibold">
                Elios Tech — Magazzino
              </div>
              <h1 className="font-display text-xl sm:text-2xl font-bold text-slate-900">
                Pannello Admin
              </h1>
            </div>
          </div>
          <Link
            to="/admin/utenti"
            className="h-10 inline-flex items-center px-3 border border-slate-200 rounded-md text-slate-700 hover:text-slate-900 hover:border-slate-300 text-sm"
            data-testid="link-admin-users"
          >
            Gestione Utenti →
          </Link>
        </div>
      </header>
      <main className="max-w-6xl mx-auto px-4 sm:px-6 py-6">
        <Tabs defaultValue="inventory">
          <TabsList className="mb-6 flex-wrap h-auto">
            <TabsTrigger value="inventory" data-testid="tab-inventory">
              <Package size={16} className="mr-1" /> Prodotti
            </TabsTrigger>
            <TabsTrigger value="recipients" data-testid="tab-recipients">
              <Envelope size={16} className="mr-1" /> Destinatari
            </TabsTrigger>
            <TabsTrigger value="history" data-testid="tab-history">
              <ClockCounterClockwise size={16} className="mr-1" /> Storico
            </TabsTrigger>
            <TabsTrigger value="global-search" data-testid="tab-global-search">
              <MagnifyingGlass size={16} className="mr-1" /> Ricerca
            </TabsTrigger>
            <TabsTrigger value="serial-history" data-testid="tab-serial-history">
              <ListMagnifyingGlass size={16} className="mr-1" /> Storico SN
            </TabsTrigger>
            <TabsTrigger value="audit-log" data-testid="tab-audit-log">
              <ClockCounterClockwise size={16} className="mr-1" /> Audit
            </TabsTrigger>
            <TabsTrigger value="cleanup" data-testid="tab-cleanup">
              <Broom size={16} className="mr-1" /> Cleanup
            </TabsTrigger>
            <TabsTrigger value="settings" data-testid="tab-settings">
              <Gear size={16} className="mr-1" /> Impostazioni
            </TabsTrigger>
          </TabsList>
          <TabsContent value="inventory"><InventoryTab /></TabsContent>
          <TabsContent value="recipients"><RecipientsTab /></TabsContent>
          <TabsContent value="history"><HistoryTab /></TabsContent>
          <TabsContent value="global-search"><GlobalSearchTab /></TabsContent>
          <TabsContent value="serial-history"><SerialHistoryTab /></TabsContent>
          <TabsContent value="audit-log"><AuditLogTab /></TabsContent>
          <TabsContent value="cleanup"><CleanupTestTab /></TabsContent>
          <TabsContent value="settings"><SettingsTab /></TabsContent>
        </Tabs>
      </main>
    </div>
  );
}
