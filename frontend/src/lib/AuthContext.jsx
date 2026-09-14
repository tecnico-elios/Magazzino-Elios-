import { createContext, useContext, useEffect, useRef, useState, useCallback } from "react";
import axios from "axios";

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;
const TOKEN_KEY = "elios_jwt";
const REMEMBER_KEY = "elios_remember";

const AuthContext = createContext(null);

// Storage strategy — per-device only (localStorage se Rimani collegato, sessionStorage altrimenti)
function readStoredToken() {
  try {
    return sessionStorage.getItem(TOKEN_KEY) || localStorage.getItem(TOKEN_KEY) || null;
  } catch {
    return null;
  }
}
function isRememberSet() {
  try { return localStorage.getItem(REMEMBER_KEY) === "1"; } catch { return false; }
}
function writeStoredToken(token, remember) {
  try {
    sessionStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(TOKEN_KEY);
    if (token) {
      if (remember) {
        localStorage.setItem(TOKEN_KEY, token);
        localStorage.setItem(REMEMBER_KEY, "1");
      } else {
        sessionStorage.setItem(TOKEN_KEY, token);
        localStorage.removeItem(REMEMBER_KEY);
      }
    } else {
      localStorage.removeItem(REMEMBER_KEY);
    }
  } catch {}
}

// Interceptor per Bearer + auto-logout su 401
axios.interceptors.request.use((config) => {
  const t = readStoredToken();
  if (t) {
    config.headers = config.headers || {};
    if (!config.headers.Authorization) {
      config.headers.Authorization = `Bearer ${t}`;
    }
  }
  return config;
});

axios.interceptors.response.use(
  (r) => r,
  (err) => {
    if (err?.response?.status === 401) {
      writeStoredToken(null, false);
      if (!window.location.pathname.startsWith("/login") &&
          !window.location.pathname.startsWith("/reset-password")) {
        window.dispatchEvent(new Event("elios:auth-expired"));
      }
    }
    // 403 password_change_required → redirect a /force-change-password
    if (err?.response?.status === 403) {
      const d = err?.response?.data?.detail;
      const code = (typeof d === "object" && d) ? d.code : null;
      if (code === "password_change_required" &&
          !window.location.pathname.startsWith("/force-change-password") &&
          !window.location.pathname.startsWith("/login")) {
        window.dispatchEvent(new Event("elios:must-change-password"));
      }
    }
    return Promise.reject(err);
  }
);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(undefined);
  const [bootstrap, setBootstrap] = useState(null);
  const idleTimerRef = useRef(null);
  const idleLimitMinRef = useRef(30); // aggiornato dopo il login dalle settings

  const refreshMe = useCallback(async () => {
    const t = readStoredToken();
    if (!t) {
      setUser(null);
      return null;
    }
    try {
      const { data } = await axios.get(`${API}/auth/me`);
      setUser(data);
      return data;
    } catch {
      writeStoredToken(null, false);
      setUser(null);
      return null;
    }
  }, []);

  const refreshBootstrap = useCallback(async () => {
    try {
      const { data } = await axios.get(`${API}/auth/bootstrap-status`);
      setBootstrap(data);
      return data;
    } catch {
      setBootstrap({ needs_bootstrap: false, users_count: 0 });
      return null;
    }
  }, []);

  const applyRefreshedToken = useCallback((token) => {
    if (!token) return;
    writeStoredToken(token, isRememberSet());
  }, []);

  const login = async (username, password, remember = false) => {
    const { data } = await axios.post(`${API}/auth/login`, { username, password, remember_me: !!remember });
    writeStoredToken(data.token, !!remember);
    setUser(data.user);
    return { user: data.user, mustChangePassword: !!data.must_change_password };
  };

  const bootstrapFirstAdmin = async (payload) => {
    const { data } = await axios.post(`${API}/auth/bootstrap`, payload);
    writeStoredToken(data.token, false);
    setUser(data.user);
    await refreshBootstrap();
    return data.user;
  };

  const logout = useCallback(async () => {
    // Best-effort: chiama /auth/logout per rimuovere la sessione lato server
    try { await axios.post(`${API}/auth/logout`); } catch {}
    writeStoredToken(null, false);
    setUser(null);
  }, []);

  // Idle-logout timer — resettato ad ogni activity (mouse/keyboard/touch)
  const resetIdleTimer = useCallback(() => {
    if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
    const mins = Math.max(1, idleLimitMinRef.current || 30);
    idleTimerRef.current = setTimeout(() => {
      logout();
      if (!window.location.pathname.startsWith("/login")) {
        window.location.replace("/login?reason=idle");
      }
    }, mins * 60 * 1000);
  }, [logout]);

  const loadSecuritySettings = useCallback(async () => {
    try {
      const t = readStoredToken();
      if (!t) return;
      const { data } = await axios.get(`${API}/admin/settings`);
      const m = data?.sicurezza?.idle_logout_minutes;
      if (typeof m === "number" && m > 0) {
        idleLimitMinRef.current = m;
        resetIdleTimer();
      }
    } catch {
      // Non-admin (403) o network — ignoriamo, il default 30 resta valido
    }
  }, [resetIdleTimer]);

  useEffect(() => {
    refreshMe();
    refreshBootstrap();
    const onExpired = () => setUser(null);
    const onMustChange = () => {
      if (!window.location.pathname.startsWith("/force-change-password")) {
        window.location.replace("/force-change-password");
      }
    };
    window.addEventListener("elios:auth-expired", onExpired);
    window.addEventListener("elios:must-change-password", onMustChange);
    return () => {
      window.removeEventListener("elios:auth-expired", onExpired);
      window.removeEventListener("elios:must-change-password", onMustChange);
    };
  }, [refreshMe, refreshBootstrap]);

  // Attiva idle timer + listener quando c'è un user autenticato
  useEffect(() => {
    if (!user) {
      if (idleTimerRef.current) {
        clearTimeout(idleTimerRef.current);
        idleTimerRef.current = null;
      }
      return;
    }
    loadSecuritySettings();
    resetIdleTimer();
    const events = ["mousemove", "keydown", "touchstart", "click", "scroll"];
    const handler = () => resetIdleTimer();
    events.forEach((e) => window.addEventListener(e, handler, { passive: true }));
    return () => {
      events.forEach((e) => window.removeEventListener(e, handler));
      if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
    };
  }, [user, resetIdleTimer, loadSecuritySettings]);

  const value = {
    user,
    bootstrap,
    login,
    logout,
    bootstrapFirstAdmin,
    refreshMe,
    refreshBootstrap,
    applyRefreshedToken,
    isAdmin: !!user && user.role === "admin",
    isOperator: !!user && user.role === "operator",
    isResponsabile: !!user && user.role === "responsabile",
    // F30 — Helper permessi granulari (Admin sempre true; Responsabile true se il modulo è nei suoi permissions).
    hasPermission: (module) => {
      if (!user) return false;
      if (user.role === "admin") return true;
      const perms = Array.isArray(user.permissions) ? user.permissions : [];
      return perms.includes(module);
    },
    isAuthenticated: !!user,
    mustChangePassword: !!user?.must_change_password,
    isLoading: user === undefined,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within <AuthProvider>");
  return ctx;
}
