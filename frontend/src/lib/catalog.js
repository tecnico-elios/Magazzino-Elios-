import { useEffect, useState } from "react";
import axios from "axios";

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

// Default catalog used ONLY as a fallback while /api/catalog is loading.
// Real source of truth is the backend (editable from /admin).
export const DEFAULT_CATEGORIES = [
  {
    id: "cat1",
    name: "Wallbox e Daze",
    subtitle: "Colonnine di ricarica",
    requires_serial: true,
    products: [
      "Wallbox 7,4 kW - cavo 5 mt",
      "Wallbox 22 kW - cavo 5 mt",
      "Wallbox 22 kW - cavo 7 mt",
      "Daze Duo 44 kW",
    ],
  },
  {
    id: "cat2",
    name: "Meter e Misuratori",
    subtitle: "Contatori di energia",
    requires_serial: true,
    products: ["Meter Monofase", "Meter Trifase", "Meter Daze"],
  },
  {
    id: "cat3",
    name: "Accessori e Supporti",
    subtitle: "Portacavi e stand (no seriali)",
    requires_serial: false,
    products: [
      "Portacavo Pro Wallbox",
      "Portacavo Daze",
      "Stand Wallbox Single",
      "Stand Wallbox Dual",
      "Stand Daze Single",
    ],
  },
];

export const buildInitialState = (categories) => {
  const state = {};
  (categories || []).forEach((cat) => {
    (cat.products || []).forEach((name) => {
      state[`${cat.id}::${name}`] = { quantity: 0, serials: [] };
    });
  });
  return state;
};

export function useCatalog() {
  const [categories, setCategories] = useState(DEFAULT_CATEGORIES);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const { data } = await axios.get(`${API}/catalog`);
        if (!alive) return;
        if (Array.isArray(data.categories_list)) {
          setCategories(data.categories_list);
        }
      } catch (e) {
        if (alive) setError(e?.message || "Impossibile caricare il catalogo");
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  return { categories, loading, error };
}
