import { useEffect, useMemo, useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { useInventoryCtx } from "../lib/InventoryContext";
import { useAuth } from "../lib/AuthContext";
import ScannerBar from "../components/ScannerBar";
import QtyDialog from "../components/QtyDialog";
import ConfirmSubmitDialog from "../components/ConfirmSubmitDialog";
import SerialCollector from "../components/SerialCollector";
import ProductPicker from "../components/ProductPicker";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { Button } from "../components/ui/button";
import { Textarea } from "../components/ui/textarea";
import { Badge } from "../components/ui/badge";
import {
  ArrowSquareOut,
  Trash,
  MagnifyingGlass,
  Package,
  CircleNotch,
  X,
  Buildings,
  User,
  CalendarBlank,
  Barcode,
} from "@phosphor-icons/react";

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;
const todayISO = () => new Date().toISOString().slice(0, 10);

export default function ChecklistPage() {
  const { items, lookupLocalBySku, refresh } = useInventoryCtx();
  const { user } = useAuth();
  const operatorName = user?.full_name || user?.username || "";

  const [cliente, setCliente] = useState("");
  const [shippingDate, setShippingDate] = useState(todayISO());
  const [notes, setNotes] = useState("");

  const [list, setList] = useState([]); // {id, name, serialized, unit, quantity, serials[]}
  const [lastScan, setLastScan] = useState(null);
  const [qtyDialog, setQtyDialog] = useState(null); // {item, maxAvailable}
  const [serialSession, setSerialSession] = useState(null); // {id, name, unit, quantity, serials[]}
  const [picker, setPicker] = useState(null); // {filter, pendingSn}
  const [pending, setPending] = useState(null); // {id, name}
  const [submitting, setSubmitting] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [confirmError, setConfirmError] = useState(null);

  const focusScanner = () =>
    setTimeout(() => document.getElementById("scanner-input")?.focus(), 0);

  useEffect(() => {
    if (!qtyDialog && !picker) focusScanner();
  }, [qtyDialog, picker]);

  const totalUnits = list.reduce((a, li) => a + (li.quantity || 0), 0);

  // Somma già in lista per un prodotto A Quantità (impatta max scaricabile)
  const alreadyReservedQty = (pageId) => {
    const row = list.find((li) => li.id === pageId && !li.serialized);
    return row ? row.quantity : 0;
  };

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

  const openQtyForItem = (item) => {
    const avail = Number(item.quantity) || 0;
    const reserved = alreadyReservedQty(item.id);
    const maxAvailable = Math.max(0, avail - reserved);
    if (maxAvailable <= 0) {
      setLastScan({
        type: "error",
        title: "🔴 GIACENZA INSUFFICIENTE",
        subtitle: `${item.name} — stock 0${reserved > 0 ? ` (${reserved} già in lista)` : ""}`,
      });
      return;
    }
    setQtyDialog({ item, initial: 1, maxAvailable });
  };

  const handleScannedCode = async (rawCode) => {
    const code = (rawCode || "").trim();
    if (!code) return;

    // (1) LOCAL SKU pre-check — instant
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
      openQtyForItem(local);
      setLastScan({ type: "ok", title: "PRODOTTO RICONOSCIUTO", subtitle: local.name, code });
      return;
    }
    if (local && local.serialized) {
      setPending(null);
      setQtyDialog({ item: local, initial: 1, forSerials: true });
      setLastScan({ type: "ok", title: "MODELLO A SERIALE", subtitle: `${local.name} — indica la quantità`, code });
      return;
    }

    // (2) Duplicato nella sessione
    if (snAlreadyInList(code)) {
      setLastScan({ type: "error", title: "🔴 SERIALE GIÀ INSERITO NELLA SPEDIZIONE", subtitle: `SN ${code}`, code });
      return;
    }

    // (3) Server verify — Spedizioni richiede: ultima movimentazione = ENTRATA
    try {
      const { data } = await axios.get(`${API}/inventory/lookup`, { params: { code } });
      if (data.status === "out") {
        setLastScan({
          type: "error",
          title: "🔴 SERIALE NON DISPONIBILE IN MAGAZZINO",
          subtitle:
            `SN ${code} è stato spedito` +
            (data.shipped_date ? ` il ${data.shipped_date}` : "") +
            (data.shipped_to ? ` a ${data.shipped_to}` : ""),
          code,
        });
        return;
      }
      if (data.status === "ok" && data.item) {
        // matched_by: "sku" | "barcode" — prodotto riconosciuto
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
          openQtyForItem(data.item);
        }
        return;
      }
      if (data.status === "in_warehouse" && data.item) {
        // Ultima movimentazione = entrata → seriale disponibile
        const product = { id: data.item.id, name: data.item.name };
        addSerialToList(product, code);
        setLastScan({
          type: "ok",
          title: "🟢 SERIALE VALIDO",
          subtitle: `${product.name} — SN ${code}`,
          code,
        });
        setPending({ id: product.id, name: product.name });
        return;
      }
      // status === "not_found" → mai entrato
      setLastScan({
        type: "error",
        title: "🔴 SERIALE NON RISULTA MAI ENTRATO IN MAGAZZINO",
        subtitle: `${code}`,
        code,
      });
    } catch (e) {
      setLastScan({
        type: "error",
        title: "Errore ricerca Notion",
        subtitle: e?.response?.data?.detail || e?.message || "",
      });
    }
  };

  const openConfirm = () => {
    if (!cliente.trim()) {
      toast.error("Cliente obbligatorio");
      return;
    }
    if (!operatorName) {
      toast.error("Operatore non identificato — rieffettua il login");
      return;
    }
    if (!shippingDate) {
      toast.error("Data obbligatoria");
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
      // NB: operator + taken_by NON vengono più inviati manualmente.
      // Il backend li imposta dal JWT (auth_deps.get_current_user).
      const payload = {
        operator: operatorName,
        shipping_date: shippingDate,
        structure: cliente.trim(),
        taken_by: operatorName,
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
      const { data } = await axios.post(`${API}/checklist/send`, payload);
      toast.success("Spedizione confermata", { description: data.message, duration: 6000 });
      setList([]);
      setCliente("");
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
    <div className="pb-32" data-testid="checklist-page">
      <div className="max-w-5xl mx-auto px-4 sm:px-6 pt-6 pb-2 flex items-end justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-blue-600">
            <ArrowSquareOut size={16} weight="bold" />
            <span className="et-eyebrow text-blue-700">Uscite</span>
          </div>
          <h1 className="et-page-heading text-3xl sm:text-4xl mt-1">
            Spedizione
          </h1>
          <p className="text-slate-500 mt-1 text-sm">
            Registra un'uscita verso Spedizioni / Uscite. Verifica live su Notion alla conferma.
          </p>
        </div>
        <div
          className="hidden sm:flex items-center gap-2 et-card px-3 py-2 shrink-0"
          data-testid="total-units-badge"
        >
          <Package size={18} className="text-blue-600" />
          <span className="font-mono-tight text-sm text-slate-900">
            {totalUnits} pz totali
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
              <Label htmlFor="cliente" className="text-slate-700 text-sm font-semibold">
                <Buildings size={14} className="inline mr-1" /> Cliente
              </Label>
              <Input
                id="cliente"
                data-testid="input-structure"
                value={cliente}
                onChange={(e) => setCliente(e.target.value)}
                placeholder="Es. ABC Srl"
                className="h-12 mt-1 text-base"
              />
            </div>
            <div>
              <Label className="text-slate-700 text-sm font-semibold">
                <User size={14} className="inline mr-1" /> Operatore (Preso da)
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
                <CalendarBlank size={14} className="inline mr-1" /> Data
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
          </div>
        </section>

        <ScannerBar
          onScanned={handleScannedCode}
          lastScan={lastScan}
          onClearLastScan={() => setLastScan(null)}
          hint={
            pending
              ? `In attesa dei seriali per: ${pending.name}`
              : "Inserisci o scansiona seriali o codici prodotto — puoi anche selezionare manualmente qui sotto"
          }
        />

        {/* Contesto: modello selezionato + picker manuali */}
        <section className="bg-white border border-slate-200 rounded-md p-4">
          <div className="flex flex-wrap items-center gap-2 justify-between">
            <div className="min-w-0 flex-1">
              {pending ? (
                <div className="flex items-center gap-2 flex-wrap" data-testid="pending-serialized-banner">
                  <Badge className="bg-blue-600 hover:bg-blue-700">
                    🎯 Modello: {pending.name}
                  </Badge>
                  <span className="text-xs text-slate-500">
                    Ora inserisci o scansiona il seriale (verifica LIVE presenza in Entrate) — digitazione manuale, ENTER, CERCA o scanner sono equivalenti.
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
                  Inserisci o scansiona un codice/seriale, oppure seleziona manualmente il prodotto.
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

        {/* Lista */}
        <section
          className="bg-white border border-slate-200 rounded-md overflow-hidden"
          data-testid="spedizioni-list"
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
                <li key={li.id} className="px-4 py-3" data-testid={`sped-row-${li.id}`}>
                  <div className="flex items-center justify-between gap-3 flex-wrap">
                    <div className="min-w-0 flex-1">
                      <div className="font-semibold text-slate-900 flex items-center gap-2 flex-wrap">
                        {li.name}
                        {li.serialized ? (
                          <Badge variant="outline" className="border-amber-300 text-amber-800 bg-amber-50">
                            A Seriale
                          </Badge>
                        ) : (
                          <Badge variant="outline" className="border-slate-300 text-slate-600">
                            A Quantità
                          </Badge>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="font-mono-tight font-semibold text-slate-900">
                        {li.quantity} {li.unit || "pz"}
                      </span>
                      <Button
                        type="button"
                        variant="outline"
                        size="icon"
                        onClick={() => removeRow(li.id)}
                        className="h-8 w-8 border-red-300 text-red-600 hover:bg-red-50"
                        aria-label="Rimuovi"
                        data-testid={`sped-remove-${li.id}`}
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
                            data-testid={`sped-remove-sn-${li.id}-${idx}`}
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

        <section className="bg-white border border-slate-200 rounded-md p-4 sm:p-6">
          <Label htmlFor="notes" className="text-slate-700 text-sm font-semibold">
            Note aggiuntive (opzionale)
          </Label>
          <Textarea
            id="notes"
            data-testid="input-notes"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Eventuali note per questa spedizione…"
            className="mt-2 min-h-[90px]"
          />
        </section>
      </main>

      <footer className="fixed bottom-0 inset-x-0 bg-white border-t border-slate-200 z-40">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 py-3 flex items-center justify-between gap-3">
          <div className="text-sm text-slate-600">
            <span className="font-mono-tight font-semibold text-slate-900">{totalUnits}</span>{" "}
            pz in uscita · {list.length} prodotti
          </div>
          <Button
            type="button"
            onClick={openConfirm}
            disabled={submitting || list.length === 0}
            className="h-12 px-6 bg-blue-600 hover:bg-blue-700 text-white font-semibold text-base"
            data-testid="submit-checklist-btn"
          >
            {submitting ? (
              <>
                <CircleNotch size={20} className="mr-2 animate-spin" /> Conferma in corso…
              </>
            ) : (
              <>
                <ArrowSquareOut size={20} weight="bold" className="mr-2" /> CONFERMA SPEDIZIONE
              </>
            )}
          </Button>
        </div>
      </footer>

      {qtyDialog && (
        <QtyDialog
          item={qtyDialog.item}
          initial={qtyDialog.initial}
          maxAvailable={qtyDialog.forSerials ? undefined : qtyDialog.maxAvailable}
          label={qtyDialog.forSerials ? "Quantità pezzi" : "Quantità da spedire"}
          confirmLabel={qtyDialog.forSerials ? "Continua" : "Aggiungi"}
          variant="spedizioni"
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
            mode="spedizioni"
            existingSerials={list.flatMap((li) => li.serials || [])}
            onChange={setSerialSession}
            onCancel={() => setSerialSession(null)}
            onCommit={(sess) => {
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
              setPicker(null);
              setPending(null);
              setQtyDialog({ item: product, initial: 1, forSerials: true });
              return;
            }
            setPicker(null);
            openQtyForItem(product);
          }}
        />
      )}

      <ConfirmSubmitDialog
        open={showConfirm}
        kind="spedizione"
        items={list.map((li) => ({
          name: li.name,
          serialized: !!li.serialized,
          quantity: li.quantity,
          unit: li.unit || "pz",
          serials: li.serialized ? li.serials : [],
          code: li.code,
        }))}
        meta={[
          { label: "Cliente", value: cliente.trim() },
          { label: "Preso da (Operatore loggato)", value: operatorName },
          { label: "Data", value: shippingDate },
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
    </div>
  );
}
