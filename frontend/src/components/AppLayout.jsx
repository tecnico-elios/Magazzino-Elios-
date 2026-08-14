import { NavLink, Outlet } from "react-router-dom";
import {
  House,
  Package,
  ArrowSquareIn,
  ArrowSquareOut,
  ArrowsClockwise,
  Warning,
  Gear,
} from "@phosphor-icons/react";
import { useInventoryCtx } from "../lib/InventoryContext";

/**
 * AppLayout — top navigation shared across the 6 operational sections.
 * The Admin page has its own layout and is not nested here.
 */

const NAV = [
  { to: "/", label: "Dashboard", icon: House, end: true, testid: "nav-dashboard" },
  { to: "/inventario", label: "Inventario", icon: Package, testid: "nav-inventario" },
  { to: "/arrivi", label: "Arrivi", icon: ArrowSquareIn, testid: "nav-arrivi" },
  { to: "/spedizioni", label: "Spedizioni", icon: ArrowSquareOut, testid: "nav-spedizioni" },
  { to: "/movimenti", label: "Movimenti", icon: ArrowsClockwise, testid: "nav-movimenti" },
  { to: "/anomalie", label: "Anomalie", icon: Warning, testid: "nav-anomalie" },
  { to: "/admin", label: "Admin", icon: Gear, testid: "nav-admin" },
];

export default function AppLayout() {
  const { refreshedAt, refresh, loading } = useInventoryCtx();

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col" data-testid="app-layout">
      <header className="sticky top-0 z-30 bg-white border-b border-slate-200 shadow-sm">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-3 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <div
              className="w-10 h-10 rounded-md bg-slate-900 text-white grid place-items-center font-mono-tight font-bold text-sm shrink-0"
              aria-hidden
            >
              MG
            </div>
            <div className="min-w-0">
              <div className="text-[10px] tracking-[0.2em] uppercase text-slate-500 font-semibold">
                Elios Tech
              </div>
              <div className="text-base sm:text-lg font-bold text-slate-900 leading-tight">
                Magazzino Elios Tech
              </div>
            </div>
          </div>
          <button
            type="button"
            onClick={refresh}
            disabled={loading}
            className="h-9 px-3 border border-slate-200 rounded-md text-sm text-slate-600 hover:text-slate-900 hover:border-slate-300 flex items-center gap-1 shrink-0 disabled:opacity-60"
            data-testid="topbar-refresh-btn"
            title="Rileggi tutto il magazzino da Notion"
          >
            <ArrowsClockwise
              size={14}
              className={loading ? "animate-spin" : ""}
            />
            <span className="hidden sm:inline">Aggiorna Notion</span>
          </button>
        </div>
        <nav
          className="max-w-7xl mx-auto px-1 sm:px-4 border-t border-slate-100 flex overflow-x-auto scrollbar-thin"
          data-testid="main-nav"
          aria-label="Navigazione principale"
        >
          {NAV.map((n) => (
            <NavLink
              key={n.to}
              to={n.to}
              end={n.end}
              data-testid={n.testid}
              className={({ isActive }) =>
                `flex items-center gap-2 px-3 sm:px-4 h-11 text-sm font-semibold whitespace-nowrap border-b-2 transition-colors ${
                  isActive
                    ? "border-slate-900 text-slate-900"
                    : "border-transparent text-slate-500 hover:text-slate-900"
                }`
              }
            >
              <n.icon size={16} />
              <span>{n.label}</span>
            </NavLink>
          ))}
        </nav>
        {refreshedAt && (
          <div className="max-w-7xl mx-auto px-4 sm:px-6 text-[10px] text-slate-400 pb-1">
            Ultimo sync Notion:{" "}
            <span className="font-mono-tight">
              {refreshedAt.toLocaleTimeString("it-IT")}
            </span>
          </div>
        )}
      </header>
      <main className="flex-1">
        <Outlet />
      </main>
    </div>
  );
}
