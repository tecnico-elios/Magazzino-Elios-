import { NavLink, Outlet, useNavigate } from "react-router-dom";
import {
  House,
  Package,
  ArrowSquareIn,
  ArrowSquareOut,
  ArrowsClockwise,
  Warning,
  Gear,
  SignOut,
  UsersThree,
} from "@phosphor-icons/react";
import { useInventoryCtx } from "../lib/InventoryContext";
import { useAuth } from "../lib/AuthContext";

const BASE_NAV = [
  { to: "/", label: "Dashboard", icon: House, end: true, testid: "nav-dashboard" },
  { to: "/inventario", label: "Inventario", icon: Package, testid: "nav-inventario" },
  { to: "/arrivi", label: "Arrivi", icon: ArrowSquareIn, testid: "nav-arrivi" },
  { to: "/spedizioni", label: "Spedizioni", icon: ArrowSquareOut, testid: "nav-spedizioni" },
  { to: "/movimenti", label: "Movimenti", icon: ArrowsClockwise, testid: "nav-movimenti" },
  { to: "/anomalie", label: "Anomalie", icon: Warning, testid: "nav-anomalie" },
];

const ADMIN_NAV = [
  { to: "/admin", label: "Admin", icon: Gear, testid: "nav-admin" },
  { to: "/admin/utenti", label: "Utenti", icon: UsersThree, testid: "nav-admin-users" },
];

export default function AppLayout() {
  const { refreshedAt, refresh, loading } = useInventoryCtx();
  const { user, logout, isAdmin } = useAuth();
  const navigate = useNavigate();

  const nav = isAdmin ? [...BASE_NAV, ...ADMIN_NAV] : BASE_NAV;

  const handleLogout = () => {
    logout();
    navigate("/login", { replace: true });
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
          <div className="flex items-center gap-2 shrink-0">
            {user && (
              <div className="hidden sm:flex items-center gap-2 h-9 px-3 border border-slate-200 rounded-md" data-testid="current-user-badge">
                <div className={`w-2 h-2 rounded-full ${user.role === "admin" ? "bg-amber-500" : "bg-emerald-500"}`}></div>
                <span className="text-sm font-semibold text-slate-800">{user.full_name || user.username}</span>
                <span className="text-[10px] uppercase tracking-wider text-slate-400 font-mono-tight">
                  {user.role}
                </span>
              </div>
            )}
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
            <button
              type="button"
              onClick={handleLogout}
              className="h-9 px-3 border border-slate-200 rounded-md text-sm text-slate-600 hover:text-red-700 hover:border-red-300 flex items-center gap-1 shrink-0"
              data-testid="logout-btn"
              title="Esci"
            >
              <SignOut size={14} />
              <span className="hidden sm:inline">Esci</span>
            </button>
          </div>
        </div>
        <nav className="max-w-7xl mx-auto px-1 sm:px-4 border-t border-slate-100 flex overflow-x-auto scrollbar-thin" data-testid="main-nav" aria-label="Navigazione principale">
          {nav.map((n) => (
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
