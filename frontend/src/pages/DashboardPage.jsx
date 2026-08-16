import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import axios from "axios";
import {
  ArrowSquareIn,
  ArrowSquareOut,
  Package,
  Cube,
  ArrowsClockwise,
  WarningCircle,
  Warning,
  ArrowClockwise,
} from "@phosphor-icons/react";
import { fmtTime, useTz } from "../lib/tz";

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;
const DEFAULT_REFRESH_MS = 60 * 1000; // fallback se le impostazioni non sono caricate

/**
 * DashboardPage — F5
 * Live KPIs read from Notion via /api/dashboard/kpi.
 * Notion is the SSOT — no duplicate data source. Cache TTL 60s server-side.
 */
export default function DashboardPage() {
  useTz();
  const [kpi, setKpi] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [refreshedAt, setRefreshedAt] = useState(null);
  const [warnCfg, setWarnCfg] = useState({ low: true, oos: true });

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const { data } = await axios.get(`${API}/dashboard/kpi`);
      setKpi(data);
      setRefreshedAt(new Date(data.refreshed_at || Date.now()));
      setError(null);
    } catch (e) {
      setError(e?.response?.data?.detail || e?.message || "Errore");
    } finally {
      if (!silent) setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    let intervalId = null;
    (async () => {
      try {
        const { data } = await axios.get(`${API}/settings`);
        const sec = parseInt(data?.dashboard?.autorefresh_seconds ?? 0, 10);
        const ms = sec > 0 ? sec * 1000 : DEFAULT_REFRESH_MS;
        intervalId = setInterval(() => load(true), ms);
        setWarnCfg({
          low: data?.magazzino?.warn_low_stock !== false,
          oos: data?.magazzino?.warn_out_of_stock !== false,
        });
      } catch {
        intervalId = setInterval(() => load(true), DEFAULT_REFRESH_MS);
      }
    })();
    return () => { if (intervalId) clearInterval(intervalId); };
  }, [load]);

  const totalProducts = kpi?.total_products ?? 0;
  const totalUnits = kpi?.total_units ?? 0;
  const arriviToday = kpi?.arrivi_today ?? 0;
  const spedizioniToday = kpi?.spedizioni_today ?? 0;
  const sottoScorta = kpi?.sotto_scorta ?? [];
  const esauriti = kpi?.esauriti ?? [];
  const nonConfigurati = kpi?.non_configurati ?? [];
  const movements = kpi?.recent_movements ?? [];

  return (
    <div
      className="max-w-7xl mx-auto px-4 sm:px-6 py-6 sm:py-8 space-y-6"
      data-testid="dashboard-page"
    >
      <div className="flex items-end justify-between gap-3 flex-wrap">
        <div>
          <div className="et-eyebrow">Panoramica magazzino</div>
          <h1 className="et-page-heading text-3xl sm:text-4xl mt-1">Dashboard</h1>
          <p className="text-slate-500 mt-1 text-sm">
            {loading && !kpi
              ? "Caricamento KPI Notion…"
              : `${totalProducts} prodotti · ${totalUnits} pz totali`}
          </p>
        </div>
        <button
          type="button"
          onClick={() => load(false)}
          disabled={loading}
          className="h-10 px-4 rounded-md text-sm flex items-center gap-2 shrink-0 disabled:opacity-60 et-btn-primary"
          data-testid="dashboard-refresh-btn"
        >
          <ArrowClockwise size={14} className={loading ? "animate-spin" : ""} />
          <span>Aggiorna</span>
        </button>
      </div>

      {/* Big Arrivi / Spedizioni cards — dark navy + semantic amber glow */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Link
          to="/arrivi"
          data-testid="dash-arrivi-card"
          className="group relative overflow-hidden rounded-xl p-8 text-white border border-white/10 bg-gradient-to-br from-slate-900 via-slate-950 to-slate-900 hover:border-emerald-400/50 transition-all shadow-[0_10px_40px_-15px_rgba(2,6,23,0.5)] hover:shadow-[0_20px_60px_-15px_rgba(16,185,129,0.35)]"
        >
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_80%_20%,rgba(16,185,129,0.18),transparent_55%)]" aria-hidden />
          <div className="relative">
            <div className="inline-flex items-center justify-center w-12 h-12 rounded-lg bg-emerald-500/15 border border-emerald-400/30 text-emerald-300">
              <ArrowSquareIn size={26} weight="bold" />
            </div>
            <div className="text-4xl font-display font-black mt-5 tracking-tight">ARRIVI</div>
            <div className="text-slate-300/80 text-sm mt-2">Registra prodotti in entrata</div>
            <div className="absolute right-0 bottom-0 text-emerald-300/90 text-xs font-mono-tight">
              {arriviToday} oggi →
            </div>
          </div>
        </Link>
        <Link
          to="/spedizioni"
          data-testid="dash-spedizioni-card"
          className="group relative overflow-hidden rounded-xl p-8 text-white border border-white/10 bg-gradient-to-br from-slate-900 via-slate-950 to-slate-900 hover:border-amber-300/60 transition-all shadow-[0_10px_40px_-15px_rgba(2,6,23,0.5)] hover:shadow-[0_20px_60px_-15px_rgba(250,204,21,0.28)]"
        >
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_80%_20%,rgba(250,204,21,0.16),transparent_55%)]" aria-hidden />
          <div className="relative">
            <div className="inline-flex items-center justify-center w-12 h-12 rounded-lg bg-amber-400/15 border border-amber-300/30 text-amber-300">
              <ArrowSquareOut size={26} weight="bold" />
            </div>
            <div className="text-4xl font-display font-black mt-5 tracking-tight">SPEDIZIONI</div>
            <div className="text-slate-300/80 text-sm mt-2">Registra prodotti in uscita</div>
            <div className="absolute right-0 bottom-0 text-amber-300/90 text-xs font-mono-tight">
              {spedizioniToday} oggi →
            </div>
          </div>
        </Link>
      </div>

      {error && (
        <div className="border border-red-200 bg-red-50 text-red-700 p-4 rounded-md text-sm">
          Errore lettura Notion: {error}
        </div>
      )}

      {/* KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Kpi icon={Cube} label="Stock totale" value={totalUnits} suffix="pz" testid="kpi-total-units" />
        <Kpi icon={ArrowSquareIn} label="Arrivi oggi" value={arriviToday} testid="kpi-arrivi-today" tone="emerald" />
        <Kpi icon={ArrowSquareOut} label="Spedizioni oggi" value={spedizioniToday} testid="kpi-spedizioni-today" tone="blue" />
        <Kpi
          icon={WarningCircle}
          label={`Sotto scorta (≤${kpi?.low_stock_threshold ?? 2})`}
          value={sottoScorta.length}
          testid="kpi-lowstock"
          tone={sottoScorta.length > 0 ? "amber" : "slate"}
        />
      </div>

      {/* Non configurati */}
      {nonConfigurati.length > 0 && (
        <div
          className="border border-red-200 bg-red-50 rounded-md p-4"
          data-testid="dashboard-non-configurati"
        >
          <div className="flex items-center gap-2 text-red-700 font-semibold text-sm">
            <Warning size={16} weight="fill" />
            {nonConfigurati.length}{" "}
            {nonConfigurati.length === 1
              ? "prodotto senza"
              : "prodotti senza"}{" "}
            <span className="font-bold uppercase tracking-wider text-xs bg-red-100 px-2 py-0.5 rounded">
              Tipo Gestione
            </span>
          </div>
          <div className="mt-2 text-xs text-red-800 space-y-0.5">
            {nonConfigurati.slice(0, 6).map((p) => (
              <div key={p.id} className="font-mono-tight">
                • {p.name}
                {p.code && <span className="text-red-600/70"> ({p.code})</span>}
              </div>
            ))}
            {nonConfigurati.length > 6 && (
              <div className="italic text-red-600/70">
                …e altri {nonConfigurati.length - 6}
              </div>
            )}
          </div>
          <Link
            to="/admin"
            className="mt-3 inline-block text-xs font-semibold text-red-700 underline hover:text-red-900"
            data-testid="dashboard-non-configurati-admin-link"
          >
            Configura in Admin → Gestione Prodotti →
          </Link>
        </div>
      )}

      {/* Sotto scorta + Esauriti — gated da Admin → Impostazioni → Magazzino */}
      {(warnCfg.low || warnCfg.oos) && (
        <div className={`grid grid-cols-1 gap-4 ${warnCfg.low && warnCfg.oos ? "lg:grid-cols-2" : ""}`}>
          {warnCfg.low && <SottoScortaCard items={sottoScorta} />}
          {warnCfg.oos && <EsauritiCard items={esauriti} />}
        </div>
      )}

      {/* Ultimi movimenti */}
      <section
        className="bg-white border border-slate-200 rounded-md overflow-hidden"
        data-testid="dashboard-recent-movements"
      >
        <div className="px-4 py-3 border-b border-slate-200 flex items-center justify-between">
          <div className="flex items-center gap-2 text-slate-900 font-semibold text-sm">
            <ArrowsClockwise size={16} />
            Ultimi 10 movimenti Notion
          </div>
          <Link
            to="/movimenti"
            className="text-xs text-slate-500 hover:text-slate-900 underline"
          >
            Vedi tutti →
          </Link>
        </div>
        {movements.length === 0 ? (
          <div className="px-4 py-8 text-center text-slate-400 text-sm">
            Nessun movimento recente su Notion.
          </div>
        ) : (
          <ul className="divide-y divide-slate-100" data-testid="movements-list">
            {movements.map((m, idx) => (
              <li
                key={`${m.type}-${idx}-${m.date}`}
                className="px-4 py-3 flex items-center justify-between gap-3"
                data-testid={`movement-row-${idx}`}
              >
                <div className="flex items-center gap-3 min-w-0 flex-1">
                  <span
                    className={`inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider px-2 py-1 rounded ${
                      m.type === "arrivo"
                        ? "bg-emerald-50 text-emerald-700"
                        : "bg-blue-50 text-blue-700"
                    }`}
                  >
                    {m.type === "arrivo" ? "📥 Arrivo" : "📤 Spedizione"}
                  </span>
                  <div className="min-w-0">
                    <div className="text-sm font-semibold text-slate-900 truncate">
                      {m.product || "—"}
                    </div>
                    <div className="text-xs text-slate-500 font-mono-tight truncate">
                      {m.date || "—"}
                      {m.serial_or_code && ` · ${m.serial_or_code}`}
                      {m.cliente && ` · ${m.cliente}`}
                    </div>
                  </div>
                </div>
                <div className="font-mono-tight font-semibold text-slate-700 shrink-0">
                  × {m.quantity ?? "?"} {m.unit || ""}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {refreshedAt && (
        <div className="text-[10px] text-slate-400 text-center">
          Ultimo aggiornamento KPI:{" "}
          <span className="font-mono-tight">
              {fmtTime(refreshedAt)}
          </span>{" "}
          — auto-refresh silenzioso ogni 60s
        </div>
      )}
    </div>
  );
}

function Kpi({ icon: Icon, label, value, suffix, testid, tone = "slate" }) {
  const toneClass =
    tone === "emerald"
      ? "text-emerald-700"
      : tone === "blue"
      ? "text-blue-700"
      : tone === "amber"
      ? "text-amber-700"
      : "text-slate-900";
  return (
    <div
      className="et-card-elevated p-4"
      data-testid={testid}
    >
      <div className="flex items-center justify-between">
        <div className="et-eyebrow">
          {label}
        </div>
        <Icon size={16} className="text-slate-400" />
      </div>
      <div className={`text-2xl font-bold mt-2 font-mono-tight ${toneClass}`}>
        {value}
        {suffix && (
          <span className="text-slate-400 text-sm font-normal ml-1">
            {suffix}
          </span>
        )}
      </div>
    </div>
  );
}

function SottoScortaCard({ items }) {
  return (
    <section
      className="bg-white border border-slate-200 rounded-md overflow-hidden"
      data-testid="dashboard-lowstock-card"
    >
      <div className="px-4 py-3 border-b border-slate-200 flex items-center justify-between">
        <div className="flex items-center gap-2 text-amber-700 font-semibold text-sm">
          <WarningCircle size={16} weight="fill" />
          Sotto scorta
        </div>
        <span className="text-xs text-slate-400 font-mono-tight">
          {items.length}
        </span>
      </div>
      {items.length === 0 ? (
        <div className="px-4 py-6 text-center text-slate-400 text-sm">
          Nessun prodotto sotto scorta.
        </div>
      ) : (
        <ul className="divide-y divide-slate-100">
          {items.slice(0, 6).map((it) => (
            <li
              key={it.id}
              className="px-4 py-2 flex items-center justify-between gap-3"
              data-testid={`lowstock-row-${it.id}`}
            >
              <div className="min-w-0 flex-1">
                <div className="text-sm font-semibold text-slate-900 truncate">
                  {it.name}
                </div>
                {it.code && (
                  <div className="text-xs text-slate-400 font-mono-tight truncate">
                    {it.code}
                  </div>
                )}
              </div>
              <div className="text-sm font-mono-tight font-bold text-amber-700 shrink-0">
                {it.quantity} {it.unit}
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function EsauritiCard({ items }) {
  return (
    <section
      className="bg-white border border-slate-200 rounded-md overflow-hidden"
      data-testid="dashboard-esauriti-card"
    >
      <div className="px-4 py-3 border-b border-slate-200 flex items-center justify-between">
        <div className="flex items-center gap-2 text-red-700 font-semibold text-sm">
          <Package size={16} weight="fill" />
          Esauriti
        </div>
        <span className="text-xs text-slate-400 font-mono-tight">
          {items.length}
        </span>
      </div>
      {items.length === 0 ? (
        <div className="px-4 py-6 text-center text-slate-400 text-sm">
          Nessun prodotto esaurito.
        </div>
      ) : (
        <ul className="divide-y divide-slate-100">
          {items.slice(0, 6).map((it) => (
            <li
              key={it.id}
              className="px-4 py-2 flex items-center justify-between gap-3"
              data-testid={`esaurito-row-${it.id}`}
            >
              <div className="min-w-0 flex-1">
                <div className="text-sm font-semibold text-slate-900 truncate">
                  {it.name}
                </div>
                {it.code && (
                  <div className="text-xs text-slate-400 font-mono-tight truncate">
                    {it.code}
                  </div>
                )}
              </div>
              <div className="text-sm font-mono-tight font-bold text-red-600 shrink-0">
                0 {it.unit}
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
