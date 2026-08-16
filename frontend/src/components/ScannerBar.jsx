import { useEffect, useMemo, useRef, useState } from "react";
import axios from "axios";
import {
  Camera,
  Crosshair,
  MagnifyingGlass,
  Package,
  X,
} from "@phosphor-icons/react";
import { useInventoryCtx } from "../lib/InventoryContext";
import BarcodeScanner from "./BarcodeScanner";

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;
const SERVER_DEBOUNCE_MS = 400;

// Cache impostazioni feedback + comportamenti scanner (durate ms, autofocus, autoselect,
// ricerca live, max risultati) — invalidata via evento globale.
let _cachedScannerCfg = null;
async function fetchScannerCfg() {
  if (_cachedScannerCfg) return _cachedScannerCfg;
  try {
    const { data } = await axios.get(`${API}/settings`);
    _cachedScannerCfg = {
      green: Math.max(200, parseInt(data?.scanner?.feedback_green_ms || 3000, 10)),
      red: Math.max(200, parseInt(data?.scanner?.feedback_red_ms || 3000, 10)),
      autofocus: data?.scanner?.autofocus !== false, // default true
      autoselect: !!data?.scanner?.autoselect_single_result,
      searchOnType: data?.ricerca?.search_on_type !== false, // default true
      maxResults: Math.max(1, parseInt(data?.ricerca?.max_results || 8, 10)),
      partial: data?.ricerca?.partial_match !== false, // default true
    };
  } catch {
    _cachedScannerCfg = { green: 3000, red: 3000, autofocus: true, autoselect: false, searchOnType: true, maxResults: 8, partial: true };
  }
  return _cachedScannerCfg;
}
if (typeof window !== "undefined") {
  window.addEventListener("elios:settings-changed", () => { _cachedScannerCfg = null; });
}

/**
 * ScannerBar — fast scan-first input with a live product picker dropdown
 * over the local inventory cache. Notion is not called on every keystroke.
 * On Enter (from scanner gun or keyboard) submits the current buffer through
 * `onScanned`, which triggers the full lookup pipeline.
 *
 * When the buffer looks like a full code (no whitespace, ≥4 chars) and no local
 * SKU matches exactly, a DEBOUNCED (400ms) server lookup is fired to resolve
 * SNs known to Notion (Entrate/Uscite). The result is shown as a top row in the
 * dropdown so operators can click it OR press Enter and get the same flow.
 */
