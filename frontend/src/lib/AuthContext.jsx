import { createContext, useContext, useEffect, useState, useCallback } from "react";
import axios from "axios";

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;
const TOKEN_KEY = "elios_jwt";
const REMEMBER_KEY = "elios_remember";

const AuthContext = createContext(null);

// Storage strategy — per-device only:
//  - "Rimani collegato" ON  → localStorage (persiste anche dopo chiusura browser)
//  - "Rimani collegato" OFF → sessionStorage (muore alla chiusura del tab/browser)
// Nessun cookie viene mai settato — i cookie possono essere sincronizzati
// tra dispositivi via Chrome Sync o iCloud Keychain, mentre localStorage e
// sessionStorage sono strettamente per-browser/per-device.
function readStoredToken() {
  try {
    return sessionStorage.getItem(TOKEN_KEY) || localStorage.getItem(TOKEN_KEY) || null;
  } catch {
    return null;
  }
}

function writeStoredToken(token, remember) {
  try {
    // Sempre pulisci entrambi prima di scrivere
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

// Global axios interceptor — attaches Bearer token to every request.
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

// Global response interceptor — auto-logout on 401 (invalid/expired token)
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
    return Promise.reject(err);
  }
);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(undefined);
  const [bootstrap, setBootstrap] = useState(null);

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

  const login = async (username, password, remember = false) => {
    const { data } = await axios.post(`${API}/auth/login`, { username, password, remember_me: !!remember });
    writeStoredToken(data.token, !!remember);
    setUser(data.user);
    return data.user;
  };

  const bootstrapFirstAdmin = async (payload) => {
    const { data } = await axios.post(`${API}/auth/bootstrap`, payload);
    // Bootstrap = primo login → default a sessionStorage (session-scoped) per
    // il device che ha creato l'admin. L'utente può poi loggarsi con "Rimani
    // collegato" se vuole persistenza cross-restart.
    writeStoredToken(data.token, false);
    setUser(data.user);
    await refreshBootstrap();
    return data.user;
  };

  const logout = useCallback(() => {
    writeStoredToken(null, false);
    setUser(null);
  }, []);

  useEffect(() => {
    refreshMe();
    refreshBootstrap();
    const onExpired = () => setUser(null);
    window.addEventListener("elios:auth-expired", onExpired);
    return () => window.removeEventListener("elios:auth-expired", onExpired);
  }, [refreshMe, refreshBootstrap]);

  const value = {
    user,
    bootstrap,
    login,
    logout,
    bootstrapFirstAdmin,
    refreshMe,
    refreshBootstrap,
    isAdmin: !!user && user.role === "admin",
    isOperator: !!user && user.role === "operator",
    isAuthenticated: !!user,
    isLoading: user === undefined,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within <AuthProvider>");
  return ctx;
}
