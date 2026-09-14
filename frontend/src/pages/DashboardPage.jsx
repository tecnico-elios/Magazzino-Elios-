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
  ArrowUUpLeft,
  ClipboardText,
  Wrench,
  CheckCircle,
  User,
} from "@phosphor-icons/react";
import { fmtTime, useTz } from "../lib/tz";
import { formatDateIT } from "../lib/dateFmt";

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
  // F14 — mostra la card "Operazione Retroattiva" solo se l'utente è autorizzato lato backend
  const [retroAuthorized, setRetroAuthorized] = useState(false);
  // F23 — Feature flag Commesse (gated da Admin → Funzioni)
  const [commesseEnabled, setCommesseEnabled] = useState(false);
  const [commesseKpi, setCommesseKpi] = useState({});
  const [commesseItems, setCommesseItems] = useState([]);
  useEffect(() => {
    axios.get(`${API}/retro/authorized`).then(({ data }) => setRetroAuthorized(!!data?.authorized)).catch(() => setRetroAuthorized(false));
    axios.get(`${API}/features`).then(({ data }) => setCommesseEnabled(!!data?.commesse_enabled)).catch(() => setCommesseEnabled(false));
  }, []);

  const loadCommesse = useCallback(async () => {
    if (!commesseEnabled) return;
    try {
      // Riusa lo stesso endpoint della pagina /commesse (SSOT: nessun secondo conteggio)
      const { data } = await axios.get(`${API}/commesse`, { params: { limit: 200 } });
      setCommesseKpi(data?.kpi || {});
      setCommesseItems(data?.items || []);
    } catch {
      // Se il flag è appena stato spento server-side, resetta silenziosamente
      setCommesseKpi({}); setCommesseItems([]);
    }
  }, [commesseEnabled]);

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const { data } = await axios.get(`${API}/dashboard/kpi`);
      setKpi(data);
      // Usa l'orologio del client — evita drift del clock del container/server.
      setRefreshedAt(new Date());
      setError(null);
    } catch (e) {
      setError(e?.response?.data?.detail || e?.message || "Errore");
    } finally {
      if (!silent) setLoading(false);
    }
    // Ricarica anche commesse in parallelo (silent)
    loadCommesse();
  }, [loadCommesse]);

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

  // F8 — Aggiorna i KPI quando l'utente clicca sul logo (evento globale da AppLayout).
  useEffect(() => {
    const onRefresh = () => load(true);
    window.addEventListener("elios:refresh-dashboard", onRefresh);
    return () => window.removeEventListener("elios:refresh-dashboard", onRefresh);
  }, [load]);

  // F23 — Ricarica commesse quando il flag cambia (attivazione live da Admin)
  useEffect(() => { loadCommesse(); }, [loadCommesse]);
  // F25.b — Polling leggero ogni 10s per aggiornare i KPI Commesse in tempo semi-reale
  useEffect(() => {
    if (!commesseEnabled) return;
    const iv = setInterval(() => loadCommesse(), 10000);
    return () => clearInterval(iv);
  }, [commesseEnabled, loadCommesse]);

  const totalProducts = kpi?.total_products ?? 0;
  const totalUnits = kpi?.total_units ?? 0;
  const arriviToday = kpi?.arrivi_today ?? 0;
  const spedizioniToday = kpi?.spedizioni_today ?? 0;
  const sottoScorta = kpi?.sotto_scorta ?? [];
  const esauriti = kpi?.esauriti ?? [];
  const nonConfigurati = kpi?.non_configurati ?? [];
  const movements = kpi?.recent_movements ?? [];

  // F23 — Commesse: KPI e "Da fare adesso" (top 5 attive per priorità/data)
  const cmDaPreparare = commesseKpi.da_preparare ?? 0;
  const cmInPreparazione = commesseKpi.in_preparazione ?? 0;
  const cmParziale = commesseKpi.parziale ?? 0;
  const cmPronta = commesseKpi.pronta ?? 0;
  const cmAnnullate = commesseKpi.annullata ?? 0;
  // F29 — "Da fare adesso" sostituita da 3 sezioni operative:
  // 🔴 DA FARE (da_preparare + in_preparazione + parziale)
  // 📦 DA SPEDIRE (pronta + parzialmente_spedita)
  // ⚠️ ATTENZIONE (solo criticità - vuota per default)
  const commesseDaFare = (commesseItems || []).filter((c) => ["da_preparare", "in_preparazione", "parziale"].includes(c.stato)).slice(0, 6);
  const commesseDaSpedire = (commesseItems || []).filter((c) => ["pronta", "parzialmente_spedita", "bozza_spedizione"].includes(c.stato)).slice(0, 6);
  const commesseAttive = (commesseItems || []).filter((c) => !["spedita", "annullata"].includes(c.stato));

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

      {/* Big cards — ordine: Arrivi → Commesse → Spedizioni (F24 §2) */}
      <div className={`grid grid-cols-1 md:grid-cols-2 ${commesseEnabled ? "xl:grid-cols-3" : ""} gap-4`}>
        <Link
          to="/arrivi"
          data-testid="dash-arrivi-card"
          className="group relative overflow-hidden rounded-xl p-6 sm:p-8 text-white border border-white/10 bg-gradient-to-br from-slate-900 via-slate-950 to-slate-900 hover:border-emerald-400/50 transition-all shadow-[0_10px_40px_-15px_rgba(2,6,23,0.5)] hover:shadow-[0_20px_60px_-15px_rgba(16,185,129,0.35)]"
        >
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_80%_20%,rgba(16,185,129,0.18),transparent_55%)]" aria-hidden />
          <div className="relative">
            <div className="inline-flex items-center justify-center w-12 h-12 rounded-lg bg-emerald-500/15 border border-emerald-400/30 text-emerald-300">
              <ArrowSquareIn size={26} weight="bold" />
            </div>
            <div className="text-3xl sm:text-4xl font-display font-black mt-5 tracking-tight">ARRIVI</div>
            <div className="text-slate-300/80 text-sm mt-2">Registra prodotti in entrata</div>
            <div className="absolute right-0 bottom-0 text-emerald-300/90 text-xs font-mono-tight">
              {arriviToday} oggi →
            </div>
          </div>
        </Link>
        {commesseEnabled && (
          <Link
            to="/commesse"
            data-testid="dash-commesse-card"
            className="group relative overflow-hidden rounded-xl p-6 sm:p-8 text-white border border-indigo-400/20 bg-gradient-to-br from-slate-900 via-indigo-950 to-slate-900 hover:border-indigo-300/60 transition-all shadow-[0_10px_40px_-15px_rgba(2,6,23,0.5)] hover:shadow-[0_20px_60px_-15px_rgba(99,102,241,0.35)] md:col-span-2 xl:col-span-1"
          >
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_80%_20%,rgba(129,140,248,0.22),transparent_55%)]" aria-hidden />
            <div className="relative flex flex-col h-full">
              <div className="inline-flex items-center justify-center w-12 h-12 rounded-lg bg-indigo-500/15 border border-indigo-400/30 text-indigo-200">
                <ClipboardText size={26} weight="bold" />
              </div>
              <div className="text-3xl sm:text-4xl font-display font-black mt-5 tracking-tight">COMMESSE</div>
              <div className="text-slate-300/80 text-sm mt-2">Gestisci ordini, preparazione e prelievo del materiale</div>
              {/* F27 — 5 KPI reali + pulsante su riga dedicata */}
              <div className="mt-4 grid grid-cols-2 sm:grid-cols-3 gap-x-2 gap-y-1.5 text-[11px] sm:text-xs font-mono-tight">
                <div className="flex items-center gap-1 text-red-300"><span aria-hidden>🔴</span> <span>{cmDaPreparare} da preparare</span></div>
                <div className="flex items-center gap-1 text-yellow-300"><span aria-hidden>🟡</span> <span>{cmInPreparazione} in preparazione</span></div>
                <div className="flex items-center gap-1 text-orange-300"><span aria-hidden>⚠️</span> <span>{cmParziale} parziali</span></div>
                <div className="flex items-center gap-1 text-emerald-300"><span aria-hidden>🟢</span> <span>{cmPronta} pronte</span></div>
                <div className="flex items-center gap-1 text-slate-400"><span aria-hidden>⚪</span> <span>{cmAnnullate} annullate</span></div>
              </div>
              <div className="mt-4 pt-3 border-t border-indigo-400/20 text-indigo-200/90 text-xs font-mono-tight font-semibold">
                Apri Commesse →
              </div>
            </div>
          </Link>
        )}
        <Link
          to="/spedizioni"
          data-testid="dash-spedizioni-card"
          className="group relative overflow-hidden rounded-xl p-6 sm:p-8 text-white border border-white/10 bg-gradient-to-br from-slate-900 via-slate-950 to-slate-900 hover:border-amber-300/60 transition-all shadow-[0_10px_40px_-15px_rgba(2,6,23,0.5)] hover:shadow-[0_20px_60px_-15px_rgba(250,204,21,0.28)]"
        >
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_80%_20%,rgba(250,204,21,0.16),transparent_55%)]" aria-hidden />
          <div className="relative">
            <div className="inline-flex items-center justify-center w-12 h-12 rounded-lg bg-amber-400/15 border border-amber-300/30 text-amber-300">
              <ArrowSquareOut size={26} weight="bold" />
            </div>
            <div className="text-3xl sm:text-4xl font-display font-black mt-5 tracking-tight">SPEDIZIONI</div>
            <div className="text-slate-300/80 text-sm mt-2">Registra prodotti in uscita</div>
            <div className="absolute right-0 bottom-0 text-amber-300/90 text-xs font-mono-tight">
              {spedizioniToday} oggi →
            </div>
          </div>
        </Link>
      </div>

      {/* F23/F27 — KPI Commesse cliccabili (deep-link con ?stato=) — 5 KPI + pulsante dedicato */}
      {commesseEnabled && (
        <div>
          <div className="et-eyebrow mb-2 text-indigo-700">📦 Commesse — panoramica lavorazione</div>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2 sm:gap-3" data-testid="dash-commesse-kpi">
            <CommessaKpi to="/commesse?stato=da_preparare" icon="🔴" label="Da preparare" value={cmDaPreparare} tone="red" testid="cm-kpi-da-preparare" />
            <CommessaKpi to="/commesse?stato=in_preparazione" icon="🟡" label="In preparazione" value={cmInPreparazione} tone="yellow" testid="cm-kpi-in-preparazione" />
            <CommessaKpi to="/commesse?stato=parziale" icon="⚠️" label="Parziali" value={cmParziale} tone="orange" testid="cm-kpi-parziale" />
            <CommessaKpi to="/commesse?stato=pronta" icon="🟢" label="Pronte" value={cmPronta} tone="emerald" testid="cm-kpi-pronta" />
            <CommessaKpi to="/commesse?stato=annullata" icon="⚪" label="Annullate" value={cmAnnullate} tone="slate" testid="cm-kpi-annullate" />
          </div>
          <div className="mt-3">
            <Link
              to="/commesse"
              className="inline-flex items-center gap-2 px-4 py-2 rounded-md bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-semibold shadow-sm transition-colors"
              data-testid="dash-open-commesse-btn"
            >
              Apri Commesse →
            </Link>
          </div>
        </div>
      )}

      {/* F29 — "Da fare adesso" sostituita da 3 sezioni operative distinte */}
      {commesseEnabled && commesseDaFare.length > 0 && (
        <section className="bg-white border border-red-200 rounded-md overflow-hidden shadow-sm" data-testid="dash-da-fare">
          <div className="px-4 py-3 border-b border-red-200 bg-red-50 flex items-center justify-between">
            <div className="flex items-center gap-2 text-red-800 font-bold text-sm">
              🔴 Da fare
              <span className="text-red-500 font-normal text-xs">({commesseAttive.filter((c) => ["da_preparare", "in_preparazione", "parziale"].includes(c.stato)).length} attive)</span>
            </div>
            <Link to="/commesse?stato=in_preparazione" className="text-xs text-red-700 hover:text-red-900 underline">Vedi tutte →</Link>
          </div>
          <ul className="divide-y divide-slate-100">
            {commesseDaFare.map((c) => <DaFareRow key={c.id || c.number} c={c} action="apri" />)}
          </ul>
        </section>
      )}
      {commesseEnabled && commesseDaSpedire.length > 0 && (
        <section className="bg-white border border-indigo-200 rounded-md overflow-hidden shadow-sm" data-testid="dash-da-spedire">
          <div className="px-4 py-3 border-b border-indigo-200 bg-indigo-50 flex items-center justify-between">
            <div className="flex items-center gap-2 text-indigo-800 font-bold text-sm">
              📦 Da spedire
              <span className="text-indigo-500 font-normal text-xs">({commesseDaSpedire.length})</span>
            </div>
            <Link to="/commesse?stato=pronta" className="text-xs text-indigo-700 hover:text-indigo-900 underline">Vedi tutte →</Link>
          </div>
          <ul className="divide-y divide-slate-100">
            {commesseDaSpedire.map((c) => <DaFareRow key={c.id || c.number} c={c} action="spedisci" />)}
          </ul>
        </section>
      )}

      {/* F14 — Card "Operazione Retroattiva" visibile solo agli utenti autorizzati */}
      {retroAuthorized && (
        <Link
          to="/retroattivita"
          data-testid="dash-retro-card"
          className="group relative overflow-hidden rounded-xl p-6 text-white border border-amber-400/20 bg-gradient-to-br from-amber-900/95 via-amber-950 to-slate-900 hover:border-amber-300/70 transition-all shadow-[0_10px_40px_-15px_rgba(2,6,23,0.5)] hover:shadow-[0_20px_60px_-15px_rgba(250,204,21,0.28)] block"
        >
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_90%_10%,rgba(250,204,21,0.22),transparent_60%)]" aria-hidden />
          <div className="relative flex items-center gap-4">
            <div className="inline-flex items-center justify-center w-12 h-12 rounded-lg bg-amber-400/15 border border-amber-300/30 text-amber-300 shrink-0">
              <ArrowUUpLeft size={26} weight="bold" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-xs uppercase tracking-[0.15em] text-amber-300/80 font-semibold">Rettifica controllata</div>
              <div className="text-xl sm:text-2xl font-display font-black mt-1 tracking-tight">↩️ Operazione Retroattiva</div>
              <div className="text-slate-200/80 text-xs sm:text-sm mt-1">
                Correggi Arrivi/Spedizioni ESISTENTI. Modifica seriale · QR · quantità · struttura. Motivazione obbligatoria.
              </div>
            </div>
            <span className="text-amber-300/90 text-xs font-mono-tight hidden sm:inline">apri →</span>
          </div>
        </Link>
      )}

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

