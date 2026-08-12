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

// ---------- Catalog tab ----------
function CatalogTab() {
  const [categories, setCategories] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const { data } = await axios.get(`${API}/admin/catalog`, {
        headers: authHeaders(),
      });
      setCategories(data.categories || []);
    } catch (e) {
      toast.error("Errore caricamento", { description: e?.message });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const addCategory = () => {
    const id = `cat_${Date.now().toString(36)}`;
    setCategories((prev) => [
      ...prev,
      {
        id,
        name: "Nuova Categoria",
        subtitle: "",
        requires_serial: false,
        products: [],
      },
    ]);
  };

  const removeCategory = (idx) => {
    if (!window.confirm("Eliminare questa categoria e tutti i suoi prodotti?")) return;
    setCategories((prev) => prev.filter((_, i) => i !== idx));
  };

  const updateCategory = (idx, patch) => {
    setCategories((prev) =>
      prev.map((c, i) => (i === idx ? { ...c, ...patch } : c))
    );
  };

  const addProduct = (catIdx) => {
    setCategories((prev) =>
      prev.map((c, i) =>
        i === catIdx ? { ...c, products: [...c.products, "Nuovo prodotto"] } : c
      )
    );
  };

  const updateProduct = (catIdx, prodIdx, value) => {
    setCategories((prev) =>
      prev.map((c, i) =>
        i === catIdx
          ? {
              ...c,
              products: c.products.map((p, j) => (j === prodIdx ? value : p)),
            }
          : c
      )
    );
  };

  const removeProduct = (catIdx, prodIdx) => {
    setCategories((prev) =>
      prev.map((c, i) =>
        i === catIdx
          ? { ...c, products: c.products.filter((_, j) => j !== prodIdx) }
          : c
      )
    );
  };

  const save = async () => {
    // Client validation
    for (const c of categories) {
      if (!c.id.trim() || !c.name.trim()) {
        toast.error("Verifica dati", {
          description: "ID e nome categoria obbligatori",
        });
        return;
      }
      const cleaned = c.products.map((p) => p.trim()).filter(Boolean);
      if (cleaned.length !== new Set(cleaned).size) {
        toast.error("Verifica dati", {
          description: `Prodotti duplicati o vuoti in "${c.name}"`,
        });
        return;
      }
    }
    setSaving(true);
    try {
      const payload = {
        categories: categories.map((c) => ({
          id: c.id.trim(),
          name: c.name.trim(),
          subtitle: (c.subtitle || "").trim(),
          requires_serial: !!c.requires_serial,
          products: c.products.map((p) => p.trim()).filter(Boolean),
        })),
      };
      await axios.put(`${API}/admin/catalog`, payload, { headers: authHeaders() });
      toast.success("Catalogo salvato");
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
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="text-sm text-slate-600">
          Gestisci categorie e prodotti. Le modifiche si applicano subito al form checklist.
        </div>
        <div className="flex gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={addCategory}
            data-testid="add-category-btn"
            className="h-11"
          >
            <Plus size={18} className="mr-1" /> Nuova categoria
          </Button>
          <Button
            type="button"
            onClick={save}
            disabled={saving}
            data-testid="save-catalog-btn"
            className="h-11 bg-blue-600 hover:bg-blue-700"
          >
            <FloppyDisk size={18} className="mr-1" />
            {saving ? "Salvo…" : "Salva catalogo"}
          </Button>
        </div>
      </div>

      {categories.map((cat, i) => (
        <Card key={cat.id + i} className="border-slate-200">
          <CardHeader className="pb-3">
            <div className="grid grid-cols-1 md:grid-cols-12 gap-3 items-end">
              <div className="md:col-span-4">
                <Label className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                  Nome categoria
                </Label>
                <Input
                  value={cat.name}
                  onChange={(e) => updateCategory(i, { name: e.target.value })}
                  className="h-11 mt-1"
                  data-testid={`cat-${i}-name`}
                />
              </div>
              <div className="md:col-span-4">
                <Label className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                  Sottotitolo
                </Label>
                <Input
                  value={cat.subtitle || ""}
                  onChange={(e) => updateCategory(i, { subtitle: e.target.value })}
                  className="h-11 mt-1"
                />
              </div>
              <div className="md:col-span-3 flex items-center gap-3 pt-1">
                <Switch
                  checked={!!cat.requires_serial}
                  onCheckedChange={(v) => updateCategory(i, { requires_serial: v })}
                  data-testid={`cat-${i}-serial-toggle`}
                />
                <span className="text-sm font-medium">Richiede Seriali S/N</span>
              </div>
              <div className="md:col-span-1 flex justify-end">
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  className="h-11 w-11 border-red-200 text-red-600 hover:bg-red-50"
                  onClick={() => removeCategory(i)}
                  data-testid={`cat-${i}-remove`}
                  aria-label="Elimina categoria"
                >
                  <Trash size={18} />
                </Button>
              </div>
            </div>
          </CardHeader>
          <CardContent className="pt-0">
            <div className="border-t border-slate-200 pt-3 space-y-2">
              <div className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                Prodotti ({cat.products.length})
              </div>
              {cat.products.map((p, j) => (
                <div key={j} className="flex gap-2">
                  <Input
                    value={p}
                    onChange={(e) => updateProduct(i, j, e.target.value)}
                    className="h-11 flex-1"
                    data-testid={`cat-${i}-prod-${j}`}
                  />
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    className="h-11 w-11 border-red-200 text-red-600 hover:bg-red-50"
                    onClick={() => removeProduct(i, j)}
                    data-testid={`cat-${i}-prod-${j}-remove`}
                    aria-label="Rimuovi prodotto"
                  >
                    <Trash size={16} />
                  </Button>
                </div>
              ))}
              <Button
                type="button"
                variant="outline"
                onClick={() => addProduct(i)}
                className="h-10 mt-1"
                data-testid={`cat-${i}-add-prod`}
              >
                <Plus size={16} className="mr-1" /> Aggiungi prodotto
              </Button>
            </div>
          </CardContent>
        </Card>
      ))}

      {categories.length === 0 && (
        <div className="text-center py-12 border border-dashed border-slate-300 rounded-md text-slate-500">
          Nessuna categoria. Aggiungine una per iniziare.
        </div>
      )}
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
                  {it.structure} — {it.shipping_date}
                </div>
                <div className="text-xs text-slate-500 mt-0.5 truncate">
                  {it.operator} • Inviato il {created}
                </div>
              </div>
              <Badge variant="outline" className="border-slate-300 shrink-0">
                <Package size={14} className="mr-1" /> {totalUnits} pz
              </Badge>
            </button>
            {isOpen && (
              <div className="border-t border-slate-200 px-4 py-3 space-y-3 bg-slate-50">
                <div className="text-xs text-slate-500">
                  Destinatari: {(it.recipients || []).join(", ") || "—"}
                </div>
                <div className="space-y-2">
                  {(it.items || []).map((row, j) => (
                    <div
                      key={j}
                      className="bg-white border border-slate-200 rounded-md px-3 py-2"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-medium text-slate-900">{row.name}</span>
                        <span className="font-mono-tight text-sm text-slate-600">
                          × {row.quantity}
                        </span>
                      </div>
                      {row.serials && row.serials.length > 0 && (
                        <ul className="mt-1 ml-4 text-xs font-mono-tight text-slate-600 list-disc">
                          {row.serials.map((s, k) => (
                            <li key={k}>{s}</li>
                          ))}
                        </ul>
                      )}
                    </div>
                  ))}
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
        <Tabs defaultValue="catalog">
          <TabsList className="mb-6">
            <TabsTrigger value="catalog" data-testid="tab-catalog">
              <Package size={16} className="mr-1" /> Catalogo
            </TabsTrigger>
            <TabsTrigger value="recipients" data-testid="tab-recipients">
              <Envelope size={16} className="mr-1" /> Destinatari
            </TabsTrigger>
            <TabsTrigger value="history" data-testid="tab-history">
              <ClockCounterClockwise size={16} className="mr-1" /> Storico
            </TabsTrigger>
          </TabsList>
          <TabsContent value="catalog">
            <CatalogTab />
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
