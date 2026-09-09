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
import { fetchServerToday } from "../lib/tz";
import BarcodeScanner from "../components/BarcodeScanner";
import { parseDazeQr } from "../lib/qr";
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
  QrCode,
  SkipForward,
  Check,
  Camera,
} from "@phosphor-icons/react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "../components/ui/dialog";

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;
const todayISO = () => new Date().toISOString().slice(0, 10);

export default function ChecklistPage() {
  const { items, lookupLocalBySku, refresh } = useInventoryCtx();
  const { user } = useAuth();
  const operatorName = user?.full_name || user?.username || "";

  const [cliente, setCliente] = useState("");
  // F14 (autocomplete) — id Notion dell'ordine "Eliostech Ordini" selezionato dal picker.
  //   Se null: nessun ordine selezionato (blocco sync su richiesta backend).
  const [clienteOrderId, setClienteOrderId] = useState(null);
  const [clienteSuggestions, setClienteSuggestions] = useState([]);
  const [clienteOpen, setClienteOpen] = useState(false);
  const [clienteLoading, setClienteLoading] = useState(false);
  const [shippingDate, setShippingDate] = useState(todayISO());
  const [notes, setNotes] = useState("");

  // F8 — Sostituisce la data locale con quella del server nel tz configurato.
  useEffect(() => {
    fetchServerToday().then((d) => d && setShippingDate(d));
  }, []);

  const [list, setList] = useState([]); // {id, name, serialized, unit, quantity, serials[]}
  const [lastScan, setLastScan] = useState(null);
  const [qtyDialog, setQtyDialog] = useState(null); // {item, maxAvailable}
  const [serialSession, setSerialSession] = useState(null); // {id, name, unit, quantity, serials[]}
  const [picker, setPicker] = useState(null); // {filter, pendingSn}
  const [pending, setPending] = useState(null); // {id, name}
  const [submitting, setSubmitting] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [confirmError, setConfirmError] = useState(null);
  // F8 UI iniziale — 2 card grandi in stile Dashboard finché l'operatore non sceglie un flusso.
  const [initialAction, setInitialAction] = useState(null);

  // F14 — QR Code opzionale: coda dei seriali appena aggiunti da chiedere "Associa QR?"
  //       + mappa seriale → QR persistente in memoria (allineata a submit payload).
  const [qrQueue, setQrQueue] = useState([]); // [{productId, productName, serial}]
  const [qrMap, setQrMap] = useState({}); // { serialLower: {serial, qr} }
  const [qrPromptOpen, setQrPromptOpen] = useState(false);
  const [qrScanOpen, setQrScanOpen] = useState(false); // dentro il popup: input attivo
  const [qrValue, setQrValue] = useState("");
  const [qrBusy, setQrBusy] = useState(false);
  const enqueueForQR = (product, serials) => {
    if (!product || !serials || serials.length === 0) return;
    setQrQueue((prev) => [
      ...prev,
      ...serials.map((s) => ({ productId: product.id, productName: product.name, serial: s })),
    ]);
    setQrPromptOpen(true);
  };

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
    // Feedback immediato: la chiamata a Notion può richiedere ~1s → mostra spinner
    // così l'operatore percepisce reattività istantanea.
    setLastScan({ type: "warn", title: "🔎 Verifica in corso…", subtitle: `Codice ${code}`, code });
    try {
      const { data } = await axios.get(`${API}/inventory/lookup`, { params: { code } });
      if (data.status === "out") {
        setLastScan({
          type: "error",
          title: "🔴 SERIALE NON DISPONIBILE IN MAGAZZINO",
          subtitle: `SN ${code}`,
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
        // F14 — Popup QR opzionale post scansione
        enqueueForQR(product, [code]);
        return;
      }
      // status === "not_found" → seriale non presente nell'Inventario Notion
      setLastScan({
        type: "error",
        title: "🔴 SERIALE NON DISPONIBILE IN MAGAZZINO",
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
        order_page_id: clienteOrderId || null,
        taken_by: operatorName,
        notes: notes.trim() || null,
        items: list.map((li) => ({
          page_id: li.id,
          name: li.name,
          unit: li.unit || "pz",
          serialized: !!li.serialized,
          quantity: li.quantity,
          serials: li.serialized ? li.serials : [],
          // F14 — QR allineati ai seriali (stringa vuota per i seriali senza QR)
          qr_codes: li.serialized ? (li.serials || []).map((sn) => qrMap[(sn || "").toLowerCase()]?.qr || "") : [],
        })),
      };
      const { data } = await axios.post(`${API}/checklist/send`, payload);
      toast.success("Spedizione confermata", { description: data.message, duration: 6000 });
      setList([]);
      setCliente("");
      setClienteOrderId(null);
      setClienteSuggestions([]);
      setNotes("");
      setPending(null);
      setLastScan(null);
      setShowConfirm(false);
      setInitialAction(null);
      // F14 — reset QR state
      setQrQueue([]);
      setQrMap({});
      setQrPromptOpen(false);
      setQrScanOpen(false);
      setQrValue("");
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
                <Buildings size={14} className="inline mr-1" /> Struttura / Cliente
              </Label>
              <div className="relative mt-1">
                <Input
                  id="cliente"
                  data-testid="input-structure"
                  value={cliente}
                  onChange={(e) => {
                    const v = e.target.value;
                    setCliente(v);
                    setClienteOrderId(null); // ogni digitazione invalida la selezione precedente
                    setClienteOpen(true);
                    if (window.__cliSug) clearTimeout(window.__cliSug);
                    window.__cliSug = setTimeout(async () => {
                      const q = v.trim();
                      if (q.length < 2) { setClienteSuggestions([]); return; }
                      setClienteLoading(true);
                      try {
                        const { data } = await axios.get(`${API}/orders/search`, { params: { q, limit: 20 } });
                        setClienteSuggestions(data.items || []);
                      } catch {
                        setClienteSuggestions([]);
                      } finally {
                        setClienteLoading(false);
                      }
                    }, 220);
                  }}
                  onFocus={() => cliente.trim().length >= 2 && setClienteOpen(true)}
                  onBlur={() => setTimeout(() => setClienteOpen(false), 180)}
                  autoComplete="off"
                  placeholder=""
                  className="h-12 text-base pr-9"
                />
                {clienteOrderId && (
                  <span className="absolute right-2 top-1/2 -translate-y-1/2 text-emerald-600" title="Ordine Notion selezionato">
                    <Check size={16} weight="bold" />
                  </span>
                )}
                {clienteOpen && cliente.trim().length >= 2 && (
                  <div
                    className="absolute z-50 left-0 right-0 mt-1 bg-white border border-slate-200 rounded-md shadow-xl max-h-64 overflow-auto"
                    data-testid="cliente-suggestions"
                  >
                    {clienteLoading && (
                      <div className="px-3 py-2 text-xs text-slate-400">Cerco…</div>
                    )}
                    {!clienteLoading && clienteSuggestions.length === 0 && (
                      <div className="px-3 py-3 text-sm text-red-600" data-testid="cliente-no-results">
                        Nessuna struttura trovata
                      </div>
                    )}
                    {clienteSuggestions.map((s) => (
                      <button
                        key={s.id}
                        type="button"
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => {
                          setCliente(s.structure);
                          setClienteOrderId(s.id);
                          setClienteOpen(false);
                          setClienteSuggestions([]);
                        }}
                        className="w-full text-left px-3 py-2 hover:bg-amber-50 border-b border-slate-100 last:border-0 min-h-[44px]"
                        data-testid={`cliente-sug-${s.id}`}
                      >
                        <div className="font-semibold text-sm text-slate-900">{s.structure}</div>
                        {s.title && s.title !== s.structure && (
                          <div className="text-xs text-slate-500 truncate">{s.title}</div>
                        )}
                      </button>
                    ))}
                  </div>
                )}
              </div>
              {!clienteOrderId && cliente.trim().length >= 2 && (
                <p className="text-[11px] text-amber-700 mt-1">
                  ⚠️ Seleziona una struttura dall'elenco (necessario per la sync con l'ordine).
                </p>
              )}
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

        {/* ScannerBar sempre in alto */}
        <ScannerBar
          onScanned={handleScannedCode}
          lastScan={lastScan}
          onClearLastScan={() => setLastScan(null)}
          hint={
            pending
              ? `In attesa dei seriali per: ${pending.name}`
              : "Inserisci o scansiona seriali o codici prodotto"
          }
        />

        {/* F8 — Card operative sempre visibili sotto lo ScannerBar. Stile Dashboard, dimensioni leggermente ridotte. */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 sm:gap-4" data-testid="spedizioni-initial-cards">
          <button
            type="button"
            onClick={() => { setInitialAction("serial"); setPicker({ filter: "serialized" }); }}
            data-testid="spedizioni-card-seriale"
            className="group relative overflow-hidden rounded-xl p-5 sm:p-6 text-left text-white border border-white/10 bg-gradient-to-br from-slate-900 via-slate-950 to-slate-900 hover:border-emerald-400/50 transition-all shadow-[0_10px_40px_-15px_rgba(2,6,23,0.5)] hover:shadow-[0_20px_60px_-15px_rgba(16,185,129,0.35)]"
          >
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_80%_20%,rgba(16,185,129,0.18),transparent_55%)]" aria-hidden />
            <div className="relative">
              <div className="inline-flex items-center justify-center w-10 h-10 rounded-lg bg-emerald-500/15 border border-emerald-400/30 text-emerald-300">
                <ArrowSquareOut size={22} weight="bold" />
              </div>
              <div className="text-lg sm:text-xl font-display font-black mt-3 tracking-tight">SPEDISCI SERIALI</div>
              <div className="text-slate-300/80 text-xs mt-1">Modello e seriali da spedire</div>
            </div>
          </button>
          <button
            type="button"
            onClick={() => { setInitialAction("quantity"); setPicker({ filter: "quantity" }); }}
            data-testid="spedizioni-card-quantita"
            className="group relative overflow-hidden rounded-xl p-5 sm:p-6 text-left text-white border border-white/10 bg-gradient-to-br from-slate-900 via-slate-950 to-slate-900 hover:border-sky-400/50 transition-all shadow-[0_10px_40px_-15px_rgba(2,6,23,0.5)] hover:shadow-[0_20px_60px_-15px_rgba(56,189,248,0.30)]"
          >
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_80%_20%,rgba(56,189,248,0.18),transparent_55%)]" aria-hidden />
            <div className="relative">
              <div className="inline-flex items-center justify-center w-10 h-10 rounded-lg bg-sky-500/15 border border-sky-400/30 text-sky-300">
                <Package size={22} weight="bold" />
              </div>
              <div className="text-lg sm:text-xl font-display font-black mt-3 tracking-tight">SPEDISCI QUANTITÀ</div>
              <div className="text-slate-300/80 text-xs mt-1">Uscita di pezzi senza seriali</div>
            </div>
          </button>
        </div>

        {/* Contesto: modello selezionato — SOLO banner, picker piccoli rimossi
            (F8: le card grandi sostituiscono i pulsanti piccoli duplicati). */}
        {pending && (
          <section className="bg-white border border-slate-200 rounded-md p-4">
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
          </section>
        )}

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
                <li key={li.id} className="px-3 sm:px-4 py-3" data-testid={`sped-row-${li.id}`}>
                  <div className="flex items-start justify-between gap-3 flex-wrap">
                    <div className="min-w-0 flex-1">
                      <div className="font-semibold text-slate-900 flex items-start gap-2 flex-wrap">
                        <span className="break-words min-w-0 flex-1">{li.name}</span>
                        {li.serialized ? (
                          <Badge variant="outline" className="border-amber-300 text-amber-800 bg-amber-50 shrink-0">
                            A Seriale
                          </Badge>
                        ) : (
                          <Badge variant="outline" className="border-slate-300 text-slate-600 shrink-0">
                            A Quantità
                          </Badge>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
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
              // F14 (20/02) — il popup QR appare per-seriale via onSerialConfirmed nel SerialCollector.
              //               Qui NON eseguiamo più enqueue in bulk per evitare doppi popup.
              setSerialSession(null);
            }}
          onSerialConfirmed={(sn) => {
            // F14 (20/02) — appena un seriale è validato (manuale/ENTER/scanner/fotocamera)
            // apri subito il popup QR per QUEL seriale. Ogni SN è indipendente (SALTA/ASSOCIA per singolo).
            const currentSess = serialSession;
            const productName = currentSess?.name || "Wallbox";
            const productId = currentSess?.id || "";
            enqueueForQR({ id: productId, name: productName }, [sn]);
          }}
          />
        </div>
      )}

      {picker && (
        <ProductPicker
          items={items}
          filter={picker.filter}
          onClose={() => { setPicker(null); setInitialAction(null); }}
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

      {/* F14 (BLOCCO 1) — Popup QR: input MANUALE + FOTOCAMERA sempre visibili.
          Compatibile con scanner palmare/USB/Bluetooth (input HID → invia direttamente al campo),
          fotocamera smartphone/tablet/PC (📷) e digitazione manuale. Stessa validazione. */}
      {qrPromptOpen && qrQueue.length > 0 && (
        <Dialog
          open={true}
          onOpenChange={(v) => { if (!v && !qrBusy) { setQrPromptOpen(false); setQrScanOpen(false); setQrValue(""); } }}
        >
          <DialogContent className="max-w-md" data-testid="qr-prompt-dialog">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <QrCode size={22} weight="bold" className="text-amber-600" />
                Associa QR Code
              </DialogTitle>
              <DialogDescription>
                <b>{qrQueue[0].productName}</b> — SN <span className="font-mono-tight">{qrQueue[0].serial}</span>
                <br />QR opzionale: puoi <b>SALTARE</b> o associarlo digitando/scansionando.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-3">
              <Label className="text-sm font-semibold">QR Code</Label>
              <div className="flex items-center gap-2">
                <Input
                  autoFocus
                  value={qrValue}
                  onChange={(e) => setQrValue(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); confirmQR(); } }}
                  placeholder="Digita, scansiona o usa la fotocamera"
                  className="h-12 text-base font-mono-tight flex-1"
                  data-testid="qr-input"
                  disabled={qrBusy}
                  autoComplete="off"
                />
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setQrScanOpen(true)}
                  className="h-12 w-12 shrink-0 border-amber-300 text-amber-700 hover:bg-amber-50"
                  disabled={qrBusy}
                  data-testid="qr-camera-btn"
                  title="Apri fotocamera"
                  aria-label="Apri fotocamera per scansionare il QR"
                >
                  <Camera size={20} weight="bold" />
                </Button>
              </div>
              <p className="text-[11px] text-slate-500">
                Compatibile con scanner palmare/USB/Bluetooth, fotocamera 📷 (smartphone/tablet/PC) e digitazione manuale.
              </p>
            </div>
            <DialogFooter className="flex-col sm:flex-row gap-2 pt-2">
              <Button
                variant="outline"
                onClick={() => {
                  setQrQueue((q) => q.slice(1));
                  setQrValue("");
                  setQrScanOpen(false);
                  if (qrQueue.length <= 1) setQrPromptOpen(false);
                }}
                className="h-11 w-full sm:w-auto"
                disabled={qrBusy}
                data-testid="qr-skip-btn"
              >
                <SkipForward size={18} weight="bold" className="mr-2" /> SALTA
              </Button>
              <Button
                onClick={confirmQR}
                disabled={qrBusy || !qrValue.trim()}
                className="h-11 w-full sm:w-auto bg-amber-600 hover:bg-amber-700 text-white"
                data-testid="qr-confirm-btn"
              >
                {qrBusy ? <CircleNotch size={16} className="animate-spin mr-1" /> : <Check size={16} weight="bold" className="mr-1" />}
                Conferma QR
              </Button>
            </DialogFooter>
          </DialogContent>
          <BarcodeScanner
            open={qrScanOpen}
            onClose={() => setQrScanOpen(false)}
            label={`Scansiona QR Code — SN ${qrQueue[0]?.serial || ""}`}
            onDetected={(val) => {
              setQrScanOpen(false);
              // F15 §10-15 — parser QR Daze: estrae serial da JSON {serial,puk}
              const { serial } = parseDazeQr(val);
              if (serial) setQrValue(serial);
            }}
          />
        </Dialog>
      )}
    </div>
  );

  async function confirmQR() {
    const q = qrValue.trim();
    if (!q) return;
    setQrBusy(true);
    try {
      // Check globale su MongoDB
      const { data } = await axios.get(`${API}/qr/check`, { params: { qr: q } });
      const currentSn = qrQueue[0]?.serial || "";
      if (data.exists && (data.serial || "").toLowerCase() !== currentSn.toLowerCase()) {
        toast.error("🔴 QR CODE GIÀ ASSOCIATO", {
          description: `Questo QR Code è già associato a un'altra Wallbox (SN ${data.serial}).`,
        });
        setQrBusy(false);
        return;
      }
      // Anche verifica duplicati locali nella spedizione corrente
      const isDupLocal = Object.values(qrMap).some((m) => m.qr.toLowerCase() === q.toLowerCase());
      if (isDupLocal) {
        toast.error("QR già usato in questa spedizione");
        setQrBusy(false);
        return;
      }
      setQrMap((prev) => ({ ...prev, [currentSn.toLowerCase()]: { serial: currentSn, qr: q } }));
      toast.success(`✅ QR associato a ${currentSn}`, { description: q });
      setQrQueue((prev) => prev.slice(1));
      setQrValue("");
      setQrScanOpen(false);
      if (qrQueue.length <= 1) setQrPromptOpen(false);
    } catch (e) {
      toast.error("Verifica QR fallita", { description: e?.response?.data?.detail || e?.message || "" });
    } finally {
      setQrBusy(false);
    }
  }
}