// F23 — KPI card commesse, cliccabile con deep-link a /commesse?stato=…
const CM_TONE = {
  red:     { border: "border-red-200 hover:border-red-400", value: "text-red-700", bg: "bg-red-50/40" },
  yellow:  { border: "border-yellow-200 hover:border-yellow-400", value: "text-yellow-700", bg: "bg-yellow-50/40" },
  orange:  { border: "border-orange-200 hover:border-orange-400", value: "text-orange-700", bg: "bg-orange-50/40" },
  emerald: { border: "border-emerald-200 hover:border-emerald-400", value: "text-emerald-700", bg: "bg-emerald-50/40" },
  slate:   { border: "border-slate-200 hover:border-slate-400", value: "text-slate-700", bg: "bg-slate-50/40" },
};

function CommessaKpi({ to, icon, label, value, tone, testid }) {
  const t = CM_TONE[tone] || CM_TONE.red;
  return (
    <Link
      to={to}
      data-testid={testid}
      className={`et-card-elevated p-3 sm:p-4 border ${t.border} ${t.bg} transition-all hover:shadow-md hover:-translate-y-0.5`}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="et-eyebrow text-[10px] sm:text-xs truncate">{label}</div>
        <span className="text-lg sm:text-xl shrink-0" aria-hidden>{icon}</span>
      </div>
      <div className={`text-2xl sm:text-3xl font-black mt-1 sm:mt-2 font-mono-tight ${t.value}`}>{value}</div>
      <div className="text-[10px] text-slate-400 mt-1">Apri lista →</div>
    </Link>
  );
}

