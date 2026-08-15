import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import axios from "axios";
import {
  ArrowSquareIn,
  ArrowSquareOut,
  ArrowsClockwise,
  MagnifyingGlass,
  Barcode,
  CaretLeft,
  CaretRight,
  CalendarBlank,
} from "@phosphor-icons/react";
import { Input } from "../components/ui/input";
import { Button } from "../components/ui/button";
import { Badge } from "../components/ui/badge";

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;
const CACHE_TTL_MS = 60 * 1000; // 60s — refresh forced by button

const MONTH_NAMES_IT = [
  "Gennaio", "Febbraio", "Marzo", "Aprile", "Maggio", "Giugno",
  "Luglio", "Agosto", "Settembre", "Ottobre", "Novembre", "Dicembre",
];

const currentMonthKey = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
};

const parseKey = (key) => {
  const [y, m] = key.split("-").map((n) => parseInt(n, 10));
  return { year: y, month: m };
};

const formatMonthLabel = (key) => {
  const { year, month } = parseKey(key);
  return `${MONTH_NAMES_IT[month - 1]} ${year}`;
};

const shiftMonth = (key, delta) => {
  const { year, month } = parseKey(key);
  const total = year * 12 + (month - 1) + delta;
  const y = Math.floor(total / 12);
  const m = (total % 12) + 1;
  return `${y}-${String(m).padStart(2, "0")}`;
};

/**
 * MovimentiPage — F6 (ottimizzazione)
 * Carica UN mese alla volta da Notion (filtro server-side via /api/movimenti?month=YYYY-MM).
 * Cache per-mese in memoria (TTL 60s). Il tasto Aggiorna forza un refetch live del mese
 * selezionato. Notion resta SSOT — MongoDB non è utilizzato.
 */
