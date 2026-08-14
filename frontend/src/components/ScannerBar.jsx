import { useEffect, useMemo, useRef, useState } from "react";
import {
  Barcode,
  Camera,
  Crosshair,
  MagnifyingGlass,
  Package,
  X,
} from "@phosphor-icons/react";
import { useInventoryCtx } from "../lib/InventoryContext";
import BarcodeScanner from "./BarcodeScanner";

/**
 * ScannerBar — fast scan-first input with a live product picker dropdown
 * over the local inventory cache. Notion is not called on every keystroke.
 * On Enter (from scanner gun or keyboard) submits the current buffer through
 * `onScanned`, which triggers the full lookup pipeline.
 */
export default function ScannerBar({ onScanned, lastScan, onClearLastScan, hint }) {
  const [buffer, setBuffer] = useState("");
  const [cameraOpen, setCameraOpen] = useState(false);
  const [open, setOpen] = useState(false); // dropdown visibility
  const [hoverIdx, setHoverIdx] = useState(-1);
  const inputRef = useRef(null);
  const containerRef = useRef(null);
  const { searchLocal } = useInventoryCtx();

  useEffect(() => {
    if (inputRef.current) inputRef.current.focus();
  }, []);

  // 3s auto-clear feedback
  useEffect(() => {
    if (!lastScan || !onClearLastScan) return undefined;
    const id = setTimeout(() => onClearLastScan(), 3000);
    return () => clearTimeout(id);
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

  const suggestions = useMemo(() => {
    const q = buffer.trim();
    if (q.length < 2) return [];
    return searchLocal(q, 8);
  }, [buffer, searchLocal]);

  useEffect(() => {
    setHoverIdx(-1);
    setOpen(suggestions.length > 0);
  }, [suggestions]);

  const commit = (code) => {
    const value = (code || "").trim();
    if (!value) return;
    onScanned(value);
    setBuffer("");
    setOpen(false);
    setHoverIdx(-1);
    setTimeout(() => inputRef.current?.focus(), 0);
  };

  const selectItem = (item) => {
    // Send the product's SKU/code — treated as SKU match by lookup.
    if (item?.code) commit(item.code);
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
        selectItem(suggestions[hoverIdx]);
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
        Scansiona prodotto
      </div>

      <div className="flex items-center gap-2">
        <Barcode size={24} className="text-slate-400 shrink-0" />
        <div className="relative flex-1">
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
            placeholder="Scansiona seriale o codice prodotto — supporta lettore USB/Bluetooth"
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
              {suggestions.map((it, idx) => {
                const isHover = idx === hoverIdx;
                const tg = it.tipo_gestione;
                return (
                  <li
                    key={it.id}
                    role="option"
                    aria-selected={isHover}
                    onMouseDown={(e) => {
                      e.preventDefault();
                      selectItem(it);
                    }}
                    onMouseEnter={() => setHoverIdx(idx)}
                    className={`px-3 py-2 cursor-pointer flex items-center justify-between gap-2 text-sm ${
                      isHover ? "bg-slate-100" : "hover:bg-slate-50"
                    }`}
                    data-testid={`scanner-suggestion-${idx}`}
                  >
                    <div className="min-w-0 flex-1">
                      <div className="font-semibold text-slate-900 truncate">
                        {it.name}
                      </div>
                      <div className="text-xs text-slate-500 font-mono-tight truncate">
                        {it.code || "—"}
                        {it.category && (
                          <span className="text-slate-400"> · {it.category}</span>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
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
                      <span className="text-xs font-mono-tight font-semibold text-slate-700">
                        {it.quantity} {it.unit}
                      </span>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
        <button
          type="button"
          onClick={() => inputRef.current?.focus()}
          className="h-9 w-9 rounded-md border border-slate-200 text-slate-500 hover:text-slate-900 hover:border-slate-300 grid place-items-center shrink-0"
          aria-label="Focus scanner"
          data-testid="focus-btn"
        >
          <Crosshair size={16} />
        </button>
        <button
          type="button"
          onClick={() => setCameraOpen(true)}
          className="h-9 px-3 rounded-md border border-slate-200 text-slate-600 hover:text-slate-900 hover:border-slate-300 flex items-center gap-1 shrink-0"
          data-testid="camera-btn"
        >
          <Camera size={14} />
          <span className="text-sm">Fotocamera</span>
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
              <div className="text-xs mt-0.5">{lastScan.subtitle}</div>
            )}
            {lastScan.code && (
              <div className="text-[10px] font-mono-tight mt-1 opacity-70">
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