// F23 — Riga "Da fare adesso": mostra commessa attiva con avanzamento e link diretto al dettaglio
const PRIO_BADGE = {
  urgente: { txt: "Urgente", cls: "bg-red-100 text-red-800 border-red-200", icon: "🔴" },
  alta:    { txt: "Alta",    cls: "bg-orange-100 text-orange-800 border-orange-200", icon: "🟠" },
  normale: { txt: "Normale", cls: "bg-yellow-50 text-yellow-800 border-yellow-200", icon: "🟡" },
  bassa:   { txt: "Bassa",   cls: "bg-emerald-50 text-emerald-800 border-emerald-200", icon: "🟢" },
};
const STATO_BADGE = {
  da_preparare:    { txt: "Da preparare",    cls: "bg-red-50 text-red-700 border-red-200" },
  in_preparazione: { txt: "In preparazione", cls: "bg-yellow-50 text-yellow-800 border-yellow-200" },
  parziale:        { txt: "Parziale",        cls: "bg-orange-50 text-orange-800 border-orange-200" },
  pronta:          { txt: "Pronta",          cls: "bg-emerald-50 text-emerald-800 border-emerald-200" },
  parzialmente_spedita: { txt: "Parzialmente spedita", cls: "bg-amber-50 text-amber-800 border-amber-200" },
  bozza_spedizione: { txt: "Bozza spedizione", cls: "bg-indigo-50 text-indigo-800 border-indigo-200" },
};

