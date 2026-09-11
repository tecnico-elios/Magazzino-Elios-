import { useEffect, useMemo, useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { useAuth } from "../lib/AuthContext";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { Textarea } from "../components/ui/textarea";
import { Badge } from "../components/ui/badge";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "../components/ui/dialog";
import { ArrowUUpLeft, MagnifyingGlass, Warning, PencilSimple, Prohibit, Camera, Trash } from "@phosphor-icons/react";
import { parseDazeQr } from "../lib/qr";
import BarcodeScanner from "../components/BarcodeScanner";

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;
const todayISO = () => new Date().toISOString().slice(0, 10);

function formatError(err) {
  const d = err?.response?.data?.detail;
  if (typeof d === "string") return d;
  if (Array.isArray(d)) {
    // Pydantic 422 → array di oggetti {type, loc, msg, input, url}
    return d.map((it) => (typeof it === "string" ? it : (it?.msg || JSON.stringify(it)))).join(" · ");
  }
  if (d && typeof d === "object") return d.msg || JSON.stringify(d);
  return err?.message || "Errore";
}

export default function RetroattivitaPage() {
  const { user } = useAuth();
  const [tipo, setTipo] = useState("spedizione");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [serial, setSerial] = useState("");
  const [structure, setStructure] = useState("");
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [editing, setEditing] = useState(null); // {row, kind}
  const [cancelling, setCancelling] = useState(null); // {row, kind}
  const [authorized, setAuthorized] = useState(null);

  useEffect(() => {
    axios.get(`${API}/retro/authorized`).then(({ data }) => setAuthorized(data?.authorized ?? false))
      .catch(() => setAuthorized(false));
  }, []);

  // F14 fix (20/02): cambio tipo → svuota risultati per evitare dati stale del tipo precedente.
  useEffect(() => {
    setRows([]);
  }, [tipo]);

  const search = async () => {
    setLoading(true);
    setRows([]);  // ricarica netta ad ogni ricerca
    try {
      const q = structure.trim();
      const { data } = await axios.post(`${API}/retro/find`, {
        tipo,
        date_from: dateFrom || null,
        date_to: dateTo || null,
        serial: serial.trim() || null,
        structure: tipo === "spedizione" && q ? q : null,
        fornitore: tipo === "arrivo" && q ? q : null,
      });
      setRows(data.items || []);
    } catch (e) {
      toast.error("Ricerca fallita", { description: formatError(e) });
    } finally {
      setLoading(false);
    }
  };

  if (authorized === false) {
    return (
      <div className="max-w-2xl mx-auto px-4 py-12 text-center" data-testid="retro-forbidden">
        <Prohibit size={40} className="text-red-500 mx-auto" weight="bold" />
        <h1 className="text-2xl font-bold mt-3 text-slate-900">Operazione non autorizzata</h1>
        <p className="text-slate-500 mt-1">
          La funzione "Operazione Retroattiva" richiede il permesso <b>Modifica Retroattiva</b> assegnato dall'Admin.
        </p>
      </div>
    );
  }

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 py-6" data-testid="retro-page">
      <div className="flex items-center gap-2 text-amber-600">
        <ArrowUUpLeft size={16} weight="bold" />
        <span className="et-eyebrow text-amber-700">Rettifica Controllata</span>
      </div>
      <h1 className="et-page-heading text-3xl sm:text-4xl mt-1">Operazione Retroattiva</h1>
      <p className="text-slate-500 mt-1 text-sm">
        Modifica il record ESISTENTE su Notion — nessuna nuova riga. Motivazione + audit obbligatori.
      </p>

      <section className="bg-white border border-slate-200 rounded-md p-4 sm:p-6 mt-6">
        <div className="text-xs tracking-[0.1em] uppercase text-slate-500 font-semibold mb-4">Trova operazione</div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          <div>
            <Label className="text-slate-700 text-sm font-semibold">Tipo</Label>
            <div className="mt-1 flex gap-2">
              {["spedizione", "arrivo"].map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setTipo(t)}
                  data-testid={`retro-tipo-${t}`}
                  className={`h-10 px-4 rounded-md border text-sm font-semibold transition-colors ${
                    tipo === t ? "bg-amber-50 border-amber-300 text-amber-800" : "bg-white border-slate-200 text-slate-500"
                  }`}
                >
                  {t === "spedizione" ? "Spedizione" : "Arrivo"}
                </button>
              ))}
            </div>
          </div>
          <div>
            <Label className="text-slate-700 text-sm font-semibold">Data da</Label>
            <Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="h-11 mt-1" data-testid="retro-date-from" />
          </div>
          <div>
            <Label className="text-slate-700 text-sm font-semibold">Data a</Label>
            <Input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="h-11 mt-1" data-testid="retro-date-to" />
          </div>
          <div>
            <Label className="text-slate-700 text-sm font-semibold">Seriale (opz)</Label>
            <Input value={serial} onChange={(e) => setSerial(e.target.value)} placeholder="" className="h-11 mt-1 font-mono-tight" data-testid="retro-serial" />
          </div>
          <div>
            <Label className="text-slate-700 text-sm font-semibold">
              {tipo === "spedizione" ? "Struttura / Cliente (opz)" : "Fornitore (opz)"}
            </Label>
            <Input
              value={structure}
              onChange={(e) => setStructure(e.target.value)}
              placeholder=""
              className="h-11 mt-1"
              data-testid={tipo === "spedizione" ? "retro-structure" : "retro-fornitore"}
            />
          </div>
          <div className="flex items-end">
            <Button onClick={search} disabled={loading} className="h-11 bg-amber-600 hover:bg-amber-700 text-white font-semibold w-full" data-testid="retro-search-btn">
              <MagnifyingGlass size={18} weight="bold" className="mr-2" /> {loading ? "Cerco…" : "Cerca"}
            </Button>
          </div>
        </div>
      </section>

      <section className="bg-white border border-slate-200 rounded-md p-4 sm:p-6 mt-4">
        <div className="text-xs tracking-[0.1em] uppercase text-slate-500 font-semibold mb-3">
          Risultati ({rows.length})
        </div>
        {rows.length === 0 ? (
          <div className="text-slate-400 text-sm py-6 text-center">Nessuna operazione trovata. Prova a modificare i filtri.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left border-b border-slate-200">
                  <th className="py-2 pr-3">Data</th>
                  <th className="py-2 pr-3">Prodotto</th>
                  <th className="py-2 pr-3">Seriale/SN</th>
                  <th className="py-2 pr-3">Qty</th>
                  <th className="py-2 pr-3">{tipo === "spedizione" ? "Struttura / Cliente" : "Fornitore"}</th>
                  <th className="py-2 pr-3 text-right">Azioni</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className="border-b border-slate-100 last:border-0" data-testid={`retro-row-${r.id}`}>
                    <td className="py-2 pr-3 font-mono-tight">{r.date || "—"}</td>
                    <td className="py-2 pr-3">{r.item_name || (r.item_names || []).join(", ") || "—"}</td>
                    <td className="py-2 pr-3 font-mono-tight">{r.sn || "—"}</td>
                    <td className="py-2 pr-3">{r.quantity ?? "—"}</td>
                    <td className="py-2 pr-3">{tipo === "spedizione" ? (r.cliente || "—") : (r.fornitore || "—")}</td>
                    <td className="py-2 pr-3 text-right">
                      <div className="inline-flex gap-1">
                        <Button size="sm" variant="outline" onClick={() => setEditing({ row: r, kind: tipo })} data-testid={`retro-edit-${r.id}`}>
                          <PencilSimple size={14} weight="bold" className="mr-1" /> Modifica
                        </Button>
                        <Button size="sm" variant="outline" onClick={() => setCancelling({ row: r, kind: tipo })} className="border-red-300 text-red-700 hover:bg-red-50" data-testid={`retro-cancel-${r.id}`}>
                          <Trash size={14} weight="bold" className="mr-1" /> Annulla {tipo === "spedizione" ? "spedizione" : "arrivo"}
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {editing && (
        <EditDialog
          row={editing.row}
          kind={editing.kind}
          onClose={() => setEditing(null)}
          onDone={() => { setEditing(null); search(); }}
        />
      )}
      {cancelling && (
        <CancelDialog
          row={cancelling.row}
          kind={cancelling.kind}
          onClose={() => setCancelling(null)}
          onDone={() => { setCancelling(null); search(); }}
        />
      )}
    </div>
  );
}

