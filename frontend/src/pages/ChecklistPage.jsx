import { useMemo, useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { CATEGORIES, buildInitialState } from "../lib/catalog";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { Button } from "../components/ui/button";
import { Textarea } from "../components/ui/textarea";
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
} from "@phosphor-icons/react";

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

const todayISO = () => new Date().toISOString().slice(0, 10);

export default function ChecklistPage() {
  const [operator, setOperator] = useState("");
  const [shippingDate, setShippingDate] = useState(todayISO());
  const [structure, setStructure] = useState("");
  const [notes, setNotes] = useState("");
  const [items, setItems] = useState(buildInitialState);
  const [submitting, setSubmitting] = useState(false);
  const [scanTarget, setScanTarget] = useState(null); // {key, index, label}

  const totalUnits = useMemo(
    () => Object.values(items).reduce((a, i) => a + (i.quantity || 0), 0),
    [items]
  );

  const updateQuantity = (key, delta, requiresSerial) => {
    setItems((prev) => {
      const current = prev[key] || { quantity: 0, serials: [] };
      const nextQty = Math.max(0, Math.min(99, current.quantity + delta));
      let serials = requiresSerial ? [...current.serials] : [];
      if (requiresSerial) {
        if (nextQty > serials.length) {
          while (serials.length < nextQty) serials.push("");
        } else if (nextQty < serials.length) {
          serials = serials.slice(0, nextQty);
        }
      }
      return { ...prev, [key]: { quantity: nextQty, serials } };
    });
  };

  const setSerial = (key, index, value) => {
    setItems((prev) => {
      const current = prev[key];
      const serials = [...current.serials];
      serials[index] = value;
      return { ...prev, [key]: { ...current, serials } };
    });
  };

  const openScanner = (key, index, label) => setScanTarget({ key, index, label });
  const closeScanner = () => setScanTarget(null);
  const onScanned = (value) => {
    if (scanTarget) {
      setSerial(scanTarget.key, scanTarget.index, value);
      toast.success("Seriale acquisito", { description: value });
      setScanTarget(null);
    }
  };

  const resetForm = () => {
    setOperator("");
    setShippingDate(todayISO());
    setStructure("");
    setNotes("");
    setItems(buildInitialState());
  };

  const buildPayload = () => {
    const payloadItems = [];
    CATEGORIES.forEach((cat) => {
      cat.products.forEach((name) => {
        const entry = items[`${cat.id}::${name}`];
        if (entry && entry.quantity > 0) {
          payloadItems.push({
            category: cat.id,
            name,
            quantity: entry.quantity,
            serials: cat.requiresSerial ? entry.serials : [],
          });
        }
      });
    });
    return {
      operator: operator.trim(),
      shipping_date: shippingDate,
      structure: structure.trim(),
      notes: notes.trim() || null,
      items: payloadItems,
    };
  };

  const validate = (payload) => {
    if (!payload.operator) return "Nome operatore obbligatorio";
    if (!payload.structure) return "Struttura destinazione obbligatoria";
    if (!payload.shipping_date) return "Data spedizione obbligatoria";
    if (payload.items.length === 0) return "Aggiungi almeno un prodotto";
    for (const it of payload.items) {
      const cat = CATEGORIES.find((c) => c.id === it.category);
      if (cat?.requiresSerial) {
        if (
          it.serials.length !== it.quantity ||
          it.serials.some((s) => !s || !s.trim())
        ) {
          return `Compila tutti i seriali per ${it.name}`;
        }
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
      toast.success("Checklist inviata", {
        description: data.message || "Email inviata correttamente",
      });
      resetForm();
    } catch (e) {
      const msg =
        e?.response?.data?.detail || e?.message || "Invio fallito, riprova.";
      toast.error("Errore invio", { description: msg });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50" data-testid="checklist-page">
      {/* Header */}
      <header className="sticky top-0 z-30 bg-white border-b border-slate-200">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 py-4 flex items-center justify-between">
          <div>
            <div className="text-[11px] tracking-[0.2em] uppercase text-slate-500 font-semibold">
              Elios Tech — Magazzino
            </div>
            <h1 className="font-display text-2xl sm:text-3xl font-bold text-slate-900">
              Checklist Spedizione
            </h1>
          </div>
          <div
            className="hidden sm:flex items-center gap-2 border border-slate-200 px-3 py-2 rounded-md"
            data-testid="total-units-badge"
          >
            <Package size={18} className="text-slate-500" />
            <span className="font-mono-tight text-sm text-slate-900">
              {totalUnits} pz totali
            </span>
          </div>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 sm:px-6 py-6 pb-32 space-y-8">
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
                <Buildings size={14} className="inline mr-1" /> Struttura Destinazione
              </Label>
              <Input
                id="structure"
                data-testid="input-structure"
                value={structure}
                onChange={(e) => setStructure(e.target.value)}
                placeholder="Nome struttura destinataria"
                className="h-12 mt-1 text-base"
              />
            </div>
          </div>
        </section>

        {/* Categories */}
        {CATEGORIES.map((cat) => (
          <section
            key={cat.id}
            className="bg-white border border-slate-200 rounded-md overflow-hidden"
            data-testid={`category-${cat.id}`}
          >
            <div className="px-4 sm:px-6 py-4 border-b border-slate-200 bg-slate-900 text-white flex items-center justify-between">
              <div>
                <div className="text-[10px] tracking-[0.2em] uppercase text-slate-400 font-semibold">
                  {cat.id === "cat3" ? "Solo Quantità" : "Quantità + Seriali"}
                </div>
                <h2 className="font-display text-lg sm:text-xl font-bold">
                  {cat.name}
                </h2>
                <div className="text-slate-400 text-xs mt-0.5">{cat.subtitle}</div>
              </div>
            </div>
            <ul className="divide-y divide-slate-200">
              {cat.products.map((name) => {
                const key = `${cat.id}::${name}`;
                const entry = items[key] || { quantity: 0, serials: [] };
                const qtyId = `qty-${cat.id}-${name.replace(/\s+/g, "-")}`;
                return (
                  <li key={name} className="px-4 sm:px-6 py-4">
                    <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                      <div className="text-slate-900 font-medium text-base sm:text-lg">
                        {name}
                      </div>
                      <div className="flex items-center gap-2" data-testid={qtyId}>
                        <Button
                          type="button"
                          variant="outline"
                          size="icon"
                          onClick={() => updateQuantity(key, -1, cat.requiresSerial)}
                          className="h-12 w-12 border-slate-300"
                          data-testid={`${qtyId}-dec`}
                          aria-label={`Diminuisci ${name}`}
                        >
                          <Minus size={20} weight="bold" />
                        </Button>
                        <Input
                          type="number"
                          min={0}
                          max={99}
                          value={entry.quantity}
                          onChange={(e) => {
                            const v = Math.max(
                              0,
                              Math.min(99, parseInt(e.target.value || "0", 10))
                            );
                            const delta = v - entry.quantity;
                            updateQuantity(key, delta, cat.requiresSerial);
                          }}
                          className="h-12 w-16 text-center text-lg font-mono-tight font-semibold"
                          data-testid={`${qtyId}-value`}
                        />
                        <Button
                          type="button"
                          variant="default"
                          size="icon"
                          onClick={() => updateQuantity(key, 1, cat.requiresSerial)}
                          className="h-12 w-12 bg-slate-900 hover:bg-slate-800"
                          data-testid={`${qtyId}-inc`}
                          aria-label={`Aumenta ${name}`}
                        >
                          <Plus size={20} weight="bold" />
                        </Button>
                      </div>
                    </div>

                    {cat.requiresSerial && entry.quantity > 0 && (
                      <div className="mt-4 space-y-2 border-l-2 border-amber-400 pl-4">
                        <div className="text-[11px] tracking-[0.1em] uppercase text-slate-500 font-semibold">
                          Seriali (S/N) — {entry.quantity} richiesti
                        </div>
                        {entry.serials.map((sn, idx) => {
                          const sid = `sn-${cat.id}-${name.replace(/\s+/g, "-")}-${idx}`;
                          return (
                            <div key={idx} className="flex gap-2">
                              <Input
                                value={sn}
                                onChange={(e) => setSerial(key, idx, e.target.value)}
                                placeholder={`Seriale #${idx + 1}`}
                                className="h-12 font-mono-tight"
                                data-testid={sid}
                              />
                              <Button
                                type="button"
                                variant="outline"
                                onClick={() => openScanner(key, idx, `${name} #${idx + 1}`)}
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
      </main>

      {/* Sticky footer submit */}
      <footer className="fixed bottom-0 inset-x-0 bg-white border-t border-slate-200 z-40">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 py-3 flex items-center justify-between gap-3">
          <div className="text-sm text-slate-600">
            <span className="font-mono-tight font-semibold text-slate-900">
              {totalUnits}
            </span>{" "}
            pz da spedire
          </div>
          <Button
            type="button"
            onClick={submit}
            disabled={submitting}
            className="h-12 px-6 bg-blue-600 hover:bg-blue-700 text-white font-semibold text-base"
            data-testid="submit-checklist-btn"
          >
            {submitting ? (
              <>
                <CircleNotch size={20} className="mr-2 animate-spin" />
                Invio in corso…
              </>
            ) : (
              <>
                <PaperPlaneTilt size={20} className="mr-2" weight="fill" />
                INVIA CHECKLIST
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
