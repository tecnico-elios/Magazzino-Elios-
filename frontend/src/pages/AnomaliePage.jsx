import { useEffect, useMemo, useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { Warning, ArrowsClockwise, MagnifyingGlass, Trash } from "@phosphor-icons/react";
import { Input } from "../components/ui/input";
import { Button } from "../components/ui/button";
import { Badge } from "../components/ui/badge";
import { useAuth } from "../lib/AuthContext";

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

const KIND_LABEL = {
  submit_blocked_serials: "Seriale non valido",
  shipment_shortage: "Giacenza insufficiente",
  arrivo_blocked_serials: "Seriale già presente/uscito",
  tipo_gestione_missing: "Tipo Gestione mancante",
};

export default function AnomaliePage() {
  const { isAdmin } = useAuth();
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [q, setQ] = useState("");

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const { data } = await axios.get(`${API}/anomalie`, { params: { limit: 200 } });
      setItems(data.items || []);
    } catch (e) {
      setError(e?.response?.data?.detail || e?.message || "Errore lettura anomalie");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const deleteOne = async (a) => {
    if (!isAdmin) return;
    if (!window.confirm(`Eliminare l'anomalia "${a.kind}"?`)) return;
    try {
      await axios.delete(`${API}/admin/anomalie/${a.id}`);
      setItems((prev) => prev.filter((x) => x.id !== a.id));
      toast.success("Anomalia eliminata");
    } catch (e) {
      toast.error("Errore", { description: e?.response?.data?.detail || e?.message });
    }
  };

  const clearAll = async () => {
    if (!isAdmin) return;
    if (!window.confirm(`Eliminare TUTTE le ${items.length} anomalie? Azione non reversibile.`)) return;
    try {
      const { data } = await axios.delete(`${API}/admin/anomalie`);
      toast.success(`${data.deleted} anomalie eliminate`);
      setItems([]);
    } catch (e) {
      toast.error("Errore", { description: e?.response?.data?.detail || e?.message });
    }
  };

  const filtered = useMemo(() => {
    const query = q.trim().toLowerCase();
    if (!query) return items;
    return items.filter((it) =>
      (it.kind || "").toLowerCase().includes(query) ||
      (it.description || "").toLowerCase().includes(query) ||
      (it.operator || "").toLowerCase().includes(query) ||
      (it.product || "").toLowerCase().includes(query) ||
      (it.serial_or_code || "").toLowerCase().includes(query)
    );
  }, [items, q]);

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6 sm:py-8 space-y-4" data-testid="anomalie-page">
      <div className="flex items-end justify-between gap-3 flex-wrap">
        <div>
          <div className="flex items-center gap-2 text-amber-600">
            <Warning size={16} weight="bold" />
            <span className="et-eyebrow text-amber-700">Registro eventi</span>
          </div>
          <h1 className="et-page-heading text-3xl sm:text-4xl mt-1">Anomalie</h1>
          <p className="text-slate-500 mt-1 text-sm">
            {items.length} event{items.length === 1 ? "o" : "i"} registrat{items.length === 1 ? "o" : "i"}.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={load} disabled={loading} data-testid="anomalie-refresh">
            <ArrowsClockwise size={16} className={loading ? "animate-spin mr-1" : "mr-1"} />
            Aggiorna
          </Button>
          {isAdmin && items.length > 0 && (
            <Button variant="outline" onClick={clearAll} className="border-red-300 text-red-600 hover:bg-red-50" data-testid="anomalie-clear-all">
              <Trash size={16} className="mr-1" /> Elimina tutte
            </Button>
          )}
        </div>
      </div>

      <div className="relative max-w-md">
        <MagnifyingGlass size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
        <Input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Cerca per tipo, operatore, prodotto, seriale…"
          className="pl-10 h-10"
          data-testid="anomalie-search"
        />
      </div>

      {error && (
        <div className="border border-red-200 bg-red-50 text-red-700 p-4 rounded-md text-sm">
          {error}
        </div>
      )}

      {loading && !items.length ? (
        <div className="text-slate-500 py-12 text-center text-sm">Caricamento anomalie…</div>
      ) : (
        <div className="et-card-elevated overflow-hidden">
          <div className="overflow-x-auto">
            <table className="et-table" data-testid="anomalie-table">
              <thead>
                <tr>
                  <th>Data/Ora</th>
                  <th>Tipo</th>
                  <th>Operatore</th>
                  <th>Prodotto/Seriale</th>
                  <th>Descrizione</th>
                  {isAdmin && <th className="w-10"></th>}
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 ? (
                  <tr><td colSpan={isAdmin ? 6 : 5} className="text-center py-10 text-slate-400 text-sm">Nessuna anomalia registrata.</td></tr>
                ) : filtered.map((a, idx) => (
                  <tr key={a.id || idx} className="hover:bg-slate-50" data-testid={`anom-row-${idx}`}>
                    <td className="px-3 py-2 font-mono-tight text-xs text-slate-600 whitespace-nowrap">
                      {a.created_at ? new Date(a.created_at).toLocaleString("it-IT") : "—"}
                    </td>
                    <td className="px-3 py-2">
                      <Badge variant="outline" className="border-amber-300 text-amber-800 bg-amber-50">
                        {KIND_LABEL[a.kind] || a.kind}
                      </Badge>
                    </td>
                    <td className="px-3 py-2 text-slate-700">{a.operator || "—"}</td>
                    <td className="px-3 py-2 font-mono-tight text-xs text-slate-700">
                      {a.product || "—"}{a.serial_or_code ? ` · ${a.serial_or_code}` : ""}
                    </td>
                    <td className="px-3 py-2 text-slate-600 max-w-md">{a.description}</td>
                    {isAdmin && (
                      <td className="px-2 py-2">
                        <Button variant="outline" size="icon" onClick={() => deleteOne(a)}
                          className="h-8 w-8 border-red-300 text-red-600 hover:bg-red-50"
                          data-testid={`anom-delete-${idx}`}>
                          <Trash size={14} />
                        </Button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
