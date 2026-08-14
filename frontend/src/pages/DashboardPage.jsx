import { Link } from "react-router-dom";
import {
  ArrowSquareIn,
  ArrowSquareOut,
  Package,
  Cube,
  Tag,
  WarningCircle,
} from "@phosphor-icons/react";
import { useInventoryCtx } from "../lib/InventoryContext";

/**
 * DashboardPage — landing screen with the two biggest operational actions:
 * ARRIVI (green) and SPEDIZIONI (blue), plus a compact KPI strip from the
 * cached Notion inventory. Detailed movement KPIs land with F5.
 */
export default function DashboardPage() {
  const { items, loading, error } = useInventoryCtx();

  const totalItems = items.length;
  const totalUnits = items.reduce(
    (a, it) => a + (Number(it.quantity) || 0),
    0
  );
  const serializedCount = items.filter((i) => i.serialized).length;
  const outOfStock = items.filter(
    (i) => (Number(i.quantity) || 0) <= 0
  ).length;

  return (
    <div
      className="max-w-7xl mx-auto px-4 sm:px-6 py-6 sm:py-8 space-y-6"
      data-testid="dashboard-page"
    >
      <div>
        <h1 className="font-display text-3xl sm:text-4xl font-bold text-slate-900">
          Dashboard
        </h1>
        <p className="text-slate-500 mt-1 text-sm">
          {loading && !items.length
            ? "Caricamento magazzino Notion…"
            : `Panoramica magazzino — ${totalItems} prodotti · ${totalUnits} pz totali`}
        </p>
      </div>

      {/* Big Arrivi / Spedizioni cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Link
          to="/arrivi"
          data-testid="dash-arrivi-card"
          className="group relative overflow-hidden rounded-lg p-8 text-white bg-gradient-to-br from-emerald-500 to-emerald-700 hover:shadow-xl transition-shadow"
        >
          <ArrowSquareIn size={44} weight="bold" />
          <div className="text-4xl font-black mt-4 tracking-tight">ARRIVI</div>
          <div className="text-emerald-50 text-sm mt-2 opacity-95">
            Registra prodotti in entrata
          </div>
          <div className="absolute right-4 bottom-4 text-emerald-100/70 text-xs">
            F2 →
          </div>
        </Link>
        <Link
          to="/spedizioni"
          data-testid="dash-spedizioni-card"
          className="group relative overflow-hidden rounded-lg p-8 text-white bg-gradient-to-br from-blue-600 to-blue-800 hover:shadow-xl transition-shadow"
        >
          <ArrowSquareOut size={44} weight="bold" />
          <div className="text-4xl font-black mt-4 tracking-tight">
            SPEDIZIONI
          </div>
          <div className="text-blue-50 text-sm mt-2 opacity-95">
            Registra prodotti in uscita
          </div>
          <div className="absolute right-4 bottom-4 text-blue-100/70 text-xs">
            Attivo →
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
        <Kpi
          icon={Tag}
          label="Prodotti"
          value={totalItems}
          testid="kpi-products"
        />
        <Kpi
          icon={Cube}
          label="Pezzi totali"
          value={totalUnits}
          testid="kpi-units"
        />
        <Kpi
          icon={Package}
          label="Serializzati"
          value={serializedCount}
          testid="kpi-serialized"
        />
        <Kpi
          icon={WarningCircle}
          label="Esauriti"
          value={outOfStock}
          testid="kpi-outofstock"
          danger={outOfStock > 0}
        />
      </div>

      <div className="text-xs text-slate-400 text-center pt-2">
        Movimenti giornalieri, sotto scorta e ultimi movimenti dettagliati
        arriveranno con la fase F5.
      </div>
    </div>
  );
}

function Kpi({ icon: Icon, label, value, testid, danger }) {
  return (
    <div
      className="bg-white border border-slate-200 rounded-md p-4"
      data-testid={testid}
    >
      <div className="flex items-center justify-between">
        <div className="text-[11px] uppercase tracking-wider text-slate-500 font-semibold">
          {label}
        </div>
        <Icon size={16} className="text-slate-400" />
      </div>
      <div
        className={`text-2xl font-bold mt-1 font-mono-tight ${
          danger ? "text-red-600" : "text-slate-900"
        }`}
      >
        {value}
      </div>
    </div>
  );
}
