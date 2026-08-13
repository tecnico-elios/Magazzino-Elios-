import { useCallback, useEffect, useState } from "react";
import axios from "axios";

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

export function useInventory() {
  const [items, setItems] = useState([]);
  const [categories, setCategories] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [refreshedAt, setRefreshedAt] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { data } = await axios.get(`${API}/inventory`);
      setItems(data.items || []);
      setCategories(data.categories || []);
      setRefreshedAt(data.refreshed_at ? new Date(data.refreshed_at) : new Date());
    } catch (e) {
      setError(
        e?.response?.data?.detail ||
          e?.message ||
          "Impossibile leggere il magazzino"
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // Auto-refresh from Notion every 10 minutes so long-open tabs stay fresh
  useEffect(() => {
    const AUTO_REFRESH_MS = 10 * 60 * 1000;
    const id = setInterval(() => {
      load();
    }, AUTO_REFRESH_MS);
    return () => clearInterval(id);
  }, [load]);

  return { items, categories, loading, error, refreshedAt, refresh: load };
}
