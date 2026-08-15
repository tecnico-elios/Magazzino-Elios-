import { createContext, useContext, useEffect, useState, useCallback } from "react";
import axios from "axios";

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;
const TOKEN_KEY = "elios_jwt";

const AuthContext = createContext(null);

// Global axios interceptor — attaches Bearer token to every request.
// Runs once at module load.
axios.interceptors.request.use((config) => {
  try {
    const t = localStorage.getItem(TOKEN_KEY);
    if (t) {
      config.headers = config.headers || {};
      if (!config.headers.Authorization) {
        config.headers.Authorization = `Bearer ${t}`;
      }
    }
  } catch {}
  return config;
});

// Global response interceptor — auto-logout on 401 (invalid/expired token)
axios.interceptors.response.use(
  (r) => r,
  (err) => {
    if (err?.response?.status === 401) {
      try {
        localStorage.removeItem(TOKEN_KEY);
      } catch {}
      // Force page reload only if we're not already on /login
      if (!window.location.pathname.startsWith("/login")) {
        window.dispatchEvent(new Event("elios:auth-expired"));
      }
    }
    return Promise.reject(err);
  }
);

export function AuthProvider({ children }) {
  // undefined = loading, null = anonymous, object = authenticated
  const [user, setUser] = useState(undefined);
  const [bootstrap, setBootstrap] = useState(null); // {needs_bootstrap, users_count}

  const readToken = () => {
    try {
      return localStorage.getItem(TOKEN_KEY) || null;
    } catch {
      return null;
    }
  };

  const writeToken = (t) => {
    try {
      if (t) localStorage.setItem(TOKEN_KEY, t);
      else localStorage.removeItem(TOKEN_KEY);
    } catch {}
  };

  const refreshMe = useCallback(async () => {
    const t = readToken();
    if (!t) {
      setUser(null);
      return null;
    }
    try {
      const { data } = await axios.get(`${API}/auth/me`);
      setUser(data);
      return data;
    } catch {
      writeToken(null);
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
    writeToken(data.token);
    setUser(data.user);
    return data.user;
  };

  const bootstrapFirstAdmin = async (payload) => {
    const { data } = await axios.post(`${API}/auth/bootstrap`, payload);
    writeToken(data.token);
    setUser(data.user);
    await refreshBootstrap();
    return data.user;
  };

  const logout = useCallback(() => {
    writeToken(null);
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
