import { useCallback, useEffect, useState } from "react";

const LS_KEY = "elios_operator";

/**
 * useOperator — persistenza operatore in localStorage (multi-utente semplice).
 * NO login server-side. L'operatore inserisce/cambia il nome dall'AppLayout;
 * viene ricordato per la sessione e i submit successivi.
 */
export function useOperator() {
  const [operator, setOperatorState] = useState(() => {
    try {
      return localStorage.getItem(LS_KEY) || "";
    } catch {
      return "";
    }
  });

  useEffect(() => {
    const on = (e) => {
      if (e.key === LS_KEY) setOperatorState(e.newValue || "");
    };
    window.addEventListener("storage", on);
    return () => window.removeEventListener("storage", on);
  }, []);

  const setOperator = useCallback((name) => {
    const val = (name || "").trim();
    try {
      if (val) localStorage.setItem(LS_KEY, val);
      else localStorage.removeItem(LS_KEY);
    } catch {}
    setOperatorState(val);
  }, []);

  return { operator, setOperator };
}
