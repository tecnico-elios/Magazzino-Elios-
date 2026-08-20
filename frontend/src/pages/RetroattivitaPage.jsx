import { useEffect, useState } from "react";
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
import { ArrowUUpLeft, MagnifyingGlass, Warning, PencilSimple, Prohibit, Camera } from "@phosphor-icons/react";
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
                      <Button size="sm" variant="outline" onClick={() => setEditing({ row: r, kind: tipo })} data-testid={`retro-edit-${r.id}`}>
                        <PencilSimple size={14} weight="bold" className="mr-1" /> Modifica
                      </Button>
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
    </div>
  );
}

function EditDialog({ row, kind, onClose, onDone }) {
  const [reason, setReason] = useState("");
  // F14 fix (20/02): precarica i valori esistenti del record. L'utente modifica SOLO ciò che serve.
  const [newSn, setNewSn] = useState(row?.sn || "");
  const [newQty, setNewQty] = useState(row?.quantity != null ? String(row.quantity) : "");
  const [newStructure, setNewStructure] = useState(row?.cliente || "");
  const [newQr, setNewQr] = useState("");
  const [qrScannerOpen, setQrScannerOpen] = useState(false);
  const [qrChecking, setQrChecking] = useState(false);
  const [busy, setBusy] = useState(false);
  // F15 (§3) — rileva Tipo Gestione del prodotto dalla configurazione Inventario.
  // Usa item_ids[0] dalla riga Notion Uscite/Entrate. Riuso: nessuna nuova API.
  const [productTipo, setProductTipo] = useState(null); // null | "a_seriale" | "a_quantita"
  const [productMeta, setProductMeta] = useState({ name: null, code: null, page_id: null });
  useEffect(() => {
    const pid = (row?.item_ids && row.item_ids[0]) || null;
    if (!pid) return;
    axios.get(`${API}/inventory`).then(({ data }) => {
      const items = data?.items || [];
      const p = items.find((x) => x.page_id === pid);
      if (p) {
        setProductTipo(p.tipo_gestione || null);
        setProductMeta({ name: p.name, code: p.code, page_id: p.page_id });
      }
    }).catch(() => {});
  }, [row?.item_ids]);

  // F14 fix (20/02): recupera QR esistente per il seriale (se presente)
  useEffect(() => {
    if (kind !== "spedizione" || !row?.sn) return;
    axios.get(`${API}/qr/by-serial`, { params: { sn: row.sn } })
      .then(({ data }) => {
        if (data?.exists && data?.qr_code) {
          setNewQr(data.qr_code);
        }
      })
      .catch(() => {});
  }, [kind, row?.sn]);

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
    if (!reason.trim()) {
      toast.error("Motivazione obbligatoria");
      return;
    }
    setBusy(true);
    try {
      const body = { reason: reason.trim() };
      // F14 fix (20/02): invia SOLO i campi effettivamente modificati.
      // Il backend aggiornerà unicamente quei campi (§7 modifica parziale).
      const sn0 = row?.sn || "";
      const qty0 = row?.quantity != null ? String(row.quantity) : "";
      const struct0 = row?.cliente || "";
      if (newSn.trim() && newSn.trim() !== sn0) body.new_sn = newSn.trim();
      if (newQty !== "" && !isNaN(parseFloat(newQty)) && String(newQty) !== qty0) {
        body.new_quantity = parseFloat(newQty);
      }
      if (kind === "spedizione") {
        if (newStructure.trim() && newStructure.trim() !== struct0) body.new_structure = newStructure.trim();
        if (newQr.trim()) body.new_qr_code = newQr.trim();
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
    if (!reason.trim()) {
      toast.error("Motivazione obbligatoria per l'annullamento");
      return;
    }
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
            {productTipo === "a_seriale" && (
              <div><b>Seriale attuale:</b> <span className="font-mono-tight">{row.sn || "—"}</span></div>
            )}
            {productTipo === "a_quantita" && (
              <div><b>Quantità attuale:</b> {row.quantity ?? "—"}</div>
            )}
            {productTipo === null && (
              <>
                <div><b>Seriale attuale:</b> <span className="font-mono-tight">{row.sn || "—"}</span></div>
                <div><b>Quantità attuale:</b> {row.quantity ?? "—"}</div>
              </>
            )}
            {kind === "spedizione" && <div><b>Cliente attuale:</b> {row.cliente || "—"}</div>}
          </div>

          {/* F15 (§1/§2) — Campi modificabili adattivi al Tipo Gestione */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {productTipo === "a_seriale" && (
              <div>
                <Label className="text-xs font-semibold">Nuovo seriale (opz)</Label>
                <Input value={newSn} onChange={(e) => setNewSn(e.target.value)} placeholder={row.sn || ""} className="h-10 mt-1 font-mono-tight" data-testid="retro-new-sn" />
              </div>
            )}
            {productTipo === "a_quantita" && (
              <div>
                <Label className="text-xs font-semibold">Nuova quantità (opz)</Label>
                <Input type="number" step="any" value={newQty} onChange={(e) => setNewQty(e.target.value)} placeholder={String(row.quantity ?? "")} className="h-10 mt-1 font-mono-tight" data-testid="retro-new-qty" />
              </div>
            )}
            {productTipo === null && (
              <>
                <div>
                  <Label className="text-xs font-semibold">Nuovo seriale (opz)</Label>
                  <Input value={newSn} onChange={(e) => setNewSn(e.target.value)} placeholder={row.sn || ""} className="h-10 mt-1 font-mono-tight" data-testid="retro-new-sn" />
                </div>
                <div>
                  <Label className="text-xs font-semibold">Nuova quantità (opz)</Label>
                  <Input type="number" step="any" value={newQty} onChange={(e) => setNewQty(e.target.value)} placeholder={String(row.quantity ?? "")} className="h-10 mt-1 font-mono-tight" data-testid="retro-new-qty" />
                </div>
              </>
            )}
            {kind === "spedizione" && (
              <>
                <div>
                  <Label className="text-xs font-semibold">Nuova struttura (opz)</Label>
                  <Input value={newStructure} onChange={(e) => setNewStructure(e.target.value)} placeholder={row.cliente || ""} className="h-10 mt-1" data-testid="retro-new-structure" />
                </div>
                {productTipo !== "a_quantita" && (
                  <div className="sm:col-span-2">
                    <Label className="text-xs font-semibold">QR Code (aggiungi/modifica — opzionale)</Label>
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
        {/* F15 fix — Pulsanti Retroattività:
              • A Seriale → SOLO "Aggiungi Wallbox dimenticata"
              • A Quantità → SOLO "Aggiungi Accessorio dimenticato"
              • Sconosciuto (tipo non rilevabile) → mostro ENTRAMBI in fallback per non
                perdere la funzione esistente. NON rimuovere questa logica. */}
        {(productTipo === "a_seriale" || productTipo === null) && (
          <AddForgottenItem row={row} kind={kind} onDone={onDone} />
        )}
        {(productTipo === "a_quantita" || productTipo === null) && (
          <AddForgottenAccessory row={row} kind={kind} productMeta={productMeta} onDone={onDone} />
        )}
        <div>
          <Label className="text-xs font-semibold text-red-700">Motivazione (obbligatoria) *</Label>
          <Textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2} placeholder="" className="mt-1" data-testid="retro-reason" />
        </div>
        <DialogFooter className="flex-col sm:flex-row gap-2">
          <Button variant="outline" onClick={onClose} disabled={busy}>Chiudi</Button>
          <Button variant="destructive" onClick={cancelOp} disabled={busy} data-testid="retro-cancel-op">
            <Prohibit size={14} weight="bold" className="mr-1" /> Annulla operazione
          </Button>
          <Button onClick={submit} disabled={busy} className="bg-amber-600 hover:bg-amber-700 text-white min-w-[180px]" data-testid="retro-confirm">
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
      {/* F14 — Fotocamera per scansione QR (riusa componente esistente) */}
      <BarcodeScanner
        open={qrScannerOpen}
        onClose={() => setQrScannerOpen(false)}
        label="Scansiona QR Code"
        onDetected={async (val) => {
          setQrScannerOpen(false);
          const v = (val || "").trim();
          if (!v) return;
          setNewQr(v);
          await verifyQr(v);
        }}
      />
    </Dialog>
  );
}

// F14 §2-14 — Sub-form per aggiungere una Wallbox dimenticata all'operazione esistente
function AddForgottenItem({ row, kind, onDone }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [addSn, setAddSn] = useState("");
  const [addQr, setAddQr] = useState("");
  const [scanFor, setScanFor] = useState(null); // "sn" | "qr" | null
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!reason.trim() || !addSn.trim()) {
      toast.error("Seriale e motivazione obbligatori");
      return;
    }
    setBusy(true);
    try {
      const body = { reason: reason.trim(), new_sn: addSn.trim() };
      if (kind === "spedizione" && addQr.trim()) body.new_qr_code = addQr.trim();
      const path = kind === "spedizione"
        ? `retro/shipment/${row.id}/add-item`
        : `retro/arrivo/${row.id}/add-item`;
      const { data } = await axios.post(`${API}/${path}`, body);
      toast.success("Wallbox dimenticata aggiunta", {
        description: `Nuova quantità: ${data.new_qty} · Seriali: ${(data.sn_list || []).length}`,
      });
      setOpen(false); setReason(""); setAddSn(""); setAddQr("");
      onDone();
    } catch (e) {
      toast.error("Aggiunta fallita", { description: formatError(e) });
    } finally { setBusy(false); }
  };

  if (!open) {
    return (
      <div className="mt-4 border-t border-slate-200 pt-3">
        {/* F14 (BLOCCO 2) — Pulsante SEMPRE visibile su tutti i dispositivi (mobile/tablet/palmare/desktop).
            w-full su mobile, larghezza auto e centrato su desktop. Nessun display:none / hidden. */}
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
          Aggiunge un seriale{kind === "spedizione" ? " + QR opzionale" : ""} allo stesso record ({kind}). Nessuna nuova riga.
        </p>
      </div>
    );
  }

  return (
    <>
      <div className="mt-4 border-t border-slate-200 pt-3 space-y-3 bg-amber-50/40 -mx-6 px-6 pb-4 rounded-b-md">
        <div className="text-xs uppercase tracking-wider font-bold text-amber-800">➕ Aggiungi Wallbox dimenticata</div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="sm:col-span-2">
            <Label className="text-xs font-semibold">Nuovo seriale *</Label>
            <div className="flex gap-2 mt-1">
              <Input value={addSn} onChange={(e) => setAddSn(e.target.value)} className="h-10 font-mono-tight flex-1" data-testid="retro-add-sn" />
              <Button type="button" variant="outline" size="sm" onClick={() => setScanFor("sn")} data-testid="retro-add-sn-scan">
                <Camera size={14} weight="bold" />
              </Button>
            </div>
          </div>
          {kind === "spedizione" && (
            <div className="sm:col-span-2">
              <Label className="text-xs font-semibold">QR Code (opz)</Label>
              {/* F14 (BLOCCO 1) — input + fotocamera SEMPRE visibili */}
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
                  aria-label="Apri fotocamera per QR"
                >
                  <Camera size={14} weight="bold" />
                </Button>
              </div>
            </div>
          )}
          <div className="sm:col-span-2">
            <Label className="text-xs font-semibold text-red-700">Motivazione *</Label>
            <Textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2} className="mt-1" data-testid="retro-add-reason" />
          </div>
        </div>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={busy}>Annulla</Button>
          <Button type="button" onClick={submit} disabled={busy || !addSn.trim() || !reason.trim()} className="bg-amber-600 hover:bg-amber-700 text-white min-w-[140px]" data-testid="retro-add-confirm">
            {busy ? (
              <span className="flex items-center gap-2">
                <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                  <circle cx="12" cy="12" r="10" strokeWidth="4" className="opacity-25" />
                  <path d="M4 12a8 8 0 018-8v0" strokeWidth="4" className="opacity-75" />
                </svg>
                Aggiungo…
              </span>
            ) : "Aggiungi"}
          </Button>
        </div>
      </div>
      <BarcodeScanner
        open={scanFor !== null}
        onClose={() => setScanFor(null)}
        label={scanFor === "qr" ? "Scansiona QR Code" : "Scansiona seriale"}
        onDetected={(val) => {
          const v = (val || "").trim();
          if (scanFor === "sn") setAddSn(v);
          else if (scanFor === "qr") setAddQr(v);
          setScanFor(null);
        }}
      />
    </>
  );
}

// F15 (§2) — Aggiungi Accessorio dimenticato — versione semplificata:
//   • Solo per prodotti A Quantità (mostrato solo quando productTipo === "a_quantita")
//   • Nessun product picker: aggiorna lo STESSO record (stesso prodotto della riga)
//   • Nessun SN, nessun QR — chiede solo Quantità da aggiungere + Motivazione
//   • Riuso puro dell'endpoint PATCH retro/{shipment|arrivo}/{id} (edit esistente):
//       new_quantity = row.quantity + delta   → non crea nuove righe Notion.
function AddForgottenAccessory({ row, kind, productMeta, onDone }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [addQty, setAddQty] = useState("1");
  const [busy, setBusy] = useState(false);

  const reset = () => {
    setOpen(false); setReason(""); setAddQty("1");
  };

  const submit = async () => {
    if (!reason.trim()) { toast.error("Motivazione obbligatoria"); return; }
    const delta = Number(addQty);
    if (!delta || delta <= 0) { toast.error("Quantità non valida"); return; }
    setBusy(true);
    try {
      const currentQty = Number(row?.quantity || 0);
      const newTotal = currentQty + delta;
      const path = kind === "spedizione" ? `retro/shipment/${row.id}` : `retro/arrivo/${row.id}`;
      // Riuso endpoint edit esistente: aggiorna la stessa riga Notion, non ne crea nuove.
      const { data } = await axios.patch(`${API}/${path}`, {
        reason: `[+${delta}] ${reason.trim()}`,
        new_quantity: newTotal,
      });
      toast.success("Accessorio dimenticato aggiunto", {
        description: `${productMeta?.name || row.item_name || "Prodotto"} · Quantità: ${currentQty} → ${newTotal}${data?.email_sent ? " · Email inviata" : ""}`,
      });
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
          Somma alla quantità del record esistente ({kind}). Nessuna nuova riga.
        </p>
      </div>
    );
  }

  const currentQty = Number(row?.quantity || 0);
  const preview = currentQty + (Number(addQty) || 0);

  return (
    <div className="mt-2 border-t border-slate-200 pt-3 space-y-3 bg-sky-50/50 -mx-6 px-6 pb-4 rounded-b-md">
      <div className="text-xs uppercase tracking-wider font-bold text-sky-800">➕ Aggiungi Accessorio dimenticato</div>
      <div className="flex items-center justify-between gap-2 border border-slate-200 rounded-md bg-white px-3 py-2">
        <div className="min-w-0">
          <div className="text-sm font-semibold text-slate-900 truncate">{productMeta?.name || row.item_name || "Prodotto corrente"}</div>
          <div className="text-[11px] text-slate-500 font-mono-tight truncate">
            {productMeta?.code || "—"} · A Quantità · Attuale {currentQty}
          </div>
        </div>
      </div>
      <div>
        <Label className="text-xs font-semibold">Quantità da aggiungere *</Label>
        <Input
          type="number"
          min="0.01"
          step="any"
          value={addQty}
          onChange={(e) => setAddQty(e.target.value)}
          className="h-10 mt-1 font-mono-tight"
          data-testid="retro-acc-qty"
          autoFocus
        />
        <p className="text-[11px] text-slate-500 mt-1">
          Anteprima: <b>{currentQty}</b> + <b>{Number(addQty) || 0}</b> = <b className="text-sky-700">{preview}</b>
        </p>
      </div>
      <div>
        <Label className="text-xs font-semibold text-red-700">Motivazione *</Label>
        <Textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2} className="mt-1" data-testid="retro-acc-reason" />
      </div>
      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" onClick={reset} disabled={busy}>Annulla</Button>
        <Button
          type="button"
          onClick={submit}
          disabled={busy || !reason.trim() || !addQty || Number(addQty) <= 0}
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
          ) : "Aggiungi quantità"}
        </Button>
      </div>
    </div>
  );
}
