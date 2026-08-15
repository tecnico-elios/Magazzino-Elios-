import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { useState } from "react";
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
  CaretDown,
  Lock,
} from "@phosphor-icons/react";
import { useInventoryCtx } from "../lib/InventoryContext";
import { useAuth } from "../lib/AuthContext";
import ChangeMyPasswordDialog from "./ChangeMyPasswordDialog";
import EliosLogo from "./EliosLogo";

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
  const [menuOpen, setMenuOpen] = useState(false);
  const [pwdOpen, setPwdOpen] = useState(false);

  const nav = isAdmin ? [...BASE_NAV, ...ADMIN_NAV] : BASE_NAV;

  const handleLogout = () => {
    setMenuOpen(false);
    logout();
    navigate("/login", { replace: true });
  };

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col" data-testid="app-layout">
      <header className="et-header-dark sticky top-0 z-30">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-3 flex items-center justify-between gap-3">
          {/* Brand */}
          <div className="flex items-center gap-3 min-w-0">
            <EliosLogo size={30} />
            <div className="min-w-0 hidden sm:block">
              <div className="text-[10px] tracking-[0.22em] uppercase text-amber-300/80 font-semibold">
                Magazzino
              </div>
              <div className="font-display text-sm font-bold text-white/90 leading-tight">
                Portale operativo
              </div>
            </div>
          </div>

          {/* Right actions */}
          <div className="flex items-center gap-2 shrink-0">
            {user && (
              <div className="relative">
                <button
                  type="button"
                  onClick={() => setMenuOpen((v) => !v)}
                  className="hidden sm:flex items-center gap-2 h-9 px-3 rounded-md bg-white/5 border border-white/10 hover:border-amber-300/50 hover:bg-white/8 text-white transition-colors"
                  data-testid="current-user-badge"
                >
                  <div
                    className={`w-2 h-2 rounded-full ${
                      user.role === "admin" ? "bg-amber-400" : "bg-emerald-400"
                    }`}
                  />
                  <span className="text-sm font-semibold">
                    {user.full_name || user.username}
                  </span>
                  <span className="text-[10px] uppercase tracking-wider text-slate-300/70 font-mono-tight">
                    {user.role}
                  </span>
                  <CaretDown size={12} className="text-slate-300" />
                </button>
                {menuOpen && (
                  <div
                    className="absolute right-0 mt-2 w-60 bg-white border border-slate-200 rounded-md shadow-lg z-50 overflow-hidden"
                    data-testid="user-menu"
                    onMouseLeave={() => setMenuOpen(false)}
                  >
                    <div className="px-3 py-2 border-b border-slate-100 bg-slate-50/60">
                      <div className="text-sm font-semibold text-slate-800">
                        {user.full_name || user.username}
                      </div>
                      <div className="text-xs text-slate-500 font-mono-tight">
                        @{user.username}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        setMenuOpen(false);
                        setPwdOpen(true);
                      }}
                      className="w-full text-left px-3 py-2 text-sm text-slate-700 hover:bg-amber-50 flex items-center gap-2"
                      data-testid="menu-change-password"
                    >
                      <Lock size={14} /> Cambia password
                    </button>
                    <button
                      type="button"
                      onClick={handleLogout}
                      className="w-full text-left px-3 py-2 text-sm text-red-600 hover:bg-red-50 flex items-center gap-2 border-t border-slate-100"
                      data-testid="menu-logout"
                    >
                      <SignOut size={14} /> Esci
                    </button>
                  </div>
                )}
              </div>
            )}

            <button
              type="button"
              onClick={refresh}
              disabled={loading}
              className="h-9 px-3 rounded-md bg-white/5 border border-white/10 text-slate-100 hover:border-amber-300/50 hover:text-white flex items-center gap-1 shrink-0 disabled:opacity-60 transition-colors"
              data-testid="topbar-refresh-btn"
              title="Rileggi tutto il magazzino da Notion"
            >
              <ArrowsClockwise size={14} className={loading ? "animate-spin" : ""} />
              <span className="hidden sm:inline text-sm">Aggiorna Notion</span>
            </button>

            <button
              type="button"
              onClick={handleLogout}
              className="sm:hidden h-9 px-3 rounded-md bg-white/5 border border-white/10 text-slate-100 hover:text-red-300 hover:border-red-300/50 flex items-center gap-1 shrink-0"
              data-testid="logout-btn-mobile"
              title="Esci"
            >
              <SignOut size={14} />
            </button>
          </div>
        </div>

        {/* Primary nav (dark) */}
        <nav
          className="max-w-7xl mx-auto px-1 sm:px-4 border-t border-white/8 flex overflow-x-auto scrollbar-thin -mx-1 sm:mx-auto"
          data-testid="main-nav"
          aria-label="Navigazione principale"
          style={{ WebkitOverflowScrolling: "touch" }}
        >
          {nav.map((n) => (
            <NavLink
              key={n.to}
              to={n.to}
              end={n.end}
              data-testid={n.testid}
              className={({ isActive }) =>
                `et-nav-link flex items-center gap-2 px-3 sm:px-4 h-11 text-sm font-semibold whitespace-nowrap border-b-2 ${
                  isActive ? "active" : ""
                }`
              }
            >
              <n.icon size={16} />
              <span>{n.label}</span>
            </NavLink>
          ))}
        </nav>

        {refreshedAt && (
          <div className="max-w-7xl mx-auto px-4 sm:px-6 text-[10px] text-slate-300/60 pb-1">
            Ultimo sync Notion:{" "}
            <span className="font-mono-tight text-amber-300/70">
              {refreshedAt.toLocaleTimeString("it-IT", { timeZone: "Europe/Rome" })}
            </span>
          </div>
        )}
      </header>
      <main className="flex-1">
        <Outlet />
      </main>
      <ChangeMyPasswordDialog open={pwdOpen} onClose={() => setPwdOpen(false)} />
    </div>
  );
}
