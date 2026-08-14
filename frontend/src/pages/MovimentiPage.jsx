import { useEffect, useMemo, useState } from "react";
import axios from "axios";
import { ArrowSquareIn, ArrowSquareOut, ArrowsClockwise, MagnifyingGlass, Barcode } from "@phosphor-icons/react";
import { Input } from "../components/ui/input";
import { Button } from "../components/ui/button";
import { Badge } from "../components/ui/badge";

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

/**
 * MovimentiPage — F4
 * Vista unificata dei movimenti letta LIVE da Notion (Consegne/Entrate + Spedizioni/Uscite).
 * MongoDB NON è utilizzato come fonte per la lista.
 */
export default function MovimentiPage() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [q, setQ] = useState("");
  const [typeFilter, setTypeFilter] = useState("all");

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const { data } = await axios.get(`${API}/movimenti`, { params: { limit: 200 } });
      setItems(data.items || []);
    } catch (e) {
      setError(e?.response?.data?.detail || e?.message || "Errore lettura movimenti");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const filtered = useMemo(() => {
    const query = q.trim().toLowerCase();
    return items.filter((it) => {
      if (typeFilter !== "all" && it.type !== typeFilter) return false;
      if (!query) return true;
      return (
        (it.product || "").toLowerCase().includes(query) ||
        (it.serial_or_code || "").toLowerCase().includes(query) ||
        (it.cliente || "").toLowerCase().includes(query) ||
        (it.taken_by || "").toLowerCase().includes(query)
      );
    });
  }, [items, q, typeFilter]);

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6 sm:py-8 space-y-4" data-testid="movimenti-page">
      <div className="flex items-end justify-between gap-3 flex-wrap">
        <div>
          <h1 className="font-display text-3xl sm:text-4xl font-bold text-slate-900">Movimenti</h1>
          <p className="text-slate-500 mt-1 text-sm">
            Timeline unificata Arrivi + Spedizioni letta LIVE da Notion — {items.length} movimenti.
          </p>
        </div>
        <Button variant="outline" onClick={load} disabled={loading} data-testid="movimenti-refresh">
          <ArrowsClockwise size={16} className={loading ? "animate-spin mr-1" : "mr-1"} />
          Aggiorna
        </Button>
      </div>

      <div className="flex gap-2 flex-wrap items-center">
        <div className="relative flex-1 min-w-[200px] max-w-md">
          <MagnifyingGlass size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Cerca per prodotto, seriale, cliente…"
            className="pl-10 h-10"
            data-testid="movimenti-search"
          />
        </div>
        <div className="flex gap-1 bg-white border border-slate-200 rounded-md p-1">
          {[
            { id: "all", label: "Tutti", testid: "filter-all" },
            { id: "arrivo", label: "📥 Arrivi", testid: "filter-arrivi" },
            { id: "spedizione", label: "📤 Spedizioni", testid: "filter-spedizioni" },
          ].map((f) => (
            <button
              key={f.id}
              type="button"
              onClick={() => setTypeFilter(f.id)}
              className={`h-8 px-3 text-sm rounded font-medium ${
                typeFilter === f.id ? "bg-slate-900 text-white" : "text-slate-600 hover:bg-slate-100"
              }`}
              data-testid={f.testid}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {error && (
        <div className="border border-red-200 bg-red-50 text-red-700 p-4 rounded-md text-sm">
          {error}
        </div>
      )}

      {loading && !items.length ? (
        <div className="text-slate-500 py-12 text-center text-sm">Caricamento movimenti live da Notion…</div>
      ) : (
        <div className="bg-white border border-slate-200 rounded-md overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm" data-testid="movimenti-table">
              <thead className="bg-slate-50 border-b border-slate-200">
                <tr>
                  <th className="text-left px-3 py-2 font-semibold text-slate-600 text-xs uppercase">Data</th>
                  <th className="text-left px-3 py-2 font-semibold text-slate-600 text-xs uppercase">Tipo</th>
                  <th className="text-left px-3 py-2 font-semibold text-slate-600 text-xs uppercase">Prodotto</th>
                  <th className="text-right px-3 py-2 font-semibold text-slate-600 text-xs uppercase">Q.tà</th>
                  <th className="text-left px-3 py-2 font-semibold text-slate-600 text-xs uppercase">Seriale / Codice</th>
                  <th className="text-left px-3 py-2 font-semibold text-slate-600 text-xs uppercase hidden md:table-cell">Cliente</th>
                  <th className="text-left px-3 py-2 font-semibold text-slate-600 text-xs uppercase hidden md:table-cell">Preso da</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filtered.length === 0 ? (
                  <tr><td colSpan="7" className="text-center py-10 text-slate-400 text-sm">Nessun movimento trovato.</td></tr>
                ) : filtered.map((m, idx) => (
                  <tr key={m.id || idx} className="hover:bg-slate-50" data-testid={`mov-row-${idx}`}>
                    <td className="px-3 py-2 font-mono-tight text-xs text-slate-600 whitespace-nowrap">{m.date || "—"}</td>
                    <td className="px-3 py-2">
                      {m.type === "arrivo" ? (
                        <Badge className="bg-emerald-600 hover:bg-emerald-700">
                          <ArrowSquareIn size={12} weight="bold" className="mr-1" /> Arrivo
                        </Badge>
                      ) : (
                        <Badge className="bg-blue-600 hover:bg-blue-700">
                          <ArrowSquareOut size={12} weight="bold" className="mr-1" /> Uscita
                        </Badge>
                      )}
                    </td>
                    <td className="px-3 py-2 font-medium text-slate-900">{m.product || "—"}</td>
                    <td className="px-3 py-2 text-right font-mono-tight font-semibold text-slate-900">
                      {m.quantity ?? "—"} <span className="text-slate-400 text-xs font-normal">{m.unit}</span>
                    </td>
                    <td className="px-3 py-2 font-mono-tight text-xs text-slate-700">
                      {m.serial_or_code ? (
                        <span className="inline-flex items-center gap-1"><Barcode size={12} className="text-slate-400" />{m.serial_or_code}</span>
                      ) : "—"}
                    </td>
                    <td className="px-3 py-2 text-slate-600 hidden md:table-cell">{m.cliente || "—"}</td>
                    <td className="px-3 py-2 text-slate-600 hidden md:table-cell">{m.taken_by || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="text-xs text-slate-400 text-center pt-2">
        Notion è l'unica fonte di verità. Filtri e ricerca operano sul risultato live.
      </div>
    </div>
  );
}
