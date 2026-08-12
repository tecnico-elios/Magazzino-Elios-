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
import { Switch } from "../components/ui/switch";
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
} from "@phosphor-icons/react";

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;
const AUTH_KEY = "admin_password";

const authHeaders = () => ({
  "X-Admin-Password": sessionStorage.getItem(AUTH_KEY) || "",
});

// ---------- Login ----------
function LoginScreen({ onLogin }) {
  const [pwd, setPwd] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      await axios.post(`${API}/admin/login`, { password: pwd });
      sessionStorage.setItem(AUTH_KEY, pwd);
      onLogin();
    } catch (err) {
      toast.error("Accesso negato", {
        description: err?.response?.data?.detail || "Password non valida",
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
      <Card className="w-full max-w-sm border-slate-200">
        <CardHeader>
          <CardTitle className="font-display text-2xl">Pannello Admin</CardTitle>
          <CardDescription>
            Accesso riservato — inserisci la password amministratore.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={submit} className="space-y-4">
            <div>
              <Label htmlFor="pwd" className="text-sm font-semibold">
                Password
              </Label>
              <Input
                id="pwd"
                data-testid="admin-password-input"
                type="password"
                value={pwd}
                onChange={(e) => setPwd(e.target.value)}
                className="h-12 mt-1"
                autoFocus
              />
            </div>
            <Button
              type="submit"
              disabled={busy || !pwd}
              className="h-12 w-full bg-slate-900 hover:bg-slate-800"
              data-testid="admin-login-btn"
            >
              {busy ? "Verifica…" : "Accedi"}
            </Button>
            <Link
              to="/"
              className="block text-center text-sm text-slate-500 hover:text-slate-900"
            >
              ← Torna alla checklist
            </Link>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}

// ---------- Inventario Notion tab (read-only view + local Serialized override) ----------
function InventoryTab() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState(null);
  const [filter, setFilter] = useState("__ALL__");

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

  const toggleSerial = async (item, next) => {
    setSavingId(item.id);
    try {
      await axios.put(
        `${API}/admin/inventory/serial`,
        { page_id: item.id, serialized: next },
        { headers: authHeaders() }
      );
      setItems((prev) =>
        prev.map((x) => (x.id === item.id ? { ...x, serialized: next, has_override: true } : x))
      );
      toast.success("Impostazione salvata");
    } catch (e) {
      toast.error("Salvataggio fallito", {
        description: e?.response?.data?.detail || e?.message,
      });
    } finally {
      setSavingId(null);
    }
  };

  const categories = Array.from(
    new Set(items.map((i) => i.category || "Senza categoria"))
  ).sort();

  const visible = items.filter(
    (i) => filter === "__ALL__" || (i.category || "Senza categoria") === filter
  );

  if (loading) return <div className="text-slate-500">Caricamento Notion…</div>;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="text-sm text-slate-600 max-w-xl">
          Inventario letto direttamente dal DB Notion <strong>"Inventario"</strong>. Nomi, categorie
          e quantità si modificano da Notion. Qui puoi solo marcare gli articoli che richiedono
          <strong> numero seriale</strong> nella spedizione.
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
        <span className="text-xs uppercase tracking-wider text-slate-500 font-semibold mr-1">
          Filtra:
        </span>
        <Button
          type="button"
          variant={filter === "__ALL__" ? "default" : "outline"}
          onClick={() => setFilter("__ALL__")}
          className={`h-9 px-3 ${filter === "__ALL__" ? "bg-slate-900 hover:bg-slate-800" : ""}`}
        >
          Tutti ({items.length})
        </Button>
        {categories.map((c) => (
          <Button
            key={c}
            type="button"
            variant={filter === c ? "default" : "outline"}
            onClick={() => setFilter(c)}
            className={`h-9 px-3 ${filter === c ? "bg-slate-900 hover:bg-slate-800" : ""}`}
          >
            {c} ({items.filter((i) => (i.category || "Senza categoria") === c).length})
          </Button>
        ))}
      </div>

      <ul className="border border-slate-200 rounded-md divide-y divide-slate-200 bg-white">
        {visible.map((it) => (
          <li
            key={it.id}
            className="flex items-center justify-between gap-3 px-4 py-3"
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
                {it.has_override && (
                  <Badge variant="outline" className="border-blue-200 text-blue-700 bg-blue-50">
                    override
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
            <div className="flex items-center gap-3 shrink-0">
              <span className="text-xs text-slate-600 hidden sm:inline">Serializzato</span>
              <Switch
                checked={!!it.serialized}
                disabled={savingId === it.id}
                onCheckedChange={(v) => toggleSerial(it, v)}
                data-testid={`serial-toggle-${it.id}`}
              />
            </div>
          </li>
        ))}
        {visible.length === 0 && (
          <li className="px-4 py-8 text-center text-slate-500 text-sm">
            Nessun articolo per questa categoria.
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
        Email a cui verrà inviata ogni checklist spedita dal magazzino.
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

// ---------- History tab ----------
function HistoryTab() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState(null);

  useEffect(() => {
    (async () => {
      try {
        const { data } = await axios.get(`${API}/admin/history?limit=200`, {
          headers: authHeaders(),
        });
        setItems(data.items || []);
      } catch (e) {
        toast.error("Errore caricamento", { description: e?.message });
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  if (loading) return <div className="text-slate-500">Caricamento…</div>;
  if (items.length === 0)
    return (
      <div className="text-center py-12 border border-dashed border-slate-300 rounded-md text-slate-500">
        Nessuna checklist inviata ancora.
      </div>
    );

  return (
    <div className="space-y-2">
      <div className="text-sm text-slate-600 mb-2">
        {items.length} spedizione/i registrate (più recenti in cima).
      </div>
      {items.map((it) => {
        const isOpen = expanded === it.id;
        const totalUnits = (it.items || []).reduce(
          (a, i) => a + (i.quantity || 0),
          0
        );
        const created = it.created_at
          ? new Date(it.created_at).toLocaleString("it-IT")
          : "";
        return (
          <div
            key={it.id}
            className="border border-slate-200 rounded-md bg-white overflow-hidden"
            data-testid={`history-${it.id}`}
          >
            <button
              type="button"
              onClick={() => setExpanded(isOpen ? null : it.id)}
              className="w-full text-left px-4 py-3 flex items-center justify-between gap-2 hover:bg-slate-50"
            >
              <div className="flex-1 min-w-0">
                <div className="font-semibold text-slate-900 truncate">
                  Cliente: {it.structure} — {it.shipping_date}
                </div>
                <div className="text-xs text-slate-500 mt-0.5 truncate">
                  Operatore: {it.operator} • Inviato il {created}
                </div>
              </div>
              <Badge variant="outline" className="border-slate-300 shrink-0">
                <Package size={14} className="mr-1" /> {totalUnits} pz
              </Badge>
            </button>
            {isOpen && (
              <div className="border-t border-slate-200 px-4 py-3 space-y-3 bg-slate-50">
                <div className="text-xs text-slate-500">
                  Email: {(it.recipients || []).join(", ") || "—"}
                </div>
                <div className="space-y-2">
                  {(it.items || []).map((row, j) => {
                    const mv = (it.movements || []).find((m) => m.page_id === row.page_id);
                    return (
                      <div
                        key={j}
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
                              <li key={k}>{s}</li>
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
      })}
    </div>
  );
}

// ---------- Root ----------
export default function AdminPage() {
  const [loggedIn, setLoggedIn] = useState(!!sessionStorage.getItem(AUTH_KEY));

  const logout = () => {
    sessionStorage.removeItem(AUTH_KEY);
    setLoggedIn(false);
  };

  if (!loggedIn) return <LoginScreen onLogin={() => setLoggedIn(true)} />;

  return (
    <div className="min-h-screen bg-slate-50" data-testid="admin-page">
      <header className="sticky top-0 z-30 bg-white border-b border-slate-200">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-4 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <Link
              to="/"
              className="h-10 inline-flex items-center px-3 border border-slate-200 rounded-md text-slate-600 hover:text-slate-900 hover:border-slate-300 text-sm"
            >
              <ArrowLeft size={16} className="mr-1" /> Checklist
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
          <Button
            type="button"
            variant="outline"
            onClick={logout}
            className="h-10"
            data-testid="admin-logout-btn"
          >
            <SignOut size={16} className="mr-1" /> Esci
          </Button>
        </div>
      </header>
      <main className="max-w-6xl mx-auto px-4 sm:px-6 py-6">
        <Tabs defaultValue="inventory">
          <TabsList className="mb-6">
            <TabsTrigger value="inventory" data-testid="tab-inventory">
              <Package size={16} className="mr-1" /> Inventario Notion
            </TabsTrigger>
            <TabsTrigger value="recipients" data-testid="tab-recipients">
              <Envelope size={16} className="mr-1" /> Destinatari
            </TabsTrigger>
            <TabsTrigger value="history" data-testid="tab-history">
              <ClockCounterClockwise size={16} className="mr-1" /> Storico
            </TabsTrigger>
          </TabsList>
          <TabsContent value="inventory">
            <InventoryTab />
          </TabsContent>
          <TabsContent value="recipients">
            <RecipientsTab />
          </TabsContent>
          <TabsContent value="history">
            <HistoryTab />
          </TabsContent>
        </Tabs>
      </main>
    </div>
  );
}
