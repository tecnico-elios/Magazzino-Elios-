import { useEffect, useRef, useState } from "react";
import { Input } from "./ui/input";
import { Button } from "./ui/button";
import { Barcode, QrCode, X, Crosshair } from "@phosphor-icons/react";
import BarcodeScanner from "./BarcodeScanner";

/**
 * ScannerBar — general-purpose product scanner input.
 * Works with:
 *  - USB / Bluetooth barcode scanners that emulate a keyboard (types chars + Enter)
 *  - Device camera (via BarcodeScanner dialog)
 * On Enter, calls onScanned(code). Parent handles Notion lookup + auto-add.
 */
export default function ScannerBar({ onScanned, lastScan, onClearLastScan, hint }) {
  const [buffer, setBuffer] = useState("");
  const [cameraOpen, setCameraOpen] = useState(false);
  const inputRef = useRef(null);

  // Auto-focus once on mount — user can click elsewhere to type in other fields,
  // and clicking the "focus" pill re-centers scanning here.
  useEffect(() => {
    if (inputRef.current) inputRef.current.focus();
  }, []);

  const submit = (raw) => {
    const code = (raw ?? buffer).trim();
    if (!code) return;
    onScanned(code);
    setBuffer("");
    // Refocus for continuous scanning
    setTimeout(() => inputRef.current?.focus(), 0);
  };

  const onKeyDown = (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      submit();
    }
  };

  const bannerCls =
    lastScan?.type === "ok"
      ? "bg-green-50 border-green-300 text-green-900"
      : lastScan?.type === "warn"
      ? "bg-orange-50 border-orange-300 text-orange-900"
      : lastScan?.type === "error"
      ? "bg-red-50 border-red-300 text-red-900"
      : "";

  const emoji =
    lastScan?.type === "ok" ? "🟢" : lastScan?.type === "warn" ? "🟠" : "🔴";

  return (
    <section
      className="bg-white border border-slate-200 rounded-md overflow-hidden"
      data-testid="scanner-bar"
    >
      <div className="p-4 flex items-center gap-3">
        <div className="text-slate-500 shrink-0">
          <Barcode size={26} weight="bold" />
        </div>
        <div className="flex-1 min-w-0">
          <label
            htmlFor="scanner-input"
            className="text-[10px] tracking-[0.18em] uppercase text-slate-500 font-semibold"
          >
            Scansiona Prodotto
          </label>
          <Input
            id="scanner-input"
            ref={inputRef}
            value={buffer}
            onChange={(e) => setBuffer(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Scansiona seriale o codice prodotto — supporta lettore USB/Bluetooth"
            className="h-12 font-mono-tight mt-1 text-base"
            data-testid="scanner-input"
            autoComplete="off"
            spellCheck={false}
          />
          {hint && !lastScan && (
            <div className="text-xs text-slate-500 mt-1">{hint}</div>
          )}
        </div>
        <Button
          type="button"
          variant="outline"
          onClick={() => inputRef.current?.focus()}
          className="h-12 w-12 shrink-0 hidden sm:inline-flex"
          data-testid="scanner-focus-btn"
          title="Metti a fuoco l'input"
        >
          <Crosshair size={20} />
        </Button>
        <Button
          type="button"
          variant="outline"
          onClick={() => setCameraOpen(true)}
          className="h-12 shrink-0"
          data-testid="scanner-camera-btn"
          title="Scansiona con fotocamera"
        >
          <QrCode size={20} className="sm:mr-1" />
          <span className="hidden sm:inline">Fotocamera</span>
        </Button>
      </div>

      {lastScan && (
        <div
          className={`px-4 py-3 border-t ${bannerCls}`}
          data-testid="scanner-banner"
        >
          <div className="flex items-start gap-3">
            <span className="text-2xl leading-none pt-0.5" aria-hidden>
              {emoji}
            </span>
            <div className="flex-1 min-w-0">
              <div className="font-semibold text-sm tracking-tight">
                {lastScan.title}
              </div>
              {lastScan.subtitle && (
                <div className="text-sm mt-0.5 break-words">
                  {lastScan.subtitle}
                </div>
              )}
              {lastScan.code && (
                <div className="text-xs font-mono-tight opacity-70 mt-1">
                  Codice: {lastScan.code}
                </div>
              )}
            </div>
            {onClearLastScan && (
              <button
                type="button"
                onClick={onClearLastScan}
                className="text-slate-500 hover:text-slate-900 p-1 shrink-0"
                aria-label="Chiudi"
                data-testid="scanner-banner-close"
              >
                <X size={16} />
              </button>
            )}
          </div>
        </div>
      )}

      <BarcodeScanner
        open={cameraOpen}
        onClose={() => setCameraOpen(false)}
        onDetected={(code) => {
          setCameraOpen(false);
          submit(code);
        }}
        label="Scanner generale"
      />
    </section>
  );
}