function EditDialog({ row, kind, onClose, onDone }) {
  const [reason, setReason] = useState("");
  // F16 (26/02) — Multi-SN handling: parsa la stringa row.sn (può contenere N seriali
  // separati da \n , . ; o spazi). Se >1, mostra selezione "Cosa vuoi modificare?".
  const parsedSns = useMemo(() => {
    const raw = row?.sn || "";
    return raw.split(/[,.;\s\n]+/).map((s) => s.trim()).filter(Boolean);
  }, [row?.sn]);
  const isMultiSn = parsedSns.length > 1;
  const [targetSn, setTargetSn] = useState(parsedSns.length === 1 ? parsedSns[0] : "");
  // F14 fix (20/02): precarica i valori esistenti del record. L'utente modifica SOLO ciò che serve.
  const [newSn, setNewSn] = useState(parsedSns.length === 1 ? parsedSns[0] : "");
  const [newQty, setNewQty] = useState(row?.quantity != null ? String(row.quantity) : "");
  const [newStructure, setNewStructure] = useState(row?.cliente || "");
  const [newQr, setNewQr] = useState("");
  const [qrScannerOpen, setQrScannerOpen] = useState(false);
  const [qrChecking, setQrChecking] = useState(false);
  const [busy, setBusy] = useState(false);
  // F16 (26/02) — Cambio prodotto A Seriale (mantiene stesso record, cambia Item in uscita)
  const [changeProduct, setChangeProduct] = useState(false);
  const [productPickerOpen, setProductPickerOpen] = useState(false);
  const [newProduct, setNewProduct] = useState(null); // {page_id, name, tipo_gestione}
  // F19 (26/02/2026) — Popup di conferma prima dell'invio
  const [confirmOpen, setConfirmOpen] = useState(false);
  // F15 (§3) — rileva Tipo Gestione del prodotto dalla configurazione Inventario.
  // Usa item_ids[0] dalla riga Notion Uscite/Entrate. Riuso: nessuna nuova API.
  const [productTipo, setProductTipo] = useState(null); // null | "a_seriale" | "a_quantita"
  const [productMeta, setProductMeta] = useState({ name: null, code: null, page_id: null });
  useEffect(() => {
    const pid = (row?.item_ids && row.item_ids[0]) || null;
    const rowName = (row?.item_name || (row?.item_names || [])[0] || "").trim().toLowerCase();
    if (!pid && !rowName) return;
    axios.get(`${API}/inventory`).then(({ data }) => {
      const items = data?.items || [];
      // 1° tentativo: match esatto per page_id (SSOT). 2° tentativo: match per nome (SOLO per
      // recuperare l'entry Inventario — il tipo_gestione viene sempre LETTO da Notion, mai dedotto).
      const p = (pid && items.find((x) => (x.page_id || x.id) === pid))
        || (rowName && items.find((x) => (x.name || "").trim().toLowerCase() === rowName))
        || null;
      if (p) {
        setProductTipo(p.tipo_gestione || null);
        setProductMeta({ name: p.name, code: p.code, page_id: p.page_id || p.id });
      }
    }).catch(() => {});
  }, [row?.item_ids, row?.item_name, row?.item_names]);

  // F14 fix (20/02): recupera QR esistente per il seriale (se presente)
  useEffect(() => {
    if (kind !== "spedizione" || !row?.sn) return;
    const snForQr = targetSn || parsedSns[0] || row.sn;
    axios.get(`${API}/qr/by-serial`, { params: { sn: snForQr } })
      .then(({ data }) => {
        if (data?.exists && data?.qr_code) {
          setNewQr(data.qr_code);
        }
      })
      .catch(() => {});
  }, [kind, row?.sn, targetSn, parsedSns]);

  // Verifica QR live tramite /api/qr/check quando l'utente inserisce/scansiona
  const verifyQr = async (val) => {
    const q = (val || "").trim();
    if (!q) return true;
    setQrChecking(true);
    try {
      const { data } = await axios.get(`${API}/qr/check`, { params: { qr: q } });
      const currentSn = (newSn.trim() || row.sn || "").toLowerCase();
      if (data.exists && (data.serial || "").toLowerCase() !== currentSn) {
        toast.error("🔴 QR CODE GIÀ ASSOCIATO", { description: `Questo QR è già associato a un'altra Wallbox (SN ${data.serial}).` });
        setNewQr("");
        return false;
      }
      toast.success(`✅ QR disponibile`, { description: q });
      return true;
    } catch (e) {
      toast.error("Verifica QR fallita", { description: e?.response?.data?.detail || e?.message });
      return false;
    } finally {
      setQrChecking(false);
    }
  };

  const submit = async () => {
    // F19 (26/02/2026) — Motivazione facoltativa. Il popup di conferma è mostrato dal caller.
    if (isMultiSn && !targetSn && (newSn.trim() || newQr.trim() || changeProduct)) {
      toast.error("Seleziona quale seriale modificare (la riga contiene più seriali)");
      return;
    }
    setBusy(true);
    try {
      const body = { reason: reason.trim() || "(nessuna motivazione)" };
      // F14 fix (20/02): invia SOLO i campi effettivamente modificati.
      // Il backend aggiornerà unicamente quei campi (§7 modifica parziale).
      const sn0 = isMultiSn ? targetSn : (row?.sn || "");
      const qty0 = row?.quantity != null ? String(row.quantity) : "";
      const struct0 = row?.cliente || "";
      if (newSn.trim() && newSn.trim() !== sn0) body.new_sn = newSn.trim();
      // F16: target_sn permette al backend di sostituire SOLO il SN scelto in multi-SN
      if (isMultiSn && targetSn) body.target_sn = targetSn;
      if (newQty !== "" && !isNaN(parseFloat(newQty)) && String(newQty) !== qty0) {
        body.new_quantity = parseFloat(newQty);
      }
      if (kind === "spedizione") {
        if (newStructure.trim() && newStructure.trim() !== struct0) body.new_structure = newStructure.trim();
        if (newQr.trim()) body.new_qr_code = newQr.trim();
        // F16: cambio prodotto (relazione Item in uscita)
        if (changeProduct && newProduct?.page_id) body.new_product_page_id = newProduct.page_id;
      }
      const path = kind === "spedizione" ? `retro/shipment/${row.id}` : `retro/arrivo/${row.id}`;
      const { data } = await axios.patch(`${API}/${path}`, body);
      toast.success("Modifica retroattiva salvata", {
        description: data?.email_sent ? "Email di notifica inviata." : undefined,
      });
      onDone();
    } catch (e) {
      toast.error("Modifica fallita", { description: formatError(e) });
    } finally {
      setBusy(false);
    }
  };

  const cancelOp = async () => {
    // F15 — spostato in CancelDialog dedicato dalla tabella. Manteniuto per retro-compat interna.
    if (!reason.trim()) { toast.error("Motivazione obbligatoria per l'annullamento"); return; }
    if (!window.confirm("Confermi l'ANNULLAMENTO di questa operazione? La pagina Notion verrà archiviata.")) return;
    setBusy(true);
    try {
      await axios.post(`${API}/retro/cancel/${kind}/${row.id}`, { reason: reason.trim() });
      toast.success("Operazione annullata");
      onDone();
    } catch (e) {
      toast.error("Annullamento fallito", { description: formatError(e) });
    } finally {
      setBusy(false);
    }
  };
  // eslint-disable-next-line no-unused-vars
  const _unused_cancelOp = cancelOp;

  return (
    <Dialog open={true} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-2xl" data-testid="retro-edit-dialog">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-amber-700">
            <Warning size={20} weight="bold" /> Operazione Retroattiva — {kind === "spedizione" ? "Spedizione" : "Arrivo"}
          </DialogTitle>
          <DialogDescription>
            Modifica il record esistente. Verranno cambiati SOLO i campi compilati.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          {/* F15 (§3) — Info readonly adattive al Tipo Gestione */}
          <div className="rounded-md border border-slate-200 bg-slate-50 p-3 text-xs space-y-1">
            <div><b>Data operazione:</b> {row.date || "—"}</div>
            <div><b>Prodotto:</b> {productMeta.name || (row.item_name || (row.item_names || []).join(", ")) || "—"}
              {productTipo && (
                <span className={`ml-2 text-[9px] px-1.5 h-4 inline-flex items-center rounded-full font-semibold ${productTipo === "a_seriale" ? "bg-emerald-100 text-emerald-800" : "bg-sky-100 text-sky-800"}`}>
                  {productTipo === "a_seriale" ? "A Seriale" : "A Quantità"}
                </span>
              )}
            </div>
            {productTipo === "a_seriale" && !isMultiSn && (
              <div><b>Seriale attuale:</b> <span className="font-mono-tight">{row.sn || "—"}</span></div>
            )}
            {productTipo === "a_quantita" && (
              <div><b>Quantità attuale:</b> <span className="font-mono-tight">{row.quantity ?? "—"}</span></div>
            )}
            {productTipo === null && (
              <div className="text-slate-500 italic">Rilevamento Tipo Gestione in corso…</div>
            )}
            {kind === "spedizione" && <div><b>Struttura attuale:</b> {row.cliente || "—"}</div>}
          </div>

          {/* F16 (26/02) — SELETTORE MULTI-SN: se la riga contiene più seriali,
                l'operatore sceglie ESATTAMENTE quale sostituire. */}
          {productTipo === "a_seriale" && isMultiSn && (
            <div className="rounded-md border-2 border-amber-400 bg-amber-50 p-3">
              <div className="text-xs font-bold text-amber-900 mb-2">
                COSA VUOI MODIFICARE? — Questa spedizione contiene {parsedSns.length} seriali. Seleziona quale correggere:
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-1 max-h-40 overflow-y-auto">
                {parsedSns.map((sn) => (
                  <label
                    key={sn}
                    className={`flex items-center gap-2 px-2 py-1.5 rounded border cursor-pointer text-sm ${
                      targetSn === sn ? "border-amber-500 bg-amber-100 font-semibold" : "border-slate-200 bg-white hover:bg-amber-50"
                    }`}
                    data-testid={`retro-target-sn-${sn}`}
                  >
                    <input
                      type="radio"
                      name="retro-target-sn"
                      value={sn}
                      checked={targetSn === sn}
                      onChange={() => { setTargetSn(sn); setNewSn(sn); }}
                      className="accent-amber-600"
                    />
                    <span className="font-mono-tight text-slate-800">{sn}</span>
                  </label>
                ))}
              </div>
              {targetSn && (
                <p className="text-[11px] text-amber-800 mt-2">
                  ➤ Modificherai solo <b className="font-mono-tight">{targetSn}</b>. Gli altri {parsedSns.length - 1} seriali resteranno invariati.
                </p>
              )}
            </div>
          )}

          {/* F16 (26/02) — CAMBIO PRODOTTO A SERIALE: mantiene lo stesso record,
                cambia solo la relazione Item in uscita (utile per "spedito il prodotto sbagliato"). */}
          {productTipo === "a_seriale" && kind === "spedizione" && (
            <div className="rounded-md border border-indigo-300 bg-indigo-50/40 p-3">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={changeProduct}
                  onChange={(e) => { setChangeProduct(e.target.checked); if (!e.target.checked) setNewProduct(null); }}
                  className="accent-indigo-600"
                  data-testid="retro-change-product-toggle"
                />
                <span className="text-xs font-semibold text-indigo-900">
                  Correggi prodotto (mantieni stesso seriale, cambia solo il modello)
                </span>
              </label>
              {changeProduct && (
                <div className="mt-2 flex items-center gap-2">
                  <div className="flex-1 min-w-0">
                    {newProduct ? (
                      <div className="text-xs bg-white border border-indigo-200 rounded px-2 py-1.5">
                        <span className="text-slate-500">Nuovo prodotto: </span>
                        <b className="text-indigo-800">{newProduct.name}</b>
                      </div>
                    ) : (
                      <div className="text-xs text-slate-500 italic">Nessun prodotto selezionato</div>
                    )}
                  </div>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => setProductPickerOpen(true)}
                    className="border-indigo-300 text-indigo-700 hover:bg-indigo-100"
                    data-testid="retro-change-product-btn"
                  >
                    {newProduct ? "Cambia" : "Scegli prodotto"}
                  </Button>
                </div>
              )}
            </div>
          )}

          {/* F15 (§1/§2) — Campi modificabili adattivi al Tipo Gestione — mostrati SOLO quando il tipo è noto */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {productTipo === "a_seriale" && (
              <div className="sm:col-span-2">
                <Label className="text-xs font-semibold">
                  {isMultiSn && targetSn ? `Nuovo seriale (sostituisce ${targetSn})` : "Nuovo seriale"} <span className="text-slate-400 font-normal">(lascia vuoto per non modificare)</span>
                </Label>
                <Input value={newSn} onChange={(e) => setNewSn(e.target.value)} placeholder={targetSn || row.sn || ""} className="h-11 mt-1 font-mono-tight" data-testid="retro-new-sn" autoComplete="off" disabled={isMultiSn && !targetSn} />
                {isMultiSn && !targetSn && (
                  <p className="text-[11px] text-amber-700 mt-1">⚠ Seleziona prima quale seriale correggere sopra.</p>
                )}
              </div>
            )}
            {productTipo === "a_quantita" && (
              <div className="sm:col-span-2">
                <Label className="text-xs font-semibold">Nuova quantità <span className="text-slate-400 font-normal">(totale corretta)</span></Label>
                <Input type="number" step="any" value={newQty} onChange={(e) => setNewQty(e.target.value)} placeholder={String(row.quantity ?? "")} className="h-11 mt-1 font-mono-tight" data-testid="retro-new-qty" />
                <p className="text-[11px] text-slate-500 mt-1">
                  Inserisci la nuova quantità totale. Lascia vuoto per non modificare. (Attuale <b>{row.quantity ?? "—"}</b> → Nuova <b className="text-amber-700">{newQty !== "" ? newQty : (row.quantity ?? "—")}</b>)
                </p>
              </div>
            )}
            {kind === "spedizione" && productTipo !== null && (
              <>
                <div className="sm:col-span-2">
                  <Label className="text-xs font-semibold">Nuova struttura <span className="text-slate-400 font-normal">(lascia vuoto per non modificare)</span></Label>
                  <Input value={newStructure} onChange={(e) => setNewStructure(e.target.value)} placeholder={row.cliente || ""} className="h-10 mt-1" data-testid="retro-new-structure" />
                </div>
                {productTipo === "a_seriale" && (
                  <div className="sm:col-span-2">
                    <Label className="text-xs font-semibold">QR Code <span className="text-slate-400 font-normal">(aggiungi/modifica — opzionale)</span></Label>
                    <div className="mt-1 flex items-center gap-2">
                      <Input
                        value={newQr}
                        onChange={(e) => setNewQr(e.target.value)}
                        onBlur={(e) => verifyQr(e.target.value)}
                        onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); verifyQr(newQr); } }}
                        placeholder="Digita, scansiona o usa la fotocamera"
                        className="h-11 font-mono-tight flex-1"
                        autoComplete="off"
                        data-testid="retro-new-qr"
                      />
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => setQrScannerOpen(true)}
                        className="h-11 w-11 shrink-0 border-amber-300 text-amber-700 hover:bg-amber-50"
                        data-testid="retro-qr-scan-btn"
                        title="Apri fotocamera"
                        aria-label="Apri fotocamera per QR Code"
                      >
                        <Camera size={18} weight="bold" />
                      </Button>
                    </div>
                    <p className="text-[11px] text-slate-500 mt-1">
                      Scanner palmare/USB/Bluetooth, fotocamera 📷 e digitazione manuale — stessa validazione.
                    </p>
                    {qrChecking && <p className="text-xs text-slate-400 mt-1">Verifica…</p>}
                  </div>
                )}
              </>
            )}
          </div>
        </div>
        {/* F15 fix — Entrambi i pulsanti SEMPRE visibili in ogni riga.
              L'utente decide se aggiungere una WB (A Seriale) o un Accessorio (A Quantità),
              indipendentemente dal tipo del prodotto della riga corrente. */}
        <AddForgottenItem row={row} kind={kind} onDone={onDone} />
        <AddForgottenAccessory row={row} kind={kind} productMeta={productMeta} onDone={onDone} />
        <div>
          <Label className="text-xs font-semibold text-slate-600">Motivazione <span className="text-slate-400 font-normal">(facoltativa)</span></Label>
          <Textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2} placeholder="" className="mt-1" data-testid="retro-reason" />
        </div>
        <DialogFooter className="flex-col sm:flex-row gap-2">
          <Button variant="outline" onClick={onClose} disabled={busy}>Chiudi</Button>
          <Button onClick={() => setConfirmOpen(true)} disabled={busy} className="bg-amber-600 hover:bg-amber-700 text-white min-w-[180px]" data-testid="retro-confirm">
            {busy ? (
              <span className="flex items-center justify-center gap-2">
                <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                  <circle cx="12" cy="12" r="10" strokeWidth="4" className="opacity-25" />
                  <path d="M4 12a8 8 0 018-8v0" strokeWidth="4" className="opacity-75" />
                </svg>
                Salvataggio…
              </span>
            ) : (
              "Conferma modifica"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
      {/* F19 (26/02/2026) — Popup di conferma con riepilogo prima della modifica reale */}
      {confirmOpen && (
        <Dialog open={true} onOpenChange={(v) => !v && setConfirmOpen(false)}>
          <DialogContent className="max-w-md" data-testid="retro-confirm-dialog">
            <DialogHeader>
              <DialogTitle className="text-amber-700">Sei sicuro di voler confermare questa modifica?</DialogTitle>
              <DialogDescription>Riepilogo dell'operazione prima dell'invio.</DialogDescription>
            </DialogHeader>
            <div className="rounded-md border border-slate-200 bg-slate-50 p-3 text-xs space-y-1.5">
              <div><b>Operazione:</b> Modifica {kind === "spedizione" ? "spedizione" : "arrivo"}</div>
              <div><b>Data:</b> {row.date || "—"}</div>
              <div><b>Cliente:</b> {row.cliente || row.fornitore || "—"}</div>
              <div><b>Prodotto:</b> {productMeta.name || row.item_name || "—"}
                {changeProduct && newProduct && (<> → <b className="text-indigo-700">{newProduct.name}</b></>)}
              </div>
              {productTipo === "a_seriale" && (isMultiSn ? targetSn : row.sn) && (
                <div><b>Seriale attuale:</b> <span className="font-mono-tight">{isMultiSn ? targetSn : row.sn}</span>
                  {newSn.trim() && newSn.trim() !== (isMultiSn ? targetSn : row.sn) && (<> → <b className="font-mono-tight text-amber-700">{newSn.trim()}</b></>)}
                </div>
              )}
              {productTipo === "a_quantita" && (
                <div><b>Quantità:</b> <span className="font-mono-tight">{row.quantity ?? "—"}</span>
                  {newQty !== "" && String(newQty) !== String(row.quantity ?? "") && (<> → <b className="font-mono-tight text-amber-700">{newQty}</b></>)}
                </div>
              )}
              {newQr.trim() && <div><b>QR:</b> <span className="font-mono-tight">{newQr}</span></div>}
              <div><b>Operatore:</b> {row.taken_by || "—"}</div>
              <div><b>Ora:</b> {new Date().toLocaleString("it-IT")}</div>
              {reason.trim() && <div><b>Motivazione:</b> {reason.trim()}</div>}
            </div>
            <DialogFooter className="flex-col sm:flex-row gap-2">
              <Button variant="outline" onClick={() => setConfirmOpen(false)} disabled={busy} data-testid="retro-confirm-cancel">Annulla</Button>
              <Button onClick={() => { setConfirmOpen(false); submit(); }} disabled={busy} className="bg-amber-600 hover:bg-amber-700 text-white" data-testid="retro-confirm-yes">
                Conferma modifica
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
      {/* F14 — Fotocamera per scansione QR (riusa componente esistente) */}
      <BarcodeScanner
        open={qrScannerOpen}
        onClose={() => setQrScannerOpen(false)}
        label="Scansiona QR Code"
        onDetected={async (val) => {
          setQrScannerOpen(false);
          // F15 §10-15 — QR Daze: se JSON {serial,puk} estrai serial (PUK ignorato in modifica QR)
          const { serial } = parseDazeQr(val);
          if (!serial) return;
          setNewQr(serial);
          await verifyQr(serial);
        }}
      />
      {/* F16 (26/02) — Product Picker per cambio prodotto A Seriale */}
      {productPickerOpen && (
        <ProductPickerDialog
          onClose={() => setProductPickerOpen(false)}
          onPick={(p) => { setNewProduct(p); setProductPickerOpen(false); }}
          filterTipo="a_seriale"
          currentPageId={productMeta.page_id}
        />
      )}
    </Dialog>
  );
}

// F16 (26/02) — Dialog picker prodotto (A Seriale) per cambio prodotto in Retroattività.
function ProductPickerDialog({ onClose, onPick, filterTipo = "a_seriale", currentPageId = null }) {
  const [q, setQ] = useState("");
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    setLoading(true);
    axios.get(`${API}/inventory`).then(({ data }) => {
      const raw = (data?.items || []).filter((it) => it.active !== false && it.tipo_gestione === filterTipo).map((it) => ({ ...it, page_id: it.page_id || it.id }));
      setItems(raw);
    }).catch(() => setItems([])).finally(() => setLoading(false));
  }, [filterTipo]);
  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    const base = items.filter((it) => it.page_id !== currentPageId);
    if (!s) return base.slice(0, 60);
    return base.filter((it) =>
      (it.name || "").toLowerCase().includes(s) ||
      (it.code || "").toLowerCase().includes(s) ||
      (it.category || "").toLowerCase().includes(s)
    ).slice(0, 60);
  }, [items, q, currentPageId]);
  return (
    <Dialog open={true} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-lg" data-testid="retro-product-picker">
        <DialogHeader>
          <DialogTitle className="text-indigo-800">Scegli il prodotto corretto</DialogTitle>
          <DialogDescription>
            Solo prodotti "A Seriale". Il seriale della riga verrà spostato sul nuovo prodotto (stesso record Notion).
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Cerca per nome, codice o categoria"
            className="h-10"
            autoFocus
            data-testid="retro-product-picker-search"
          />
          <div className="max-h-72 overflow-y-auto border border-slate-200 rounded-md bg-white">
            {loading ? (
              <div className="p-3 text-sm text-slate-400">Caricamento…</div>
            ) : filtered.length === 0 ? (
              <div className="p-3 text-sm text-slate-400">Nessun prodotto trovato.</div>
            ) : (
              filtered.map((it) => (
                <button
                  key={it.page_id}
                  type="button"
                  onClick={() => onPick({ page_id: it.page_id, name: it.name, tipo_gestione: it.tipo_gestione, code: it.code })}
                  className="w-full text-left px-3 py-2 hover:bg-indigo-50 border-b border-slate-100 last:border-b-0 flex items-center justify-between gap-2"
                  data-testid={`retro-product-pick-${it.page_id}`}
                >
                  <div className="min-w-0">
                    <div className="text-sm font-semibold text-slate-900 truncate">{it.name || "—"}</div>
                    <div className="text-[11px] text-slate-500 font-mono-tight truncate">{it.code || "—"} · {it.category || "—"}</div>
                  </div>
                  <span className="text-[10px] px-2 h-6 inline-flex items-center rounded-full font-semibold shrink-0 bg-emerald-100 text-emerald-800">A Seriale</span>
                </button>
              ))
            )}
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Annulla</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// F14 §2-14 + F15 pick — Aggiungi Wallbox dimenticata CON product picker:

// F15 §7-11 — Dialog dedicato per Annulla spedizione/arrivo con preview + motivazione obbligatoria.
function CancelDialog({ row, kind, onClose, onDone }) {
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!reason.trim()) { toast.error("Motivazione obbligatoria"); return; }
    setBusy(true);
    try {
      const { data } = await axios.post(`${API}/retro/cancel/${kind}/${row.id}`, { reason: reason.trim() });
      toast.success(kind === "spedizione" ? "Spedizione annullata" : "Arrivo annullato", {
        description: data?.restored_serials?.length ? `Seriali ripristinati: ${data.restored_serials.length}` : "Effetti magazzino ripristinati.",
      });
      onDone();
    } catch (e) {
      toast.error("Annullamento fallito", { description: formatError(e) });
    } finally { setBusy(false); }
  };

  const label = kind === "spedizione" ? "spedizione" : "arrivo";
  const partyLabel = kind === "spedizione" ? "Cliente/Struttura" : "Fornitore";
  const partyValue = kind === "spedizione" ? row.cliente : row.fornitore;

  return (
    <Dialog open={true} onOpenChange={(v) => !v && !busy && onClose()}>
      <DialogContent className="max-w-lg" data-testid="retro-cancel-dialog">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-red-700">
            <Trash size={20} weight="bold" /> Annullare questa {label}?
          </DialogTitle>
          <DialogDescription>
            L'annullamento rimuoverà gli effetti di questa {label} e ripristinerà la disponibilità dei prodotti/seriali coinvolti. L'operazione verrà registrata nell'audit.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="rounded-md border border-red-200 bg-red-50/70 p-3 text-xs space-y-1">
            <div><b>Data:</b> <span className="font-mono-tight">{row.date || "—"}</span></div>
            <div><b>{partyLabel}:</b> {partyValue || "—"}</div>
            <div><b>Prodotto/i:</b> {row.item_name || (row.item_names || []).join(", ") || "—"}</div>
            <div><b>Quantità:</b> <span className="font-mono-tight">{row.quantity ?? "—"}</span></div>
            <div><b>Seriali:</b> <span className="font-mono-tight">{row.sn || "—"}</span></div>
          </div>
          <div>
            <Label className="text-xs font-semibold text-red-700">Motivazione (obbligatoria) *</Label>
            <Textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={3} placeholder="" className="mt-1" data-testid="retro-cancel-reason" autoFocus />
          </div>
        </div>
        <DialogFooter className="flex-col sm:flex-row gap-2">
          <Button variant="outline" onClick={onClose} disabled={busy} data-testid="retro-cancel-back">
            <ArrowUUpLeft size={14} weight="bold" className="mr-1" /> Torna indietro
          </Button>
          <Button
            onClick={submit}
            disabled={busy || !reason.trim()}
            className="bg-red-600 hover:bg-red-700 text-white min-w-[200px]"
            data-testid="retro-cancel-confirm"
          >
            {busy ? (
              <span className="flex items-center justify-center gap-2">
                <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                  <circle cx="12" cy="12" r="10" strokeWidth="4" className="opacity-25" />
                  <path d="M4 12a8 8 0 018-8v0" strokeWidth="4" className="opacity-75" />
                </svg>
                Annullo…
              </span>
            ) : (
              <><Trash size={14} weight="bold" className="mr-1" /> Conferma annullamento</>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

//   • Utente sceglie il prodotto A Seriale (default = prodotto della riga)
//   • Se pick = stesso prodotto della riga → append SN allo stesso record (endpoint /add-item esistente)
//   • Se pick = prodotto diverso → nuova riga tracker/receipt nella stessa operazione (endpoint /add-accessory esistente)
function AddForgottenItem({ row, kind, onDone }) {
  const [open, setOpen] = useState(false);
  const [inventory, setInventory] = useState([]);
  const [loadingInv, setLoadingInv] = useState(false);
  const [q, setQ] = useState("");
  const [selected, setSelected] = useState(null); // {page_id, name, tipo_gestione, code}
  const [reason, setReason] = useState("");
  const [addSn, setAddSn] = useState("");
  const [addQr, setAddQr] = useState("");
  const [scanFor, setScanFor] = useState(null); // "sn" | "qr" | null
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open || inventory.length > 0) return;
    setLoadingInv(true);
    axios.get(`${API}/inventory`).then(({ data }) => {
      const items = (data?.items || []).filter((it) => it.active !== false).map((it) => ({ ...it, page_id: it.page_id || it.id }));
      setInventory(items);
      // Prefill prodotto già presente nella riga (default = same product) se A Seriale
      const prefillId = (row?.item_ids && row.item_ids[0]) || null;
      if (prefillId) {
        const found = items.find((x) => x.page_id === prefillId);
        if (found && found.tipo_gestione === "a_seriale") {
          setSelected({ page_id: found.page_id, name: found.name, tipo_gestione: found.tipo_gestione, code: found.code });
        }
      }
    }).catch((e) => toast.error("Errore caricamento inventario", { description: formatError(e) }))
      .finally(() => setLoadingInv(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, inventory.length]);

  const filtered = useMemo(() => {
    // Solo A Seriale (le WB e i prodotti serializzati)
    const base = inventory.filter((it) => it.tipo_gestione === "a_seriale");
    const s = q.trim().toLowerCase();
    if (!s) return base.slice(0, 40);
    return base.filter((it) =>
      (it.name || "").toLowerCase().includes(s) ||
      (it.code || "").toLowerCase().includes(s) ||
      (it.category || "").toLowerCase().includes(s)
    ).slice(0, 40);
  }, [inventory, q]);

  const reset = () => {
    setOpen(false); setSelected(null); setReason("");
    setAddSn(""); setAddQr(""); setQ("");
  };

  const submit = async () => {
    if (!selected) { toast.error("Seleziona un prodotto"); return; }
    if (!reason.trim() || !addSn.trim()) { toast.error("Seriale e motivazione obbligatori"); return; }
    setBusy(true);
    try {
      const sameAsRow = (row?.item_ids || []).includes(selected.page_id);
      if (sameAsRow) {
        // Stesso prodotto della riga → append SN allo stesso record
        const body = { reason: reason.trim(), new_sn: addSn.trim() };
        if (kind === "spedizione" && addQr.trim()) body.new_qr_code = addQr.trim();
        const path = kind === "spedizione"
          ? `retro/shipment/${row.id}/add-item`
          : `retro/arrivo/${row.id}/add-item`;
        const { data } = await axios.post(`${API}/${path}`, body);
        toast.success("Wallbox dimenticata aggiunta (stesso record)", {
          description: `Nuova quantità: ${data.new_qty} · Seriali: ${(data.sn_list || []).length}`,
        });
      } else {
        // Prodotto diverso → nuova riga nella stessa operazione (endpoint /add-accessory)
        const body = {
          reason: reason.trim(),
          product_page_id: selected.page_id,
          quantity: 1,
          serial: addSn.trim(),
        };
        if (kind === "spedizione" && addQr.trim()) body.qr_code = addQr.trim();
        const path = kind === "spedizione"
          ? `retro/shipment/${row.id}/add-accessory`
          : `retro/arrivo/${row.id}/add-accessory`;
        const { data } = await axios.post(`${API}/${path}`, body);
        toast.success("Wallbox dimenticata aggiunta (stessa operazione)", {
          description: `${data.product || selected.name} · SN ${data.serial}`,
        });
      }
      reset();
      onDone();
    } catch (e) {
      toast.error("Aggiunta fallita", { description: formatError(e) });
    } finally { setBusy(false); }
  };

  if (!open) {
    return (
      <div className="mt-4 border-t border-slate-200 pt-3">
        <Button
          type="button"
          variant="outline"
          onClick={() => setOpen(true)}
          className="w-full sm:w-auto sm:min-w-[280px] mx-auto flex border-2 border-amber-400 bg-amber-50 hover:bg-amber-100 text-amber-800 font-semibold h-11"
          data-testid="retro-add-forgotten-btn"
        >
          ➕ Aggiungi Wallbox dimenticata
        </Button>
        <p className="text-[11px] text-slate-400 mt-2 text-center">
          Prodotto A Seriale + seriale{kind === "spedizione" ? " + QR opzionale" : ""}. Nessuna modifica alla struttura Notion.
        </p>
      </div>
    );
  }

  const sameAsRow = selected && (row?.item_ids || []).includes(selected.page_id);

  return (
    <>
      <div className="mt-4 border-t border-slate-200 pt-3 space-y-3 bg-amber-50/40 -mx-6 px-6 pb-4 rounded-b-md">
        <div className="text-xs uppercase tracking-wider font-bold text-amber-800">➕ Aggiungi Wallbox dimenticata</div>

        {/* STEP 1 — Selezione prodotto A Seriale */}
        {!selected ? (
          <div className="space-y-2">
            <Label className="text-xs font-semibold">Cerca prodotto (A Seriale)</Label>
            <Input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Nome, codice o categoria"
              className="h-10"
              autoComplete="off"
              data-testid="retro-fwb-search"
              autoFocus
            />
            <div className="max-h-56 overflow-y-auto border border-slate-200 rounded-md bg-white">
              {loadingInv ? (
                <div className="p-3 text-sm text-slate-400">Caricamento…</div>
              ) : filtered.length === 0 ? (
                <div className="p-3 text-sm text-slate-400">Nessun prodotto A Seriale trovato.</div>
              ) : (
                filtered.map((it) => (
                  <button
                    key={it.page_id}
                    type="button"
                    onClick={() => setSelected({ page_id: it.page_id, name: it.name, tipo_gestione: it.tipo_gestione, code: it.code })}
                    className="w-full text-left px-3 py-2 hover:bg-amber-50 border-b border-slate-100 last:border-b-0 flex items-center justify-between gap-2"
                    data-testid={`retro-fwb-item-${it.page_id}`}
                  >
                    <div className="min-w-0">
                      <div className="text-sm font-semibold text-slate-900 truncate">{it.name || "—"}</div>
                      <div className="text-[11px] text-slate-500 font-mono-tight truncate">{it.code || "—"} · {it.category || "—"}</div>
                    </div>
                    <span className="text-[10px] px-2 h-6 inline-flex items-center rounded-full font-semibold shrink-0 bg-emerald-100 text-emerald-800">
                      A Seriale
                    </span>
                  </button>
                ))
              )}
            </div>
          </div>
        ) : (
          <>
            <div className="flex items-center justify-between gap-2 border border-slate-200 rounded-md bg-white px-3 py-2">
              <div className="min-w-0">
                <div className="text-sm font-semibold text-slate-900 truncate">{selected.name}</div>
                <div className="text-[11px] text-slate-500 font-mono-tight truncate">
                  {selected.code || "—"} · A Seriale {sameAsRow && <span className="ml-1 text-emerald-700">· stesso record</span>}
                </div>
              </div>
              <Button type="button" variant="outline" size="sm" onClick={() => setSelected(null)} data-testid="retro-fwb-change">
                Cambia
              </Button>
            </div>

            <div>
              <Label className="text-xs font-semibold">Nuovo seriale *</Label>
              <div className="flex gap-2 mt-1">
                <Input value={addSn} onChange={(e) => setAddSn(e.target.value)} className="h-10 font-mono-tight flex-1" placeholder="Digita o scansiona" autoComplete="off" data-testid="retro-add-sn" />
                <Button type="button" variant="outline" onClick={() => setScanFor("sn")} className="h-10 w-10 shrink-0" data-testid="retro-add-sn-scan" title="Apri fotocamera" aria-label="Scansiona seriale">
                  <Camera size={14} weight="bold" />
                </Button>
              </div>
            </div>
            {kind === "spedizione" && (
              <div>
                <Label className="text-xs font-semibold">QR Code (opz)</Label>
                <div className="flex gap-2 mt-1">
                  <Input
                    value={addQr}
                    onChange={(e) => setAddQr(e.target.value)}
                    placeholder="Digita, scansiona o usa la fotocamera"
                    className="h-10 font-mono-tight flex-1"
                    autoComplete="off"
                    data-testid="retro-add-qr"
                  />
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setScanFor("qr")}
                    className="h-10 w-10 shrink-0 border-amber-300 text-amber-700 hover:bg-amber-50"
                    data-testid="retro-add-qr-scan"
                    title="Apri fotocamera"
                    aria-label="Scansiona QR"
                  >
                    <Camera size={14} weight="bold" />
                  </Button>
                </div>
              </div>
            )}

            <div>
              <Label className="text-xs font-semibold text-red-700">Motivazione *</Label>
              <Textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2} className="mt-1" data-testid="retro-add-reason" />
            </div>

            <p className="text-[11px] text-slate-500">
              {sameAsRow
                ? "Il seriale verrà accodato allo stesso record esistente."
                : `Verrà creata una nuova riga per ${selected.name} nella stessa operazione.`}
            </p>
          </>
        )}

        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={reset} disabled={busy}>Annulla</Button>
          <Button
            type="button"
            onClick={submit}
            disabled={busy || !selected || !reason.trim() || !addSn.trim()}
            className="bg-amber-600 hover:bg-amber-700 text-white min-w-[140px]"
            data-testid="retro-add-confirm"
          >
            {busy ? (
              <span className="flex items-center gap-2">
                <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                  <circle cx="12" cy="12" r="10" strokeWidth="4" className="opacity-25" />
                  <path d="M4 12a8 8 0 018-8v0" strokeWidth="4" className="opacity-75" />
                </svg>
                Aggiungo…
              </span>
            ) : "Aggiungi wallbox"}
          </Button>
        </div>
      </div>
      <BarcodeScanner
        open={scanFor !== null}
        onClose={() => setScanFor(null)}
        label={scanFor === "qr" ? "Scansiona QR Code" : "Scansiona seriale"}
        onDetected={(val) => {
          // F15 §10-15 — parser QR Daze per seriali/QR retroattivi
          const parsed = parseDazeQr(val);
          const v = parsed.serial || "";
          if (scanFor === "sn") setAddSn(v);
          else if (scanFor === "qr") setAddQr(v);
          setScanFor(null);
        }}
      />
    </>
  );
}

