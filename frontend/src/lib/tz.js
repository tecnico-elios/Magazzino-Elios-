/**
 * Timezone helper — legge il fuso orario configurato in Admin → Impostazioni → Fuso orario
 * (chiave `general.timezone` nel settings store esistente) e lo usa per formattare tutte le
 * date/ore mostrate dal gestionale. Non modifica i dati storici salvati.
 *
 * - Sorgente di verità: GET /api/settings (già consumato da altri componenti F6/F7).
 * - Reset cache su evento globale `elios:settings-changed` (emesso dal SettingsTab).
 * - Fallback: Europe/Rome (retro-compatibile con F1-F7).
 * - Per la data "oggi" nei form (Arrivi/Spedizioni/Movimenti) si usa GET /api/time
 *   così l'orologio del PC/tablet/palmare non influisce.
 */
import { useEffect, useState } from "react";
import axios from "axios";

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;
const DEFAULT_TZ = "Europe/Rome";

let _tz = null;
let _tzPromise = null;
let _serverToday = null;
let _serverTodayPromise = null;
let _serverTodayFetchedAt = 0;

export async function getConfiguredTz() {
  if (_tz) return _tz;
  if (!_tzPromise) {
    _tzPromise = axios
      .get(`${API}/settings`)
      .then(({ data }) => {
        _tz = data?.general?.timezone || DEFAULT_TZ;
        return _tz;
      })
      .catch(() => {
        _tz = DEFAULT_TZ;
        return _tz;
      });
  }
  return _tzPromise;
}

export function getTzSync() {
  return _tz || DEFAULT_TZ;
}

/**
 * Data corrente (YYYY-MM-DD) generata dal server nel tz configurato.
 * Usata come default per i campi data di Arrivi/Spedizioni/Movimenti.
 * Cache 60s per evitare chiamate ripetute a ogni mount.
 */
export async function fetchServerToday() {
  const now = Date.now();
  if (_serverToday && now - _serverTodayFetchedAt < 60_000) return _serverToday;
  if (!_serverTodayPromise) {
    _serverTodayPromise = axios
      .get(`${API}/time`)
      .then(({ data }) => {
        if (data?.tz) _tz = data.tz;
        _serverToday = data?.local_date || new Date().toISOString().slice(0, 10);
        _serverTodayFetchedAt = Date.now();
        _serverTodayPromise = null;
        return _serverToday;
      })
      .catch(() => {
        _serverTodayPromise = null;
        return new Date().toISOString().slice(0, 10);
      });
  }
  return _serverTodayPromise;
}

export function fmtDateTime(v) {
  if (!v) return "—";
  try {
    const s =
      typeof v === "string" &&
      !/(Z|[+-]\d{2}:?\d{2})$/.test(v) &&
      /^\d{4}-\d{2}-\d{2}T/.test(v)
        ? v + "Z"
        : v;
    return new Date(s).toLocaleString("it-IT", { timeZone: getTzSync() });
  } catch {
    return typeof v === "string" ? v : "—";
  }
}

export function fmtTime(v) {
  const d = v instanceof Date ? v : new Date(v);
  try {
    return d.toLocaleTimeString("it-IT", { timeZone: getTzSync() });
  } catch {
    return d.toLocaleTimeString("it-IT");
  }
}

/**
 * Hook React: garantisce che il componente si aggiorni quando il tz è caricato
 * o quando l'admin lo cambia. Restituisce sempre una stringa valida (mai null).
 */
export function useTz() {
  const [tz, setTz] = useState(() => _tz || DEFAULT_TZ);
  useEffect(() => {
    let alive = true;
    getConfiguredTz().then((t) => alive && setTz(t));
    const onChange = () => {
      _tz = null;
      _tzPromise = null;
      _serverToday = null;
      _serverTodayPromise = null;
      _serverTodayFetchedAt = 0;
      getConfiguredTz().then((t) => alive && setTz(t));
    };
    if (typeof window !== "undefined") {
      window.addEventListener("elios:settings-changed", onChange);
    }
    return () => {
      alive = false;
      if (typeof window !== "undefined") {
        window.removeEventListener("elios:settings-changed", onChange);
      }
    };
  }, []);
  return tz;
}

// Reset cache globale quando l'admin salva impostazioni.
if (typeof window !== "undefined") {
  window.addEventListener("elios:settings-changed", () => {
    _tz = null;
    _tzPromise = null;
    _serverToday = null;
    _serverTodayPromise = null;
    _serverTodayFetchedAt = 0;
  });
}
