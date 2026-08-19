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
import { ArrowUUpLeft, MagnifyingGlass, Warning, PencilSimple, Prohibit } from "@phosphor-icons/react";

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;
const todayISO = () => new Date().toISOString().slice(0, 10);

function formatError(err) {
  return err?.response?.data?.detail || err?.message || "Errore";
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

  const search = async () => {
    setLoading(true);
    try {
      const { data } = await axios.post(`${API}/retro/find`, {
        tipo,
        date_from: dateFrom || null,
        date_to: dateTo || null,
        serial: serial.trim() || null,
        structure: structure.trim() || null,
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
            <Input value={serial} onChange={(e) => setSerial(e.target.value)} placeholder="Es. 1426770" className="h-11 mt-1 font-mono-tight" data-testid="retro-serial" />
          </div>
          <div>
            <Label className="text-slate-700 text-sm font-semibold">Struttura / Cliente (opz)</Label>
            <Input value={structure} onChange={(e) => setStructure(e.target.value)} placeholder="Es. Casa Vacanze Palmer" className="h-11 mt-1" data-testid="retro-structure" />
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
                  <th className="py-2 pr-3">{tipo === "spedizione" ? "Cliente" : ""}</th>
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
                    <td className="py-2 pr-3">{r.cliente || "—"}</td>
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
  const [newSn, setNewSn] = useState("");
  const [newQty, setNewQty] = useState("");
  const [newDate, setNewDate] = useState("");
  const [newStructure, setNewStructure] = useState("");
  const [newQr, setNewQr] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!reason.trim()) {
      toast.error("Motivazione obbligatoria");
      return;
    }
    setBusy(true);
    try {
      const body = { reason: reason.trim() };
      if (newSn.trim()) body.new_sn = newSn.trim();
      if (newQty !== "" && !isNaN(parseFloat(newQty))) body.new_quantity = parseFloat(newQty);
      if (newDate) body.new_date = newDate;
      if (kind === "spedizione") {
        if (newStructure.trim()) body.new_structure = newStructure.trim();
        if (newQr.trim()) body.new_qr_code = newQr.trim();
      }
      const path = kind === "spedizione" ? `retro/shipment/${row.id}` : `retro/arrivo/${row.id}`;
      const { data } = await axios.patch(`${API}/${path}`, body);
      toast.success("Modifica retroattiva applicata", {
        description: `Prima: ${JSON.stringify(data.before).slice(0, 60)}…`,
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
          <div className="rounded-md border border-slate-200 bg-slate-50 p-3 text-xs space-y-1">
            <div><b>Data operazione:</b> {row.date || "—"}</div>
            <div><b>Seriale attuale:</b> <span className="font-mono-tight">{row.sn || "—"}</span></div>
            <div><b>Quantità attuale:</b> {row.quantity ?? "—"}</div>
            {kind === "spedizione" && <div><b>Cliente attuale:</b> {row.cliente || "—"}</div>}
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <Label className="text-xs font-semibold">Nuovo seriale (opz)</Label>
              <Input value={newSn} onChange={(e) => setNewSn(e.target.value)} placeholder={row.sn || ""} className="h-10 mt-1 font-mono-tight" data-testid="retro-new-sn" />
            </div>
            <div>
              <Label className="text-xs font-semibold">Nuova quantità (opz)</Label>
              <Input type="number" step="any" value={newQty} onChange={(e) => setNewQty(e.target.value)} placeholder={String(row.quantity ?? "")} className="h-10 mt-1 font-mono-tight" data-testid="retro-new-qty" />
            </div>
            <div>
              <Label className="text-xs font-semibold">Nuova data (opz)</Label>
              <Input type="date" value={newDate} onChange={(e) => setNewDate(e.target.value)} className="h-10 mt-1" data-testid="retro-new-date" />
            </div>
            {kind === "spedizione" && (
              <>
                <div>
                  <Label className="text-xs font-semibold">Nuova struttura (opz)</Label>
                  <Input value={newStructure} onChange={(e) => setNewStructure(e.target.value)} placeholder={row.cliente || ""} className="h-10 mt-1" data-testid="retro-new-structure" />
                </div>
                <div className="sm:col-span-2">
                  <Label className="text-xs font-semibold">Aggiungi/aggiorna QR Code (opz)</Label>
                  <Input value={newQr} onChange={(e) => setNewQr(e.target.value)} placeholder="Es. QR123456" className="h-10 mt-1 font-mono-tight" data-testid="retro-new-qr" />
                </div>
              </>
            )}
          </div>
          <div>
            <Label className="text-xs font-semibold text-red-700">Motivazione (obbligatoria) *</Label>
            <Textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2} placeholder="Es. Correzione seriale inserito erroneamente" className="mt-1" data-testid="retro-reason" />
          </div>
        </div>
        <DialogFooter className="flex-col sm:flex-row gap-2">
          <Button variant="outline" onClick={onClose} disabled={busy}>Chiudi</Button>
          <Button variant="destructive" onClick={cancelOp} disabled={busy} data-testid="retro-cancel-op">
            <Prohibit size={14} weight="bold" className="mr-1" /> Annulla operazione
          </Button>
          <Button onClick={submit} disabled={busy} className="bg-amber-600 hover:bg-amber-700 text-white" data-testid="retro-confirm">
            {busy ? "Applico…" : "Conferma modifica"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
