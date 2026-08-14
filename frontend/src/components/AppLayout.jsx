import { NavLink, Outlet } from "react-router-dom";
import { useState } from "react";
import {
  House,
  Package,
  ArrowSquareIn,
  ArrowSquareOut,
  ArrowsClockwise,
  Warning,
  Gear,
  UserCircle,
  PencilSimple,
} from "@phosphor-icons/react";
import { useInventoryCtx } from "../lib/InventoryContext";
import { useOperator } from "../lib/useOperator";

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
  const { operator, setOperator } = useOperator();
  const [editingOp, setEditingOp] = useState(false);
  const [opInput, setOpInput] = useState(operator);

  const saveOperator = () => {
    setOperator(opInput);
    setEditingOp(false);
  };

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col" data-testid="app-layout">
      <header className="sticky top-0 z-30 bg-white border-b border-slate-200 shadow-sm">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-3 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-10 h-10 rounded-md bg-slate-900 text-white grid place-items-center font-mono-tight font-bold text-sm shrink-0" aria-hidden>
              MG
            </div>
            <div className="min-w-0">
              <div className="text-[10px] tracking-[0.2em] uppercase text-slate-500 font-semibold">Elios Tech</div>
              <div className="text-base sm:text-lg font-bold text-slate-900 leading-tight">Magazzino Elios Tech</div>
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
            <ArrowsClockwise size={14} className={loading ? "animate-spin" : ""} />
            <span className="hidden sm:inline">Aggiorna Notion</span>
          </button>
        </div>
        <div className="max-w-7xl mx-auto px-4 sm:px-6 pb-2 flex items-center gap-2" data-testid="operator-badge-row">
          <UserCircle size={16} className="text-slate-500 shrink-0" />
          {editingOp ? (
            <div className="flex items-center gap-2 flex-1 min-w-0">
              <input
                autoFocus
                value={opInput}
                onChange={(e) => setOpInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") saveOperator(); if (e.key === "Escape") setEditingOp(false); }}
                placeholder="Nome operatore…"
                className="h-8 text-sm px-2 border border-slate-300 rounded flex-1 max-w-xs"
                data-testid="operator-input"
              />
              <button type="button" onClick={saveOperator} className="h-8 text-xs font-semibold px-3 bg-slate-900 text-white rounded" data-testid="operator-save">Salva</button>
              <button type="button" onClick={() => setEditingOp(false)} className="h-8 text-xs text-slate-500 hover:text-slate-900">Annulla</button>
            </div>
          ) : (
            <>
              <span className="text-xs text-slate-600" data-testid="operator-badge">
                Operatore: <span className="font-semibold text-slate-900">{operator || "— nessuno —"}</span>
              </span>
              <button type="button" onClick={() => { setOpInput(operator); setEditingOp(true); }} className="text-slate-400 hover:text-slate-900" data-testid="operator-edit-btn" title="Cambia operatore">
                <PencilSimple size={13} />
              </button>
            </>
          )}
        </div>
        <nav className="max-w-7xl mx-auto px-1 sm:px-4 border-t border-slate-100 flex overflow-x-auto scrollbar-thin" data-testid="main-nav" aria-label="Navigazione principale">
          {NAV.map((n) => (
            <NavLink
              key={n.to}
              to={n.to}
              end={n.end}
              data-testid={n.testid}
              className={({ isActive }) =>
                `flex items-center gap-2 px-3 sm:px-4 h-11 text-sm font-semibold whitespace-nowrap border-b-2 transition-colors ${
                  isActive ? "border-slate-900 text-slate-900" : "border-transparent text-slate-500 hover:text-slate-900"
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
            Ultimo sync Notion: <span className="font-mono-tight">{refreshedAt.toLocaleTimeString("it-IT")}</span>
          </div>
        )}
      </header>
      <main className="flex-1"><Outlet /></main>
    </div>
  );
}
