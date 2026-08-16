import { useEffect, useMemo, useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { useInventoryCtx } from "../lib/InventoryContext";
import { useAuth } from "../lib/AuthContext";
import ScannerBar from "../components/ScannerBar";
import QtyDialog from "../components/QtyDialog";
import ProductPicker from "../components/ProductPicker";
import ConfirmSubmitDialog from "../components/ConfirmSubmitDialog";
import SerialCollector from "../components/SerialCollector";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { Button } from "../components/ui/button";
import { Textarea } from "../components/ui/textarea";
import { Badge } from "../components/ui/badge";
import { fetchServerToday } from "../lib/tz";
import {
  ArrowSquareIn,
  Trash,
  MagnifyingGlass,
  Package,
  CircleNotch,
  X,
  Truck,
  User,
  CalendarBlank,
  Barcode,
  Plus,
  Minus,
} from "@phosphor-icons/react";

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;
const todayISO = () => new Date().toISOString().slice(0, 10);

export default function ArriviPage() {
  const { items, lookupLocalBySku, refresh } = useInventoryCtx();
  const { user } = useAuth();
  const operatorName = user?.full_name || user?.username || "";

  const [fornitore, setFornitore] = useState("");
  const [arrivalDate, setArrivalDate] = useState(todayISO());
  const [notes, setNotes] = useState("");

  // F8 — Sostituisce la data locale con quella del server nel tz configurato.
  useEffect(() => {
    fetchServerToday().then((d) => d && setArrivalDate(d));
  }, []);
  const [list, setList] = useState([]); // {id, name, serialized, unit, quantity, serials[]}
  const [lastScan, setLastScan] = useState(null);
  const [qtyDialog, setQtyDialog] = useState(null); // {item}
  const [picker, setPicker] = useState(null); // {filter, pendingSn}
  const [pending, setPending] = useState(null); // {id, name} legacy (used briefly during scanner→product step)
  const [serialSession, setSerialSession] = useState(null); // {id, name, quantity, serials[]} — new flow A Seriale — modello selezionato per SN successivi
  const [rientroConfirm, setRientroConfirm] = useState(null); // {sn, productId, productName, cliente, shippedDate}
  const [showConfirm, setShowConfirm] = useState(false);
  const [confirmError, setConfirmError] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  const focusScanner = () => {
    setTimeout(() => document.getElementById("scanner-input")?.focus(), 0);
  };

  useEffect(() => {
    if (!qtyDialog && !picker && !rientroConfirm) focusScanner();
  }, [qtyDialog, picker, rientroConfirm]);

  const totalUnits = list.reduce((a, li) => a + (li.quantity || 0), 0);

  const snAlreadyInList = (sn) =>
    list.some(
      (li) =>
        li.serialized &&
        (li.serials || []).some((s) => (s || "").toLowerCase() === sn.toLowerCase())
    );

  const addSerialToList = (product, sn) => {
    setList((prev) => {
      const exist = prev.find((li) => li.id === product.id);
      if (exist) {
        return prev.map((li) =>
          li.id === product.id
            ? { ...li, quantity: li.quantity + 1, serials: [...li.serials, sn] }
            : li
        );
      }
      const invIt = items.find((i) => i.id === product.id);
      return [
        ...prev,
        {
          id: product.id,
          name: product.name,
          serialized: true,
          unit: invIt?.unit || "pz",
          quantity: 1,
          serials: [sn],
        },
      ];
    });
  };

  const addQtyToList = (product, qty) => {
    setList((prev) => {
      const exist = prev.find((li) => li.id === product.id);
      if (exist) {
        return prev.map((li) =>
          li.id === product.id ? { ...li, quantity: li.quantity + qty } : li
        );
      }
      return [
        ...prev,
        {
          id: product.id,
          name: product.name,
          serialized: false,
          unit: product.unit || "pz",
          quantity: qty,
          serials: [],
        },
      ];
    });
  };

  const removeRow = (id) => setList((prev) => prev.filter((li) => li.id !== id));

  const removeSerial = (id, snIdx) => {
    setList((prev) =>
      prev
        .map((li) => {
          if (li.id !== id) return li;
          const s2 = li.serials.filter((_, i) => i !== snIdx);
          return s2.length === 0 ? null : { ...li, serials: s2, quantity: s2.length };
        })
        .filter(Boolean)
    );
  };

  const handleScannedCode = async (rawCode) => {
    const code = (rawCode || "").trim();
    if (!code) return;

    // (1) LOCAL SKU pre-check — instantaneo, senza API
    const local = lookupLocalBySku(code);
    if (local && !local.configured) {
      setLastScan({
        type: "error",
        title: "🔴 TIPO GESTIONE NON CONFIGURATO",
        subtitle: `${local.name} — configurarlo da Admin › Gestione Prodotti`,
        code,
      });
      return;
    }
    if (local && !local.serialized) {
      setPending(null);
      setQtyDialog({ item: local, initial: 1 });
      setLastScan({ type: "ok", title: "PRODOTTO RICONOSCIUTO", subtitle: `${local.name} — inserisci quantità`, code });
      return;
    }
    if (local && local.serialized) {
      // NEW UX: chiedi prima la quantità, poi apri il collector
      setPending(null);
      setQtyDialog({ item: local, initial: 1, forSerials: true });
      setLastScan({ type: "ok", title: "MODELLO A SERIALE", subtitle: `${local.name} — indica la quantità`, code });
      return;
    }

    // (2) Duplicato nella sessione corrente
    if (snAlreadyInList(code)) {
      setLastScan({ type: "error", title: "🔴 SERIALE GIÀ INSERITO", subtitle: `SN ${code} è già nella lista corrente`, code });
      return;
    }

    // (3) Server-side check: latest-movement status. Un rientro (out) è OK.
    try {
      const { data } = await axios.get(`${API}/inventory/lookup`, { params: { code } });
      if (data.status === "in_warehouse") {
        setLastScan({
          type: "error",
          title: "🔴 SERIALE GIÀ PRESENTE IN MAGAZZINO",
          subtitle:
            `SN ${code} risulta entrato` +
            (data.receipt_date ? ` il ${data.receipt_date}` : "") +
            " — nessun rientro possibile",
          code,
        });
        return;
      }
      if (data.status === "ok" && data.item) {
        // matched_by: "sku" | "barcode" — entrambi = prodotto riconosciuto
        if (!data.item.configured) {
          setLastScan({
            type: "error",
            title: "🔴 TIPO GESTIONE NON CONFIGURATO",
            subtitle: `${data.item.name} — configurarlo da Admin › Gestione Prodotti`,
            code,
          });
          return;
        }
        if (data.item.serialized) {
          setPending(null);
          setQtyDialog({ item: data.item, initial: 1, forSerials: true });
          setLastScan({ type: "ok", title: "MODELLO A SERIALE", subtitle: `${data.item.name} — indica la quantità`, code });
        } else {
          setQtyDialog({ item: data.item, initial: 1 });
          setLastScan({ type: "ok", title: "PRODOTTO RICONOSCIUTO", subtitle: `${data.item.name}`, code });
        }
        return;
      }
      if (data.status === "out" && data.item) {
        // F6-rientri: NON reintegrare automaticamente. Chiedi conferma con ultimo cliente.
        setRientroConfirm({
          sn: code,
          productId: data.item.id,
          productName: data.item.name,
          cliente: data.shipped_to || "sconosciuto",
          shippedDate: data.shipped_date || null,
        });
        setLastScan(null);
        return;
      }
      // status === "not_found" → SN nuovo (OK per arrivi!)
      if (pending) {
        addSerialToList(pending, code);
        setLastScan({ type: "ok", title: "🟢 SERIALE AGGIUNTO", subtitle: `${pending.name} — SN ${code}`, code });
      } else {
        setPicker({ filter: "serialized", pendingSn: code });
        setLastScan({ type: "warn", title: "🟠 SELEZIONA IL MODELLO", subtitle: `SN ${code} — indica il prodotto`, code });
      }
    } catch (e) {
      setLastScan({ type: "error", title: "Errore ricerca Notion", subtitle: e?.response?.data?.detail || e?.message || "" });
    }
  };

  const openConfirm = () => {
    if (!fornitore.trim()) {
      toast.error("Fornitore / Mittente obbligatorio");
      return;
    }
    if (!operatorName) {
      toast.error("Operatore non identificato — rieffettua il login");
      return;
    }
    if (!arrivalDate) {
      toast.error("Data arrivo obbligatoria");
      return;
    }
    if (list.length === 0) {
      toast.error("Aggiungi almeno un prodotto");
      return;
    }
    setConfirmError(null);
    setShowConfirm(true);
  };

  const submit = async () => {
    setSubmitting(true);
    setConfirmError(null);
    try {
      const payload = {
        operator: operatorName,
        arrival_date: arrivalDate,
        fornitore: fornitore.trim(),
        notes: notes.trim() || null,
        items: list.map((li) => ({
          page_id: li.id,
          name: li.name,
          unit: li.unit || "pz",
          serialized: !!li.serialized,
          quantity: li.quantity,
          serials: li.serialized ? li.serials : [],
        })),
      };
      const { data } = await axios.post(`${API}/arrivi/send`, payload);
      toast.success("Arrivo confermato", { description: data.message, duration: 6000 });
      setList([]);
      setFornitore("");
      setNotes("");
      setPending(null);
      setLastScan(null);
      setShowConfirm(false);
      await refresh();
    } catch (e) {
      const msg = e?.response?.data?.detail || e?.message || "Errore invio";
      setConfirmError(msg);
      toast.error("Errore", { description: msg, duration: 8000 });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="pb-32" data-testid="arrivi-page">
      <div className="max-w-5xl mx-auto px-4 sm:px-6 pt-6 pb-2 flex items-end justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-emerald-600">
            <ArrowSquareIn size={16} weight="bold" />
            <span className="et-eyebrow text-emerald-700">Ingressi</span>
          </div>
          <h1 className="et-page-heading text-3xl sm:text-4xl mt-1">Arrivi</h1>
          <p className="text-slate-500 mt-1 text-sm">
            Registra ingressi in Consegne Wallbox / Entrate. Il Fornitore è solo per l'email.
          </p>
        </div>
        <div
          className="hidden sm:flex items-center gap-2 et-card px-3 py-2 shrink-0"
          data-testid="total-arrivi-badge"
        >
          <Package size={18} className="text-emerald-600" />
          <span className="font-mono-tight text-sm text-slate-900">
            {totalUnits} pz in arrivo
          </span>
        </div>
      </div>

      <main className="max-w-5xl mx-auto px-4 sm:px-6 py-4 space-y-6">
        {/* Dati generali */}
        <section className="bg-white border border-slate-200 rounded-md p-4 sm:p-6">
          <div className="text-xs tracking-[0.1em] uppercase text-slate-500 font-semibold mb-4">
            Dati Generali
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <Label htmlFor="fornitore" className="text-slate-700 text-sm font-semibold">
                <Truck size={14} className="inline mr-1" /> Fornitore / Mittente
              </Label>
              <Input
                id="fornitore"
                data-testid="input-fornitore"
                value={fornitore}
                onChange={(e) => setFornitore(e.target.value)}
                placeholder="Es. ABB Italia"
                className="h-12 mt-1 text-base"
              />
              <div className="text-[11px] text-slate-400 mt-1">Solo per l'email — non salvato su Notion.</div>
            </div>
            <div>
              <Label className="text-slate-700 text-sm font-semibold">
                <User size={14} className="inline mr-1" /> Operatore (auto)
              </Label>
              <div
                className="h-12 mt-1 px-3 flex items-center border border-slate-200 bg-slate-50 rounded-md text-slate-900 font-semibold"
                data-testid="operator-readonly"
                title="L'operatore è determinato dal login (non modificabile)"
              >
                {operatorName || "—"}
                <span className="ml-auto text-[10px] uppercase tracking-wider text-slate-400">
                  auto
                </span>
              </div>
            </div>
            <div>
              <Label htmlFor="date" className="text-slate-700 text-sm font-semibold">
                <CalendarBlank size={14} className="inline mr-1" /> Data Arrivo
              </Label>
              <Input
                id="date"
                data-testid="input-date"
                type="date"
                value={arrivalDate}
                onChange={(e) => setArrivalDate(e.target.value)}
                className="h-12 mt-1 text-base"
              />
            </div>
          </div>
        </section>

        {/* Scanner */}
        <ScannerBar
          onScanned={handleScannedCode}
          lastScan={lastScan}
          onClearLastScan={() => setLastScan(null)}
          hint={
            pending
              ? `In attesa dei seriali per: ${pending.name}`
              : "Inserisci o scansiona un codice prodotto o un seriale — puoi anche selezionare manualmente qui sotto"
          }
        />

        {/* Contesto: modello serializzato selezionato + selettore prodotto manuale */}
        <section className="bg-white border border-slate-200 rounded-md p-4">
          <div className="flex flex-wrap items-center gap-2 justify-between">
            <div className="min-w-0 flex-1">
              {pending ? (
                <div
                  className="flex items-start gap-2 flex-wrap"
                  data-testid="pending-serialized-banner"
                >
                  <Badge className="bg-emerald-600 hover:bg-emerald-700 whitespace-normal break-words max-w-full text-left leading-snug">
                    🎯 Modello: {pending.name}
                  </Badge>
                  <span className="text-xs text-slate-500 break-words">
                    Ora inserisci o scansiona il seriale uno alla volta — digitazione manuale, ENTER, CERCA o scanner sono equivalenti.
                  </span>
                  <button
                    type="button"
                    onClick={() => setPending(null)}
                    className="text-xs text-red-600 hover:underline"
                    data-testid="clear-pending-btn"
                  >
                    Rimuovi selezione
                  </button>
                </div>
              ) : (
                <div className="text-sm text-slate-500">
                  Nessun modello selezionato. Inserisci o scansiona un barcode, oppure seleziona il prodotto manualmente.
                </div>
              )}
            </div>
            <div className="flex gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => setPicker({ filter: "serialized" })}
                className="h-10"
                data-testid="pick-serialized-btn"
              >
                <MagnifyingGlass size={16} className="mr-1" /> Prodotto a Seriale
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => setPicker({ filter: "quantity" })}
                className="h-10"
                data-testid="pick-quantity-btn"
              >
                <MagnifyingGlass size={16} className="mr-1" /> Prodotto a Quantità
              </Button>
            </div>
          </div>
        </section>

        {/* Lista temporanea */}
        <section
          className="bg-white border border-slate-200 rounded-md overflow-hidden"
          data-testid="arrivi-list"
        >
          <div className="px-4 py-3 border-b border-slate-200 bg-slate-900 text-white flex items-center justify-between">
            <h2 className="font-display text-base font-bold">Lista temporanea</h2>
            <span className="text-xs text-slate-300">
              {list.length} riga{list.length === 1 ? "" : "he"} · {totalUnits} pz
            </span>
          </div>
          {list.length === 0 ? (
            <div className="px-4 py-10 text-center text-slate-400 text-sm">
              Ancora nessun prodotto. Inserisci, scansiona o seleziona per iniziare.
            </div>
          ) : (
            <ul className="divide-y divide-slate-100">
              {list.map((li) => (
                <li key={li.id} className="px-3 sm:px-4 py-3" data-testid={`arrivi-row-${li.id}`}>
                  <div className="flex items-start justify-between gap-3 flex-wrap">
                    <div className="min-w-0 flex-1">
                      <div className="font-semibold text-slate-900 flex items-start gap-2 flex-wrap">
                        <span className="break-words min-w-0 flex-1">{li.name}</span>
                        {li.serialized ? (
                          <Badge
                            variant="outline"
                            className="border-amber-300 text-amber-800 bg-amber-50 shrink-0"
                          >
                            A Seriale
                          </Badge>
                        ) : (
                          <Badge
                            variant="outline"
                            className="border-slate-300 text-slate-600 shrink-0"
                          >
                            A Quantità
                          </Badge>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <span className="font-mono-tight font-semibold text-slate-900">
                        {li.quantity} {li.unit || "pz"}
                      </span>
                      {!li.serialized && (
                        <>
                          <Button
                            type="button"
                            variant="outline"
                            size="icon"
                            onClick={() =>
                              setList((prev) =>
                                prev
                                  .map((x) =>
                                    x.id === li.id
                                      ? { ...x, quantity: Math.max(0, x.quantity - 1) }
                                      : x
                                  )
                                  .filter((x) => x.quantity > 0)
                              )
                            }
                            className="h-8 w-8"
                            aria-label="Decrementa"
                          >
                            <Minus size={16} weight="bold" />
                          </Button>
                          <Button
                            type="button"
                            variant="outline"
                            size="icon"
                            onClick={() =>
                              setList((prev) =>
                                prev.map((x) =>
                                  x.id === li.id ? { ...x, quantity: x.quantity + 1 } : x
                                )
                              )
                            }
                            className="h-8 w-8"
                            aria-label="Incrementa"
                          >
                            <Plus size={16} weight="bold" />
                          </Button>
                        </>
                      )}
                      <Button
                        type="button"
                        variant="outline"
                        size="icon"
                        onClick={() => removeRow(li.id)}
                        className="h-8 w-8 border-red-300 text-red-600 hover:bg-red-50"
                        aria-label="Rimuovi"
                        data-testid={`arrivi-remove-${li.id}`}
                      >
                        <Trash size={16} />
                      </Button>
                    </div>
                  </div>
                  {li.serialized && li.serials.length > 0 && (
                    <ul className="mt-2 ml-4 space-y-1">
                      {li.serials.map((sn, idx) => (
                        <li
                          key={`${li.id}-${idx}`}
                          className="flex items-center gap-2 text-sm font-mono-tight text-slate-700"
                        >
                          <Barcode size={14} className="text-slate-400" />
                          <span>SN {sn}</span>
                          <button
                            type="button"
                            onClick={() => removeSerial(li.id, idx)}
                            className="text-red-500 hover:text-red-700 ml-auto"
                            aria-label="Rimuovi seriale"
                            data-testid={`arrivi-remove-sn-${li.id}-${idx}`}
                          >
                            <X size={14} />
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* Note */}
        <section className="bg-white border border-slate-200 rounded-md p-4 sm:p-6">
          <Label htmlFor="notes" className="text-slate-700 text-sm font-semibold">
            Note aggiuntive (opzionale)
          </Label>
          <Textarea
            id="notes"
            data-testid="input-notes"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Eventuali note per questo arrivo…"
            className="mt-2 min-h-[90px]"
          />
        </section>
      </main>

      <footer className="fixed bottom-0 inset-x-0 bg-white border-t border-slate-200 z-40">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 py-3 flex items-center justify-between gap-3">
          <div className="text-sm text-slate-600">
            <span className="font-mono-tight font-semibold text-slate-900">{totalUnits}</span>{" "}
            pz in arrivo · {list.length} prodotti
          </div>
          <Button
            type="button"
            onClick={openConfirm}
            disabled={submitting || list.length === 0}
            className="h-12 px-6 bg-emerald-600 hover:bg-emerald-700 text-white font-semibold text-base"
            data-testid="submit-arrivo-btn"
          >
            {submitting ? (
              <>
                <CircleNotch size={20} className="mr-2 animate-spin" /> Conferma in corso…
              </>
            ) : (
              <>
                <ArrowSquareIn size={20} weight="bold" className="mr-2" /> CONFERMA ARRIVO
              </>
            )}
          </Button>
        </div>
      </footer>

      {qtyDialog && (
        <QtyDialog
          item={qtyDialog.item}
          initial={qtyDialog.initial}
          label={qtyDialog.forSerials ? "Quantità pezzi" : "Quantità in arrivo"}
          confirmLabel={qtyDialog.forSerials ? "Continua" : "Aggiungi"}
          variant="arrivi"
          onClose={() => setQtyDialog(null)}
          onConfirm={(qty) => {
            if (qtyDialog.forSerials) {
              const qi = Math.max(1, Math.floor(qty));
              setSerialSession({
                id: qtyDialog.item.id,
                name: qtyDialog.item.name,
                unit: qtyDialog.item.unit || "pz",
                quantity: qi,
                serials: Array(qi).fill(""),
              });
              setQtyDialog(null);
              return;
            }
            addQtyToList(qtyDialog.item, qty);
            setLastScan({
              type: "ok",
              title: "🟢 AGGIUNTO ALLA LISTA",
              subtitle: `${qtyDialog.item.name} — ${qty} ${qtyDialog.item.unit || "pz"}`,
            });
            setQtyDialog(null);
          }}
        />
      )}

      {serialSession && (
        <div className="max-w-5xl mx-auto px-4 sm:px-6">
          <SerialCollector
            pending={serialSession}
            mode="arrivi"
            existingSerials={list.flatMap((li) => li.serials || [])}
            onChange={setSerialSession}
            onCancel={() => setSerialSession(null)}
            onCommit={(sess) => {
              // Merge tutti i seriali come singola riga (o append se esiste già)
              setList((prev) => {
                const existing = prev.find((x) => x.id === sess.id);
                if (existing) {
                  const merged = {
                    ...existing,
                    serials: [...existing.serials, ...sess.serials],
                    quantity: (existing.quantity || 0) + sess.quantity,
                  };
                  return prev.map((x) => (x.id === sess.id ? merged : x));
                }
                return [
                  ...prev,
                  {
                    id: sess.id,
                    name: sess.name,
                    unit: sess.unit || "pz",
                    serialized: true,
                    quantity: sess.quantity,
                    serials: sess.serials.slice(),
                  },
                ];
              });
              setLastScan({
                type: "ok",
                title: "🟢 SERIALI AGGIUNTI",
                subtitle: `${sess.name} — ${sess.quantity} pz`,
              });
              setSerialSession(null);
            }}
          />
        </div>
      )}

      {picker && (
        <ProductPicker
          items={items}
          filter={picker.filter}
          onClose={() => setPicker(null)}
          onSelect={(product) => {
            if (picker.filter === "serialized") {
              // NEW UX: chiedi la quantità e apri il collector
              setPicker(null);
              setPending(null);
              setQtyDialog({ item: product, initial: 1, forSerials: true });
              return;
            }
            setPicker(null);
            setQtyDialog({ item: product, initial: 1 });
          }}
        />
      )}

      <ConfirmSubmitDialog
        open={showConfirm}
        kind="arrivo"
        items={list.map((li) => ({
          name: li.name,
          serialized: !!li.serialized,
          quantity: li.quantity,
          unit: li.unit || "pz",
          serials: li.serialized ? li.serials : [],
          code: li.code,
        }))}
        meta={[
          { label: "Fornitore", value: fornitore.trim() },
          { label: "Operatore (loggato)", value: operatorName },
          { label: "Data", value: arrivalDate },
        ]}
        submitting={submitting}
        errorMsg={confirmError}
        onCancel={() => {
          if (submitting) return;
          setShowConfirm(false);
          setConfirmError(null);
        }}
        onConfirm={submit}
      />

      {rientroConfirm && (
        <div
          className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
          data-testid="rientro-confirm-dialog"
        >
          <div className="bg-white rounded-lg w-full max-w-md p-6 shadow-xl">
            <div className="text-[10px] tracking-[0.2em] uppercase text-amber-700 font-semibold">
              ⚠️ Rientro Wallbox
            </div>
            <div className="font-display text-xl font-bold text-slate-900 mt-2">
              Seriale già associato a un cliente
            </div>
            <div className="mt-4 text-sm text-slate-700 leading-relaxed">
              Il seriale{" "}
              <span className="font-mono-tight font-semibold text-slate-900">
                {rientroConfirm.sn}
              </span>{" "}
              risulta associato al cliente{" "}
              <span className="font-semibold text-slate-900">
                {rientroConfirm.cliente}
              </span>
              {rientroConfirm.shippedDate && (
                <>
                  {" "}(uscita del{" "}
                  <span className="font-mono-tight">
                    {rientroConfirm.shippedDate}
                  </span>
                  )
                </>
              )}
              .
              <div className="mt-3 text-slate-600">
                Vuoi davvero reintegrarlo in magazzino?
              </div>
            </div>
            <div className="mt-6 flex gap-2 justify-end">
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  setRientroConfirm(null);
                  focusScanner();
                }}
                className="h-11"
                data-testid="rientro-cancel-btn"
              >
                No
              </Button>
              <Button
                type="button"
                onClick={() => {
                  const product = {
                    id: rientroConfirm.productId,
                    name: rientroConfirm.productName,
                  };
                  addSerialToList(product, rientroConfirm.sn);
                  setPending(product);
                  setLastScan({
                    type: "ok",
                    title: "🟢 RIENTRO CONFERMATO",
                    subtitle: `${product.name} — SN ${rientroConfirm.sn}`,
                    code: rientroConfirm.sn,
                  });
                  setRientroConfirm(null);
                  focusScanner();
                }}
                className="h-11 bg-amber-600 hover:bg-amber-700 text-white"
                data-testid="rientro-confirm-btn"
              >
                Sì, reintegra
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
