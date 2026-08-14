import { useEffect, useMemo, useState } from "react";
import axios from "axios";
import { Warning, ArrowsClockwise, MagnifyingGlass } from "@phosphor-icons/react";
import { Input } from "../components/ui/input";
import { Button } from "../components/ui/button";
import { Badge } from "../components/ui/badge";

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

const KIND_LABEL = {
  submit_blocked_serials: "Seriale non valido",
  shipment_shortage: "Giacenza insufficiente",
  arrivo_blocked_serials: "Seriale già presente/uscito",
};

/**
 * AnomaliePage — F4
 * Registro eventi bloccanti/audit: seriali inesistenti, già spediti, duplicati,
 * giacenza insufficiente, conflitti, errori Notion.
 */
export default function AnomaliePage() {
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
          <div className="flex items-center gap-2 text-amber-700">
            <Warning size={22} weight="bold" />
            <span className="text-[11px] tracking-[0.2em] uppercase font-semibold">Registro eventi</span>
          </div>
          <h1 className="font-display text-3xl sm:text-4xl font-bold text-slate-900 mt-1">Anomalie</h1>
          <p className="text-slate-500 mt-1 text-sm">
            {items.length} evento{items.length === 1 ? "" : "i"} registrati. Log immediato di ogni blocco (seriali, giacenze, conflitti).
          </p>
        </div>
        <Button variant="outline" onClick={load} disabled={loading} data-testid="anomalie-refresh">
          <ArrowsClockwise size={16} className={loading ? "animate-spin mr-1" : "mr-1"} />
          Aggiorna
        </Button>
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
        <div className="bg-white border border-slate-200 rounded-md overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm" data-testid="anomalie-table">
              <thead className="bg-slate-50 border-b border-slate-200">
                <tr>
                  <th className="text-left px-3 py-2 font-semibold text-slate-600 text-xs uppercase">Data/Ora</th>
                  <th className="text-left px-3 py-2 font-semibold text-slate-600 text-xs uppercase">Tipo</th>
                  <th className="text-left px-3 py-2 font-semibold text-slate-600 text-xs uppercase">Operatore</th>
                  <th className="text-left px-3 py-2 font-semibold text-slate-600 text-xs uppercase">Prodotto/Seriale</th>
                  <th className="text-left px-3 py-2 font-semibold text-slate-600 text-xs uppercase">Descrizione</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filtered.length === 0 ? (
                  <tr><td colSpan="5" className="text-center py-10 text-slate-400 text-sm">Nessuna anomalia registrata.</td></tr>
                ) : filtered.map((a, idx) => (
                  <tr key={a.id || idx} className="hover:bg-slate-50" data-testid={`anom-row-${idx}`}>
                    <td className="px-3 py-2 font-mono-tight text-xs text-slate-600 whitespace-nowrap">
                      {a.created_at ? new Date(a.created_at).toLocaleString("it-IT") : "—"}
                    </td>
                    <td className="px-3 py-2">
                      <Badge variant="outline" className="border-amber-300 text-amber-800 bg-amber-50">
                        {KIND_LABEL[a.kind] || a.kind}
                      </Badge>
                      {a.source && (
                        <span className="text-[10px] text-slate-400 ml-2">({a.source})</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-slate-700">{a.operator || "—"}</td>
                    <td className="px-3 py-2 font-mono-tight text-xs text-slate-700">
                      {a.product || "—"}{a.serial_or_code ? ` · ${a.serial_or_code}` : ""}
                    </td>
                    <td className="px-3 py-2 text-slate-600 max-w-md">{a.description}</td>
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