// F15 (§2) — Aggiungi Accessorio dimenticato — CON product picker:
//   • Utente può scegliere un prodotto qualsiasi (default = prodotto della riga)
//   • Se pick = stesso prodotto A Quantità della riga → somma quantità sullo stesso record
//   • Se pick = prodotto diverso → crea nuova riga tracker/receipt nello STESSO ordine/operazione
//     (stesso cliente/data/taken_by), riusando il backend /add-accessory esistente.
function AddForgottenAccessory({ row, kind, productMeta, onDone }) {
  const [open, setOpen] = useState(false);
  const [inventory, setInventory] = useState([]);
  const [loadingInv, setLoadingInv] = useState(false);
  const [q, setQ] = useState("");
  const [selected, setSelected] = useState(null); // {page_id, name, tipo_gestione}
  const [reason, setReason] = useState("");
  const [addQty, setAddQty] = useState("1");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open || inventory.length > 0) return;
    setLoadingInv(true);
    axios.get(`${API}/inventory`).then(({ data }) => {
      const items = (data?.items || []).filter((it) => it.active !== false).map((it) => ({ ...it, page_id: it.page_id || it.id }));
      setInventory(items);
      // Prefill prodotto già presente nella riga (default = same product)
      const prefillId = (row?.item_ids && row.item_ids[0]) || null;
      if (prefillId) {
        const found = items.find((x) => x.page_id === prefillId);
        if (found) setSelected({ page_id: found.page_id, name: found.name, tipo_gestione: found.tipo_gestione, code: found.code });
      }
    }).catch((e) => toast.error("Errore caricamento inventario", { description: formatError(e) }))
      .finally(() => setLoadingInv(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, inventory.length]);

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    // Mostro solo A Quantità nel picker accessorio (i seriali WB usano l'altro pulsante)
    const base = inventory.filter((it) => it.tipo_gestione === "a_quantita");
    if (!s) return base.slice(0, 40);
    return base.filter((it) =>
      (it.name || "").toLowerCase().includes(s) ||
      (it.code || "").toLowerCase().includes(s) ||
      (it.category || "").toLowerCase().includes(s)
    ).slice(0, 40);
  }, [inventory, q]);

  const reset = () => {
    setOpen(false); setSelected(null); setReason("");
    setAddQty("1"); setQ("");
  };

  const submit = async () => {
    if (!selected) { toast.error("Seleziona un prodotto"); return; }
    if (!reason.trim()) { toast.error("Motivazione obbligatoria"); return; }
    const delta = Number(addQty);
    if (!delta || delta <= 0) { toast.error("Quantità non valida"); return; }
    setBusy(true);
    try {
      const sameAsRow = (row?.item_ids || []).includes(selected.page_id);
      if (sameAsRow) {
        // Stesso prodotto della riga → SOMMA sullo STESSO record (nessuna nuova riga Notion)
        const currentQty = Number(row?.quantity || 0);
        const newTotal = currentQty + delta;
        const path = kind === "spedizione" ? `retro/shipment/${row.id}` : `retro/arrivo/${row.id}`;
        await axios.patch(`${API}/${path}`, {
          reason: `[+${delta}] ${reason.trim()}`,
          new_quantity: newTotal,
        });
        toast.success("Accessorio dimenticato aggiunto (stesso record)", {
          description: `${selected.name} · ${currentQty} → ${newTotal}`,
        });
      } else {
        // Prodotto diverso → nuova riga tracker/receipt nella stessa operazione
        const path = kind === "spedizione"
          ? `retro/shipment/${row.id}/add-accessory`
          : `retro/arrivo/${row.id}/add-accessory`;
        const { data } = await axios.post(`${API}/${path}`, {
          reason: reason.trim(),
          product_page_id: selected.page_id,
          quantity: delta,
        });
        toast.success("Accessorio dimenticato aggiunto", {
          description: `${data.product || selected.name} · Qty ${delta}`,
        });
      }
      reset();
      onDone();
    } catch (e) {
      toast.error("Aggiunta fallita", { description: formatError(e) });
    } finally { setBusy(false); }
  };

  if (!open) {
    return (
      <div className="mt-2">
        <Button
          type="button"
          variant="outline"
          onClick={() => setOpen(true)}
          className="w-full sm:w-auto sm:min-w-[280px] mx-auto flex border-2 border-sky-400 bg-sky-50 hover:bg-sky-100 text-sky-800 font-semibold h-11"
          data-testid="retro-add-accessory-btn"
        >
          ➕ Aggiungi Accessorio dimenticato
        </Button>
        <p className="text-[11px] text-slate-400 mt-2 text-center">
          Prodotto + quantità. Nessuna modifica alla struttura Notion.
        </p>
      </div>
    );
  }

  const currentQty = Number(row?.quantity || 0);
  const sameAsRow = selected && (row?.item_ids || []).includes(selected.page_id);
  const preview = sameAsRow ? currentQty + (Number(addQty) || 0) : (Number(addQty) || 0);

  return (
    <div className="mt-2 border-t border-slate-200 pt-3 space-y-3 bg-sky-50/50 -mx-6 px-6 pb-4 rounded-b-md">
      <div className="text-xs uppercase tracking-wider font-bold text-sky-800">➕ Aggiungi Accessorio dimenticato</div>

      {/* STEP 1 — Selezione prodotto */}
      {!selected ? (
        <div className="space-y-2">
          <Label className="text-xs font-semibold">Cerca prodotto</Label>
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Nome, codice o categoria"
            className="h-10"
            autoComplete="off"
            data-testid="retro-acc-search"
            autoFocus
          />
          <div className="max-h-56 overflow-y-auto border border-slate-200 rounded-md bg-white">
            {loadingInv ? (
              <div className="p-3 text-sm text-slate-400">Caricamento…</div>
            ) : filtered.length === 0 ? (
              <div className="p-3 text-sm text-slate-400">Nessun prodotto A Quantità trovato.</div>
            ) : (
              filtered.map((it) => (
                <button
                  key={it.page_id}
                  type="button"
                  onClick={() => setSelected({ page_id: it.page_id, name: it.name, tipo_gestione: it.tipo_gestione, code: it.code })}
                  className="w-full text-left px-3 py-2 hover:bg-sky-50 border-b border-slate-100 last:border-b-0 flex items-center justify-between gap-2"
                  data-testid={`retro-acc-item-${it.page_id}`}
                >
                  <div className="min-w-0">
                    <div className="text-sm font-semibold text-slate-900 truncate">{it.name || "—"}</div>
                    <div className="text-[11px] text-slate-500 font-mono-tight truncate">{it.code || "—"} · {it.category || "—"}</div>
                  </div>
                  <span className="text-[10px] px-2 h-6 inline-flex items-center rounded-full font-semibold shrink-0 bg-sky-100 text-sky-800">
                    A Quantità
                  </span>
                </button>
              ))
            )}
          </div>
        </div>
      ) : (
        <>
          <div className="flex items-center justify-between gap-2 border border-slate-200 rounded-md bg-white px-3 py-2">
            <div className="min-w-0">
              <div className="text-sm font-semibold text-slate-900 truncate">{selected.name}</div>
              <div className="text-[11px] text-slate-500 font-mono-tight truncate">
                {selected.code || "—"} · A Quantità {sameAsRow && <span className="ml-1 text-emerald-700">· stesso record</span>}
              </div>
            </div>
            <Button type="button" variant="outline" size="sm" onClick={() => setSelected(null)} data-testid="retro-acc-change">
              Cambia
            </Button>
          </div>

          <div>
            <Label className="text-xs font-semibold">Quantità da aggiungere *</Label>
            <Input
              type="number" min="0.01" step="any"
              value={addQty}
              onChange={(e) => setAddQty(e.target.value)}
              className="h-10 mt-1 font-mono-tight"
              data-testid="retro-acc-qty"
              autoFocus
            />
            <p className="text-[11px] text-slate-500 mt-1">
              {sameAsRow ? (
                <>Anteprima: <b>{currentQty}</b> + <b>{Number(addQty) || 0}</b> = <b className="text-sky-700">{preview}</b> (stesso record)</>
              ) : (
                <>Verrà creata una nuova riga per <b>{selected.name}</b> · Qty <b className="text-sky-700">{preview}</b> (stessa operazione)</>
              )}
            </p>
          </div>

          <div>
            <Label className="text-xs font-semibold text-red-700">Motivazione *</Label>
            <Textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2} className="mt-1" data-testid="retro-acc-reason" />
          </div>
        </>
      )}

      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" onClick={reset} disabled={busy}>Annulla</Button>
        <Button
          type="button"
          onClick={submit}
          disabled={busy || !selected || !reason.trim() || !addQty || Number(addQty) <= 0}
          className="bg-sky-600 hover:bg-sky-700 text-white min-w-[140px]"
          data-testid="retro-acc-confirm"
        >
          {busy ? (
            <span className="flex items-center gap-2">
              <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                <circle cx="12" cy="12" r="10" strokeWidth="4" className="opacity-25" />
                <path d="M4 12a8 8 0 018-8v0" strokeWidth="4" className="opacity-75" />
              </svg>
              Aggiungo…
            </span>
          ) : "Aggiungi accessorio"}
        </Button>
      </div>
    </div>
  );
}
