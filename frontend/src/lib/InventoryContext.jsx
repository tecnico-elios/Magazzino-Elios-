import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import axios from "axios";

/**
 * InventoryContext — single shared in-memory snapshot of the Notion Inventario.
 *
 * DESIGN PRINCIPLES (F1):
 *  - Notion is the ONLY source of truth. This cache is TEMPORARY only.
 *  - Loaded once on mount. Refreshed on demand (button) or every 10 min.
 *  - Provides O(1) local lookup by SKU (Codice prodotto) for INSTANT recognition
 *    during scanning — no API call needed for known SKUs.
 *  - Barcode/QR/Serial resolution is NOT cached here (not present on Inventario
 *    by design) — those hit the backend which queries Notion Entrate/Uscite.
 *  - `refresh()` is de-duplicated: concurrent callers get the same in-flight promise.
 *  - The cache never authorizes a movement. Every submit re-reads Notion live.
 */

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;
const AUTO_REFRESH_MS = 10 * 60 * 1000; // 10 minutes

const InventoryContext = createContext(null);

export function InventoryProvider({ children }) {
  const [items, setItems] = useState([]);
  const [categories, setCategories] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [refreshedAt, setRefreshedAt] = useState(null);
  const inflight = useRef(null);

  const refresh = useCallback(async () => {
    if (inflight.current) return inflight.current;
    setLoading(true);
    setError(null);
    const p = (async () => {
      try {
        const { data } = await axios.get(`${API}/inventory`);
        setItems(data.items || []);
        setCategories(data.categories || []);
        setRefreshedAt(
          data.refreshed_at ? new Date(data.refreshed_at) : new Date()
        );
      } catch (e) {
        setError(
          e?.response?.data?.detail ||
            e?.message ||
            "Impossibile leggere il magazzino"
        );
      } finally {
        setLoading(false);
        inflight.current = null;
      }
    })();
    inflight.current = p;
    return p;
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    const id = setInterval(refresh, AUTO_REFRESH_MS);
    return () => clearInterval(id);
  }, [refresh]);

  // Build O(1) indices whenever items change.
  const indices = useMemo(() => {
    const bySku = new Map();
    const byId = new Map();
    for (const it of items) {
      byId.set(it.id, it);
      const c = (it.code || "").trim().toLowerCase();
      if (c) bySku.set(c, it);
    }
    return { bySku, byId };
  }, [items]);

  const lookupLocalBySku = useCallback(
    (code) => {
      const key = (code || "").trim().toLowerCase();
      if (!key) return null;
      return indices.bySku.get(key) || null;
    },
    [indices]
  );

  const getById = useCallback((id) => indices.byId.get(id) || null, [indices]);

  const value = useMemo(
    () => ({
      items,
      categories,
      loading,
      error,
      refreshedAt,
      refresh,
      lookupLocalBySku,
      getById,
    }),
    [items, categories, loading, error, refreshedAt, refresh, lookupLocalBySku, getById]
  );

  return (
    <InventoryContext.Provider value={value}>
      {children}
    </InventoryContext.Provider>
  );
}

export function useInventoryCtx() {
  const ctx = useContext(InventoryContext);
  if (!ctx) {
    throw new Error("useInventoryCtx must be used inside <InventoryProvider>");
  }
  return ctx;
}