function DaFareRow({ c, action = "apri" }) {
  const righe = c.righe || [];
  const totReq = righe.reduce((s, r) => s + (Number(r.qty_richiesta) || 0), 0);
  const totPrev = righe.reduce((s, r) => s + (Number(r.qty_prelevata) || 0), 0);
  const totSped = righe.reduce((s, r) => s + (Number(r.qty_spedita) || 0), 0);
  const residuo = totReq - totSped;
  const prio = PRIO_BADGE[c.priorita] || PRIO_BADGE.normale;
  const stato = STATO_BADGE[c.stato] || { txt: c.stato, cls: "bg-slate-100 text-slate-700 border-slate-200" };
  return (
    <li className="px-3 sm:px-4 py-3 flex items-center gap-3 flex-wrap sm:flex-nowrap hover:bg-slate-50" data-testid={`da-fare-row-${c.number}`}>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm sm:text-base font-bold text-slate-900 truncate">#{c.number}</span>
          <span className="text-sm text-slate-700 truncate">— {c.cliente}</span>
          <span className={`text-[10px] font-bold uppercase px-2 py-0.5 rounded border ${prio.cls}`}>{prio.icon} {prio.txt}</span>
          <span className={`text-[10px] font-semibold px-2 py-0.5 rounded border ${stato.cls}`}>{stato.txt}</span>
        </div>
        <div className="text-xs text-slate-500 mt-1 flex flex-wrap gap-x-3 gap-y-0.5 font-mono-tight">
          {c.stato === "parzialmente_spedita"
            ? <span>{totSped}/{totReq} spediti · <b className="text-amber-700">{residuo} da spedire</b></span>
            : <span>{totPrev}/{totReq} preparati</span>}
          {c.operatore_carico && <span className="flex items-center gap-1"><User size={12} /> {c.operatore_carico}</span>}
          {c.data_prevista && <span title="Data di spedizione prevista">📅 {formatDateIT(c.data_prevista)}</span>}
        </div>
      </div>
      <Link
        to={`/commesse?open=${encodeURIComponent(c.id || c.number)}`}
        className={`text-xs font-semibold shrink-0 px-3 py-1.5 rounded ${
          action === "spedisci"
            ? "bg-indigo-600 hover:bg-indigo-700 text-white"
            : "text-indigo-700 hover:text-indigo-900 underline"
        }`}
        data-testid={`da-fare-open-${c.number}`}
      >
        {action === "spedisci" ? (c.stato === "parzialmente_spedita" ? "📦 Completa spedizione" : "📦 Crea spedizione") : "Apri commessa →"}
      </Link>
    </li>
  );
}