export default function MovimentiPage() {
  const [monthKey, setMonthKey] = useState(currentMonthKey());
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [q, setQ] = useState("");
  const [typeFilter, setTypeFilter] = useState("all");
  const cacheRef = useRef(new Map()); // key: 'YYYY-MM' -> { items, at }

  const load = useCallback(
    async (key, { force = false } = {}) => {
      const cached = cacheRef.current.get(key);
      if (!force && cached && Date.now() - cached.at < CACHE_TTL_MS) {
        setItems(cached.items);
        setError(null);
        setLoading(false);
        return;
      }
      setLoading(true);
      setError(null);
      try {
        const { data } = await axios.get(`${API}/movimenti`, {
          params: { month: key, limit: 500 },
        });
        const rows = data.items || [];
        cacheRef.current.set(key, { items: rows, at: Date.now() });
        setItems(rows);
      } catch (e) {
        setError(
          e?.response?.data?.detail || e?.message || "Errore lettura movimenti"
        );
      } finally {
        setLoading(false);
      }
    },
    []
  );

  useEffect(() => {
    load(monthKey);
  }, [monthKey, load]);

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

  const isCurrentMonth = monthKey === currentMonthKey();

  return (
    <div
      className="max-w-7xl mx-auto px-4 sm:px-6 py-6 sm:py-8 space-y-4"
      data-testid="movimenti-page"
    >
      <div className="flex items-end justify-between gap-3 flex-wrap">
        <div>
          <div className="et-eyebrow">Cronologia · Notion</div>
          <h1 className="et-page-heading text-3xl sm:text-4xl mt-1">
            Movimenti
          </h1>
          <p className="text-slate-500 mt-1 text-sm">
            Arrivi + Spedizioni del mese selezionato — live da Notion, {items.length} movimenti.
          </p>
        </div>
        <button
          type="button"
          onClick={() => load(monthKey, { force: true })}
          disabled={loading}
          className="h-10 px-4 rounded-md text-sm flex items-center gap-2 et-btn-primary disabled:opacity-60"
          data-testid="movimenti-refresh"
        >
          <ArrowsClockwise size={16} className={loading ? "animate-spin" : ""} />
          Aggiorna
        </button>
      </div>

      {/* Month selector */}
      <div className="flex items-center gap-2 flex-wrap">
        <button
          type="button"
          onClick={() => setMonthKey((k) => shiftMonth(k, -1))}
          className="h-10 w-10 inline-flex items-center justify-center border border-slate-200 rounded-md bg-white text-slate-600 hover:text-slate-900 hover:border-slate-300"
          data-testid="month-prev"
          aria-label="Mese precedente"
        >
          <CaretLeft size={16} weight="bold" />
        </button>
        <label
          className="h-10 inline-flex items-center gap-2 px-3 border border-slate-200 rounded-md bg-white cursor-pointer"
          data-testid="month-picker-wrapper"
        >
          <CalendarBlank size={16} className="text-slate-500" />
          <span
            className="text-sm font-semibold text-slate-900 min-w-[140px]"
            data-testid="month-label"
          >
            {formatMonthLabel(monthKey)}
          </span>
          <input
            type="month"
            value={monthKey}
            onChange={(e) => setMonthKey(e.target.value || currentMonthKey())}
            className="absolute opacity-0 w-0 h-0 p-0 m-0"
            data-testid="month-picker"
          />
        </label>
        <button
          type="button"
          onClick={() => setMonthKey((k) => shiftMonth(k, 1))}
          disabled={isCurrentMonth}
          className="h-10 w-10 inline-flex items-center justify-center border border-slate-200 rounded-md bg-white text-slate-600 hover:text-slate-900 hover:border-slate-300 disabled:opacity-40 disabled:cursor-not-allowed"
          data-testid="month-next"
          aria-label="Mese successivo"
        >
          <CaretRight size={16} weight="bold" />
        </button>
        {!isCurrentMonth && (
          <button
            type="button"
            onClick={() => setMonthKey(currentMonthKey())}
            className="h-10 px-3 text-sm text-slate-600 hover:text-slate-900 underline"
            data-testid="month-current"
          >
            Torna a {formatMonthLabel(currentMonthKey())}
          </button>
        )}
      </div>

      <div className="flex gap-2 flex-wrap items-center">
        <div className="relative flex-1 min-w-[200px] max-w-md">
          <MagnifyingGlass
            size={18}
            className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none"
          />
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
              className={`h-8 px-3 text-sm rounded font-medium transition-colors ${
                typeFilter === f.id
                  ? "bg-slate-900 text-white shadow-sm"
                  : "text-slate-600 hover:bg-amber-50 hover:text-slate-900"
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
        <div className="text-slate-500 py-12 text-center text-sm">
          Caricamento movimenti di {formatMonthLabel(monthKey)}…
        </div>
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
                  <th className="text-left px-3 py-2 font-semibold text-slate-600 text-xs uppercase hidden md:table-cell">Operatore</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filtered.length === 0 ? (
                  <tr>
                    <td colSpan="7" className="text-center py-10 text-slate-400 text-sm">
                      Nessun movimento in {formatMonthLabel(monthKey)}.
                    </td>
                  </tr>
                ) : (
                  filtered.map((m, idx) => (
                    <tr
                      key={m.id || idx}
                      className="hover:bg-slate-50"
                      data-testid={`mov-row-${idx}`}
                    >
                      <td className="px-3 py-2 font-mono-tight text-xs text-slate-600 whitespace-nowrap">
                        {m.date || "—"}
                      </td>
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
                        {m.quantity ?? "—"}{" "}
                        <span className="text-slate-400 text-xs font-normal">{m.unit}</span>
                      </td>
                      <td className="px-3 py-2 font-mono-tight text-xs text-slate-700">
                        {m.serial_or_code ? (
                          <span className="inline-flex items-center gap-1">
                            <Barcode size={12} className="text-slate-400" />
                            {m.serial_or_code}
                          </span>
                        ) : (
                          "—"
                        )}
                      </td>
                      <td className="px-3 py-2 text-slate-600 hidden md:table-cell">
                        {m.cliente || "—"}
                      </td>
                      <td className="px-3 py-2 text-slate-600 hidden md:table-cell">
                        {m.taken_by || "—"}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="text-xs text-slate-400 text-center pt-2">
        Notion è l'unica fonte di verità. Il mese viene filtrato server-side su Notion — nessun scaricamento dello storico completo.
      </div>
    </div>
  );
}
