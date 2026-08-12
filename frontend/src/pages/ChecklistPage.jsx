import { useMemo, useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { Link } from "react-router-dom";
import { useInventory } from "../lib/inventory";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { Button } from "../components/ui/button";
import { Textarea } from "../components/ui/textarea";
import { Badge } from "../components/ui/badge";
import BarcodeScanner from "../components/BarcodeScanner";
import {
  Minus,
  Plus,
  QrCode,
  PaperPlaneTilt,
  User,
  CalendarBlank,
  Buildings,
  Package,
  CircleNotch,
  Gear,
  ArrowsClockwise,
  Warning,
} from "@phosphor-icons/react";

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;
const todayISO = () => new Date().toISOString().slice(0, 10);

const CAT_ALL = "__ALL__";

export default function ChecklistPage() {
  const { items, categories, loading, error, refreshedAt, refresh } = useInventory();
  const [operator, setOperator] = useState("");
  const [shippingDate, setShippingDate] = useState(todayISO());
  const [structure, setStructure] = useState("");
  const [notes, setNotes] = useState("");
  const [selections, setSelections] = useState({}); // { page_id: { quantity, serials: [] } }
  const [submitting, setSubmitting] = useState(false);
  const [scanTarget, setScanTarget] = useState(null); // { page_id, index, label }
  const [filter, setFilter] = useState(CAT_ALL);

  const totalUnits = useMemo(
    () => Object.values(selections).reduce((a, s) => a + (Number(s.quantity) || 0), 0),
    [selections]
  );

  const filteredItems = useMemo(() => {
    if (filter === CAT_ALL) return items;
    return items.filter((it) => (it.category || "Senza categoria") === filter);
  }, [items, filter]);

  const grouped = useMemo(() => {
    const g = {};
    filteredItems.forEach((it) => {
      const k = it.category || "Senza categoria";
      (g[k] = g[k] || []).push(it);
    });
    return g;
  }, [filteredItems]);

  const setQuantity = (item, nextQty) => {
    const avail = Number(item.quantity) || 0;
    const q = Math.max(0, Math.min(avail, nextQty));
    setSelections((prev) => {
      const cur = prev[item.id] || { quantity: 0, serials: [] };
      let serials = item.serialized ? [...cur.serials] : [];
      if (item.serialized) {
        const nInt = Math.floor(q);
        if (nInt > serials.length) {
          while (serials.length < nInt) serials.push("");
        } else if (nInt < serials.length) {
          serials = serials.slice(0, nInt);
        }
      }
      if (q === 0) {
        // eslint-disable-next-line no-unused-vars
        const { [item.id]: _drop, ...rest } = prev;
        return rest;
      }
      return { ...prev, [item.id]: { quantity: q, serials } };
    });
  };

  const bump = (item, delta) => {
    const cur = selections[item.id]?.quantity || 0;
    setQuantity(item, cur + delta);
  };

  const setSerial = (pageId, idx, val) => {
    setSelections((prev) => {
      const cur = prev[pageId];
      if (!cur) return prev;
      const serials = [...cur.serials];
      serials[idx] = val;
      return { ...prev, [pageId]: { ...cur, serials } };
    });
  };

  const openScanner = (pageId, idx, label) => setScanTarget({ page_id: pageId, index: idx, label });
  const closeScanner = () => setScanTarget(null);
  const onScanned = (val) => {
    if (scanTarget) {
      setSerial(scanTarget.page_id, scanTarget.index, val);
      toast.success("Seriale acquisito", { description: val });
      setScanTarget(null);
    }
  };

  const resetForm = () => {
    setOperator("");
    setShippingDate(todayISO());
    setStructure("");
    setNotes("");
    setSelections({});
  };

  const doRefresh = async () => {
    await refresh();
    toast.success("Magazzino aggiornato");
  };

  const buildPayload = () => {
    const itemsPayload = [];
    items.forEach((it) => {
      const s = selections[it.id];
      if (s && s.quantity > 0) {
        itemsPayload.push({
          page_id: it.id,
          name: it.name,
          category: it.category || null,
          unit: it.unit || "pz",
          serialized: !!it.serialized,
          quantity: s.quantity,
          serials: it.serialized ? s.serials : [],
        });
      }
    });
    return {
      operator: operator.trim(),
      shipping_date: shippingDate,
      structure: structure.trim(),
      notes: notes.trim() || null,
      items: itemsPayload,
    };
  };

  const validate = (payload) => {
    if (!payload.operator) return "Nome operatore obbligatorio";
    if (!payload.structure) return "Cliente / Destinazione obbligatorio";
    if (!payload.shipping_date) return "Data spedizione obbligatoria";
    if (payload.items.length === 0) return "Aggiungi almeno un materiale";
    for (const it of payload.items) {
      if (it.serialized) {
        if (
          it.serials.length !== Math.floor(it.quantity) ||
          it.serials.some((s) => !s || !s.trim())
        ) {
          return `Compila tutti i seriali per ${it.name}`;
        }
      }
      // Client-side stock check (server re-checks live)
      const invItem = items.find((x) => x.id === it.page_id);
      if (invItem && it.quantity > (invItem.quantity || 0)) {
        return `${it.name}: disponibili ${invItem.quantity} — richiesti ${it.quantity}`;
      }
    }
    return null;
  };

  const submit = async () => {
    const payload = buildPayload();
    const err = validate(payload);
    if (err) {
      toast.error("Verifica dati", { description: err });
      return;
    }
    setSubmitting(true);
    try {
      const { data } = await axios.post(`${API}/checklist/send`, payload);
      const summary = (data.movements || [])
        .map((m) => `${m.name}: ${m.before} → ${m.after} ${m.unit || "pz"}`)
        .join(" • ");
      toast.success("Spedizione confermata", {
        description: summary || data.message,
        duration: 8000,
      });
      resetForm();
      await refresh();
    } catch (e) {
      const msg =
        e?.response?.data?.detail ||
        e?.message ||
        "Impossibile aggiornare il magazzino. Riprova.";
      toast.error("Errore invio", { description: msg, duration: 8000 });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 pb-32" data-testid="checklist-page">
      {/* Header */}
      <header className="sticky top-0 z-30 bg-white border-b border-slate-200">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 py-4 flex items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="text-[11px] tracking-[0.2em] uppercase text-slate-500 font-semibold">
              Elios Tech — Magazzino Notion
            </div>
            <h1 className="font-display text-2xl sm:text-3xl font-bold text-slate-900">
              Checklist Spedizione
            </h1>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <div
              className="hidden sm:flex items-center gap-2 border border-slate-200 px-3 py-2 rounded-md"
              data-testid="total-units-badge"
            >
              <Package size={18} className="text-slate-500" />
              <span className="font-mono-tight text-sm text-slate-900">
                {totalUnits} pz totali
              </span>
            </div>
            <Button
              type="button"
              variant="outline"
              onClick={doRefresh}
              disabled={loading}
              className="h-10"
              data-testid="refresh-inventory-btn"
              title="Rileggi le quantità da Notion"
            >
              <ArrowsClockwise size={16} className={loading ? "animate-spin" : ""} />
              <span className="hidden sm:inline ml-1">Aggiorna</span>
            </Button>
            <Link
              to="/admin"
              className="h-10 inline-flex items-center gap-1 px-3 border border-slate-200 rounded-md text-slate-600 hover:text-slate-900 hover:border-slate-300 text-sm"
              data-testid="admin-link"
            >
              <Gear size={16} />
              <span className="hidden sm:inline">Admin</span>
            </Link>
          </div>
        </div>
        {refreshedAt && (
          <div className="max-w-5xl mx-auto px-4 sm:px-6 pb-3 -mt-1 text-xs text-slate-500">
            Ultimo sync Notion: {refreshedAt.toLocaleTimeString("it-IT")}
          </div>
        )}
      </header>

      <main className="max-w-5xl mx-auto px-4 sm:px-6 py-6 space-y-6">
        {/* General info */}
        <section className="bg-white border border-slate-200 rounded-md p-4 sm:p-6">
          <div className="text-xs tracking-[0.1em] uppercase text-slate-500 font-semibold mb-4">
            Dati Generali
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <Label htmlFor="operator" className="text-slate-700 text-sm font-semibold">
                <User size={14} className="inline mr-1" /> Nome Operatore
              </Label>
              <Input
                id="operator"
                data-testid="input-operator"
                value={operator}
                onChange={(e) => setOperator(e.target.value)}
                placeholder="Es. Mario Rossi"
                className="h-12 mt-1 text-base"
              />
            </div>
            <div>
              <Label htmlFor="date" className="text-slate-700 text-sm font-semibold">
                <CalendarBlank size={14} className="inline mr-1" /> Data Spedizione
              </Label>
              <Input
                id="date"
                data-testid="input-date"
                type="date"
                value={shippingDate}
                onChange={(e) => setShippingDate(e.target.value)}
                className="h-12 mt-1 text-base"
              />
            </div>
            <div>
              <Label htmlFor="structure" className="text-slate-700 text-sm font-semibold">
                <Buildings size={14} className="inline mr-1" /> Cliente / Destinazione
              </Label>
              <Input
                id="structure"
                data-testid="input-structure"
                value={structure}
                onChange={(e) => setStructure(e.target.value)}
                placeholder="Es. Cliente XXXXX"
                className="h-12 mt-1 text-base"
              />
            </div>
          </div>
        </section>

        {/* Notion error state */}
        {error && (
          <div className="border border-red-200 bg-red-50 text-red-700 p-4 rounded-md flex items-start gap-2">
            <Warning size={20} weight="bold" className="shrink-0 mt-0.5" />
            <div>
              <div className="font-semibold">Notion non raggiungibile</div>
              <div className="text-sm mt-1">{error}</div>
              <Button
                type="button"
                variant="outline"
                onClick={doRefresh}
                className="mt-3 h-10 border-red-300 text-red-700"
              >
                Riprova
              </Button>
            </div>
          </div>
        )}

        {/* Category filter */}
        {!error && (
          <section className="bg-white border border-slate-200 rounded-md p-3 sm:p-4">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-xs uppercase tracking-wider text-slate-500 font-semibold mr-2">
                Filtra:
              </span>
              <Button
                type="button"
                variant={filter === CAT_ALL ? "default" : "outline"}
                onClick={() => setFilter(CAT_ALL)}
                className={`h-9 px-3 ${filter === CAT_ALL ? "bg-slate-900 hover:bg-slate-800" : ""}`}
                data-testid="filter-all"
              >
                Tutti ({items.length})
              </Button>
              {categories.map((c) => {
                const count = items.filter(
                  (it) => (it.category || "Senza categoria") === c
                ).length;
                return (
                  <Button
                    key={c}
                    type="button"
                    variant={filter === c ? "default" : "outline"}
                    onClick={() => setFilter(c)}
                    className={`h-9 px-3 ${filter === c ? "bg-slate-900 hover:bg-slate-800" : ""}`}
                    data-testid={`filter-${c}`}
                  >
                    {c} ({count})
                  </Button>
                );
              })}
            </div>
          </section>
        )}

        {/* Inventory list */}
        {loading && !items.length && (
          <div className="text-center py-10 text-slate-500">Caricamento magazzino Notion…</div>
        )}
        {!loading && !error && items.length === 0 && (
          <div className="text-center py-10 border border-dashed border-slate-300 rounded-md text-slate-500">
            Il database Notion è vuoto.
          </div>
        )}

        {Object.keys(grouped)
          .sort()
          .map((catName) => (
            <section
              key={catName}
              className="bg-white border border-slate-200 rounded-md overflow-hidden"
              data-testid={`cat-${catName}`}
            >
              <div className="px-4 sm:px-6 py-3 border-b border-slate-200 bg-slate-900 text-white flex items-center justify-between">
                <h2 className="font-display text-base sm:text-lg font-bold">
                  {catName}
                </h2>
                <span className="text-xs text-slate-400">
                  {grouped[catName].length} articoli
                </span>
              </div>
              <ul className="divide-y divide-slate-200">
                {grouped[catName].map((it) => {
                  const sel = selections[it.id] || { quantity: 0, serials: [] };
                  const avail = Number(it.quantity) || 0;
                  const outOfStock = avail <= 0;
                  const testKey = `item-${it.id}`;
                  return (
                    <li key={it.id} className="px-4 sm:px-6 py-4" data-testid={testKey}>
                      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-slate-900 font-semibold text-base">
                              {it.name}
                            </span>
                            {it.serialized && (
                              <Badge variant="outline" className="border-amber-300 text-amber-800 bg-amber-50">
                                S/N
                              </Badge>
                            )}
                            {it.code && (
                              <span className="text-xs font-mono-tight text-slate-400">
                                {it.code}
                              </span>
                            )}
                          </div>
                          <div className="text-xs text-slate-500 mt-0.5">
                            Disponibili:{" "}
                            <span
                              className={`font-mono-tight font-semibold ${
                                outOfStock ? "text-red-600" : "text-slate-700"
                              }`}
                              data-testid={`${testKey}-avail`}
                            >
                              {avail} {it.unit}
                            </span>
                          </div>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          <Button
                            type="button"
                            variant="outline"
                            size="icon"
                            onClick={() => bump(it, -1)}
                            disabled={sel.quantity <= 0}
                            className="h-12 w-12 border-slate-300"
                            data-testid={`${testKey}-dec`}
                            aria-label="Diminuisci"
                          >
                            <Minus size={20} weight="bold" />
                          </Button>
                          <Input
                            type="number"
                            min={0}
                            max={avail}
                            step={it.unit === "m" ? "0.5" : "1"}
                            value={sel.quantity}
                            onChange={(e) => {
                              const v = parseFloat(e.target.value || "0");
                              setQuantity(it, isFinite(v) ? v : 0);
                            }}
                            className="h-12 w-20 text-center text-lg font-mono-tight font-semibold"
                            data-testid={`${testKey}-value`}
                            disabled={outOfStock}
                          />
                          <Button
                            type="button"
                            variant="default"
                            size="icon"
                            onClick={() => bump(it, 1)}
                            disabled={outOfStock || sel.quantity >= avail}
                            className="h-12 w-12 bg-slate-900 hover:bg-slate-800"
                            data-testid={`${testKey}-inc`}
                            aria-label="Aumenta"
                          >
                            <Plus size={20} weight="bold" />
                          </Button>
                        </div>
                      </div>

                      {it.serialized && sel.quantity > 0 && (
                        <div className="mt-4 space-y-2 border-l-2 border-amber-400 pl-4">
                          <div className="text-[11px] tracking-[0.1em] uppercase text-slate-500 font-semibold">
                            Seriali (S/N) — {Math.floor(sel.quantity)} richiesti
                          </div>
                          {sel.serials.map((sn, idx) => {
                            const sid = `${testKey}-sn-${idx}`;
                            return (
                              <div key={idx} className="flex gap-2">
                                <Input
                                  value={sn}
                                  onChange={(e) => setSerial(it.id, idx, e.target.value)}
                                  placeholder={`Seriale #${idx + 1}`}
                                  className="h-12 font-mono-tight"
                                  data-testid={sid}
                                />
                                <Button
                                  type="button"
                                  variant="outline"
                                  onClick={() => openScanner(it.id, idx, `${it.name} #${idx + 1}`)}
                                  className="h-12 border-slate-300 shrink-0"
                                  data-testid={`${sid}-scan`}
                                  aria-label="Scansiona"
                                >
                                  <QrCode size={20} />
                                </Button>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}

        {/* Notes */}
        {!error && items.length > 0 && (
          <section className="bg-white border border-slate-200 rounded-md p-4 sm:p-6">
            <Label htmlFor="notes" className="text-slate-700 text-sm font-semibold">
              Note aggiuntive (opzionale)
            </Label>
            <Textarea
              id="notes"
              data-testid="input-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Eventuali note per la spedizione…"
              className="mt-2 min-h-[90px]"
            />
          </section>
        )}
      </main>

      {/* Sticky footer */}
      <footer className="fixed bottom-0 inset-x-0 bg-white border-t border-slate-200 z-40">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 py-3 flex items-center justify-between gap-3">
          <div className="text-sm text-slate-600">
            <span className="font-mono-tight font-semibold text-slate-900">{totalUnits}</span>{" "}
            pz da spedire
          </div>
          <Button
            type="button"
            onClick={submit}
            disabled={submitting || totalUnits === 0}
            className="h-12 px-6 bg-blue-600 hover:bg-blue-700 text-white font-semibold text-base"
            data-testid="submit-checklist-btn"
          >
            {submitting ? (
              <>
                <CircleNotch size={20} className="mr-2 animate-spin" />
                Conferma in corso…
              </>
            ) : (
              <>
                <PaperPlaneTilt size={20} className="mr-2" weight="fill" />
                CONFERMA SPEDIZIONE
              </>
            )}
          </Button>
        </div>
      </footer>

      <BarcodeScanner
        open={!!scanTarget}
        onClose={closeScanner}
        onDetected={onScanned}
        label={scanTarget?.label}
      />
    </div>
  );
}