export default function ScannerBar({ onScanned, lastScan, onClearLastScan, hint }) {
  const [buffer, setBuffer] = useState("");
  const [cameraOpen, setCameraOpen] = useState(false);
  const [open, setOpen] = useState(false); // dropdown visibility
  const [hoverIdx, setHoverIdx] = useState(-1);
  const [serverHit, setServerHit] = useState(null); // {item, status, ...} for SN/barcode found on Notion
  const [cfg, setCfg] = useState({ autofocus: true, autoselect: false, searchOnType: true, maxResults: 8, partial: true });
  const inputRef = useRef(null);
  const containerRef = useRef(null);
  const { searchLocal } = useInventoryCtx();

  useEffect(() => {
    fetchScannerCfg().then((c) => setCfg({
      autofocus: c.autofocus, autoselect: c.autoselect,
      searchOnType: c.searchOnType, maxResults: c.maxResults, partial: c.partial,
    }));
  }, []);

  useEffect(() => {
    if (cfg.autofocus && inputRef.current) inputRef.current.focus();
  }, [cfg.autofocus]);

  // Refocus globale — richiamato da QtyDialog/SerialCollector al termine dei loro flussi.
  // Evita di rubare il focus se l'utente sta ancora compilando un altro campo.
  useEffect(() => {
    const handler = () => {
      if (typeof document === "undefined") return;
      const ae = document.activeElement;
      if (ae && ae !== inputRef.current) {
        const tag = ae.tagName;
        if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || ae.isContentEditable) return;
      }
      inputRef.current?.focus();
    };
    window.addEventListener("elios:refocus-scanner", handler);
    return () => window.removeEventListener("elios:refocus-scanner", handler);
  }, []);

  // Auto-clear feedback — durate configurabili da Admin → Impostazioni → Scanner.
  useEffect(() => {
    if (!lastScan || !onClearLastScan) return undefined;
    let cancelled = false;
    let timerId = null;
    fetchScannerCfg().then((ms) => {
      if (cancelled) return;
      const isOk = lastScan.type === "ok";
      const duration = isOk ? ms.green : ms.red;
      timerId = setTimeout(() => onClearLastScan(), duration);
    });
    return () => {
      cancelled = true;
      if (timerId) clearTimeout(timerId);
    };
  }, [lastScan, onClearLastScan]);

  // Close dropdown on outside click
  useEffect(() => {
    const onDown = (e) => {
      if (!containerRef.current) return;
      if (!containerRef.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, []);

  const localSuggestions = useMemo(() => {
    const q = buffer.trim();
    if (q.length < 2) return [];
    if (!cfg.searchOnType) return [];
    return searchLocal(q, cfg.maxResults, { partial: cfg.partial });
  }, [buffer, searchLocal, cfg.searchOnType, cfg.maxResults, cfg.partial]);

  // Debounced server-side lookup for potential SNs / barcodes not in local SKU cache
  useEffect(() => {
    const q = buffer.trim();
    setServerHit(null);
    if (q.length < 4 || /\s/.test(q)) return undefined;
    // Skip if local exact-code match exists — it's already the top suggestion
    const localExact = localSuggestions.find(
      (i) => (i.code || "").toLowerCase() === q.toLowerCase()
    );
    if (localExact) return undefined;
    const t = setTimeout(async () => {
      try {
        const { data } = await axios.get(`${API}/inventory/lookup`, {
          params: { code: q },
        });
        if (data.status !== "not_found" && data.item) {
          setServerHit({ ...data, query: q });
        }
      } catch (_) {
        // silent — dropdown stays local-only
      }
    }, SERVER_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [buffer, localSuggestions]);

  const suggestions = useMemo(() => {
    if (!serverHit) return localSuggestions;
    // Prepend serverHit if it's a fresh SN/barcode NOT already in the local list
    const alreadyLocal = localSuggestions.find(
      (i) => i.id === serverHit.item?.id
    );
    if (alreadyLocal) return localSuggestions;
    return [{ __server: true, ...serverHit }, ...localSuggestions];
  }, [localSuggestions, serverHit]);

  useEffect(() => {
    setHoverIdx(-1);
    setOpen(suggestions.length > 0);
  }, [suggestions]);

  const commit = (code) => {
    const value = (code || "").trim();
    if (!value) return;
    onScanned(value);
    setBuffer("");
    setServerHit(null);
    setOpen(false);
    setHoverIdx(-1);
    setTimeout(() => inputRef.current?.focus(), 0);
  };

  const selectSuggestion = (s) => {
    if (s.__server) {
      // Server hit: send the exact query so backend re-runs same lookup and downstream flow decides.
      commit(s.query);
      return;
    }
    if (s?.code) commit(s.code);
  };

  // Trigger ricerca manuale — stessa logica dell'ENTER (usata dal pulsante 🔎 CERCA).
  const triggerSearch = () => {
    if (open && hoverIdx >= 0 && suggestions[hoverIdx]) {
      selectSuggestion(suggestions[hoverIdx]);
    } else if (cfg.autoselect && suggestions.length === 1) {
      selectSuggestion(suggestions[0]);
    } else {
      commit(buffer);
    }
  };

  const onKeyDown = (e) => {
    if (e.key === "ArrowDown" && suggestions.length) {
      e.preventDefault();
      setOpen(true);
      setHoverIdx((i) => Math.min(i + 1, suggestions.length - 1));
      return;
    }
    if (e.key === "ArrowUp" && suggestions.length) {
      e.preventDefault();
      setHoverIdx((i) => Math.max(i - 1, 0));
      return;
    }
    if (e.key === "Escape") {
      setOpen(false);
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      if (open && hoverIdx >= 0 && suggestions[hoverIdx]) {
        selectSuggestion(suggestions[hoverIdx]);
      } else if (cfg.autoselect && suggestions.length === 1) {
        // Admin → Impostazioni → Scanner → "Selezione automatica singolo risultato"
        selectSuggestion(suggestions[0]);
      } else {
        commit(buffer);
      }
    }
  };

  return (
    <section
      ref={containerRef}
      className="rounded-md bg-white border border-slate-200 p-4 relative"
      data-testid="scanner-bar"
    >
      <div className="text-[10px] tracking-[0.2em] uppercase text-slate-500 font-semibold mb-2">
        Inserisci o scansiona prodotto
      </div>

      <div className="flex items-center gap-2 flex-wrap sm:flex-nowrap">
        <div className="relative flex-1 min-w-0 w-full sm:w-auto">
          <input
            id="scanner-input"
            ref={inputRef}
            data-testid="scanner-input"
            type="text"
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
            value={buffer}
            onChange={(e) => setBuffer(e.target.value)}
            onKeyDown={onKeyDown}
            onFocus={() => suggestions.length && setOpen(true)}
            placeholder="Inserisci o scansiona seriale/codice prodotto — digita e premi ENTER o CERCA"
            className="w-full h-11 text-base bg-transparent border-0 border-b border-slate-200 focus:outline-none focus:border-slate-500 font-mono-tight"
          />
          {buffer && (
            <button
              type="button"
              onClick={() => {
                setBuffer("");
                setOpen(false);
                inputRef.current?.focus();
              }}
              className="absolute right-1 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700"
              aria-label="Clear"
              data-testid="scanner-clear-btn"
            >
              <X size={16} />
            </button>
          )}

          {/* Live suggestions dropdown */}
          {open && suggestions.length > 0 && (
            <ul
              className="absolute left-0 right-0 top-full mt-1 z-20 bg-white border border-slate-200 rounded-md shadow-lg overflow-hidden"
              data-testid="scanner-suggestions"
              role="listbox"
            >
              {suggestions.map((s, idx) => {
                const isHover = idx === hoverIdx;
                const isServer = !!s.__server;
                const it = isServer ? s.item : s;
                const tg = it?.tipo_gestione;
                let stateBadge = null;
                if (isServer) {
                  if (s.status === "in_warehouse")
                    stateBadge = (
                      <span className="text-[10px] uppercase tracking-wider font-bold px-2 py-0.5 rounded bg-emerald-50 text-emerald-800 border border-emerald-200">
                        In magazzino
                      </span>
                    );
                  else if (s.status === "out")
                    stateBadge = (
                      <span className="text-[10px] uppercase tracking-wider font-bold px-2 py-0.5 rounded bg-red-50 text-red-800 border border-red-200">
                        Uscito · {s.shipped_to || "cliente"}
                      </span>
                    );
                }
                return (
                  <li
                    key={isServer ? `srv-${s.query}` : it.id}
                    role="option"
                    aria-selected={isHover}
                    onMouseDown={(e) => {
                      e.preventDefault();
                      selectSuggestion(s);
                    }}
                    onMouseEnter={() => setHoverIdx(idx)}
                    className={`px-3 py-2 cursor-pointer flex flex-col sm:flex-row sm:items-start sm:justify-between gap-2 text-sm ${
                      isHover ? "bg-slate-100" : "hover:bg-slate-50"
                    }`}
                    data-testid={
                      isServer
                        ? `scanner-server-suggestion-${idx}`
                        : `scanner-suggestion-${idx}`
                    }
                  >
                    <div className="min-w-0 w-full sm:flex-1">
                      <div className="font-semibold text-slate-900 flex items-start gap-1 break-words">
                        {isServer && (
                          <MagnifyingGlass
                            size={12}
                            className="text-slate-400 shrink-0 mt-1"
                          />
                        )}
                        <span className="break-words min-w-0">{it?.name || "—"}</span>
                      </div>
                      <div className="text-xs text-slate-500 font-mono-tight break-all">
                        {isServer
                          ? `SN: ${s.query}`
                          : it.code || "—"}
                        {!isServer && it.category && (
                          <span className="text-slate-400"> · {it.category}</span>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-2 flex-wrap w-full sm:w-auto sm:shrink-0 sm:justify-end sm:max-w-[45%]">
                      {stateBadge}
                      {tg === "a_seriale" ? (
                        <span className="text-[10px] uppercase tracking-wider font-bold px-2 py-0.5 rounded bg-amber-50 text-amber-800 border border-amber-200">
                          A Seriale
                        </span>
                      ) : tg === "a_quantita" ? (
                        <span className="text-[10px] uppercase tracking-wider font-bold px-2 py-0.5 rounded bg-slate-100 text-slate-700 border border-slate-200">
                          A Quantità
                        </span>
                      ) : (
                        <span className="text-[10px] uppercase tracking-wider font-bold px-2 py-0.5 rounded bg-red-50 text-red-700 border border-red-200">
                          NON CONFIG.
                        </span>
                      )}
                      {!isServer && (
                        <span className="text-xs font-mono-tight font-semibold text-slate-700">
                          {it.quantity} {it.unit}
                        </span>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
        <button
          type="button"
          onClick={triggerSearch}
          className="h-11 px-4 rounded-md bg-slate-900 text-white hover:bg-slate-800 flex items-center gap-1.5 shrink-0 font-semibold text-sm"
          data-testid="search-btn"
          aria-label="Cerca"
          title="Cerca (ENTER)"
        >
          <MagnifyingGlass size={16} weight="bold" />
          <span>CERCA</span>
        </button>
        <button
          type="button"
          onClick={() => setCameraOpen(true)}
          className="h-11 w-11 rounded-md border border-slate-200 text-slate-600 hover:text-slate-900 hover:border-slate-300 grid place-items-center shrink-0"
          data-testid="camera-btn"
          aria-label="Apri fotocamera"
          title="Fotocamera"
        >
          <Camera size={18} />
        </button>
        <button
          type="button"
          onClick={() => inputRef.current?.focus()}
          className="h-11 w-11 rounded-md border border-slate-200 text-slate-500 hover:text-slate-900 hover:border-slate-300 grid place-items-center shrink-0"
          aria-label="Focus barra"
          title="Focus"
          data-testid="focus-btn"
        >
          <Crosshair size={18} />
        </button>
      </div>

      {hint && (
        <div className="mt-2 text-xs text-slate-500 flex items-center gap-1">
          <MagnifyingGlass size={12} />
          <span>{hint}</span>
        </div>
      )}

      {lastScan && (
        <div
          className={`mt-3 rounded-md border p-3 flex items-start gap-2 ${
            lastScan.type === "ok"
              ? "border-emerald-200 bg-emerald-50 text-emerald-800"
              : lastScan.type === "warn"
              ? "border-amber-200 bg-amber-50 text-amber-800"
              : "border-red-200 bg-red-50 text-red-800"
          }`}
          data-testid="scanner-banner"
          role="status"
        >
          <Package size={16} className="shrink-0 mt-0.5" />
          <div className="min-w-0 flex-1">
            <div className="font-semibold text-sm">{lastScan.title}</div>
            {lastScan.subtitle && (
              <div className="text-xs mt-0.5 break-words whitespace-normal">{lastScan.subtitle}</div>
            )}
            {lastScan.code && (
              <div className="text-[10px] font-mono-tight mt-1 opacity-70 break-all">
                Codice: {lastScan.code}
              </div>
            )}
          </div>
          <button
            type="button"
            onClick={onClearLastScan}
            className="text-slate-500 hover:text-slate-900"
            aria-label="Dismiss"
            data-testid="dismiss-banner-btn"
          >
            <X size={14} />
          </button>
        </div>
      )}

      <BarcodeScanner
        open={cameraOpen}
        onClose={() => setCameraOpen(false)}
        onDetected={(code) => {
          setCameraOpen(false);
          commit(code);
        }}
        label="Inquadra il codice del prodotto o il seriale generale"
      />
    </section>
  );
}
