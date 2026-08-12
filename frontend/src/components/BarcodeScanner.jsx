import { useEffect, useRef, useState } from "react";
import { Html5Qrcode } from "html5-qrcode";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "./ui/dialog";
import { Button } from "./ui/button";
import { X } from "@phosphor-icons/react";

// A unique id per component instance so multiple modals do not collide
let _scannerIdCounter = 0;

export default function BarcodeScanner({ open, onClose, onDetected, label }) {
  const scannerRef = useRef(null);
  const isRunningRef = useRef(false);
  const detectedRef = useRef(false);
  const onDetectedRef = useRef(onDetected);
  const containerIdRef = useRef(null);
  if (containerIdRef.current == null) {
    _scannerIdCounter += 1;
    containerIdRef.current = `barcode-scanner-region-${_scannerIdCounter}`;
  }
  const [error, setError] = useState("");
  const [starting, setStarting] = useState(false);

  // Keep the callback ref current WITHOUT restarting the scanner
  useEffect(() => {
    onDetectedRef.current = onDetected;
  }, [onDetected]);

  useEffect(() => {
    if (!open) return undefined;

    let cancelled = false;
    setError("");
    setStarting(true);
    detectedRef.current = false;

    const stopScanner = async () => {
      const inst = scannerRef.current;
      scannerRef.current = null;
      if (!inst || !isRunningRef.current) return;
      isRunningRef.current = false;
      try {
        await inst.stop();
      } catch (_) {
        /* ignore */
      }
      try {
        inst.clear();
      } catch (_) {
        /* ignore */
      }
    };

    // The scanner target div lives inside a Radix Dialog portal that mounts
    // asynchronously. Wait until the element is in the DOM before constructing.
    const waitForNode = () =>
      new Promise((resolve, reject) => {
        let tries = 0;
        const check = () => {
          if (cancelled) return reject(new Error("cancelled"));
          const el = document.getElementById(containerIdRef.current);
          if (el) return resolve(el);
          if (tries++ > 60) return reject(new Error("dom-timeout"));
          requestAnimationFrame(check);
        };
        check();
      });

    (async () => {
      let inst;
      try {
        await waitForNode();
        inst = new Html5Qrcode(containerIdRef.current, { verbose: false });
      } catch (e) {
        if (cancelled) return;
        setStarting(false);
        const errName = e?.name || "";
        const errMsg = e?.message || String(e) || "";
        if (errMsg === "cancelled") return;
        setError(
          `Errore inizializzazione scanner${errName ? ` (${errName})` : ""}: ${errMsg || "sconosciuto"}`
        );
        return;
      }
      scannerRef.current = inst;

      const config = { fps: 12, qrbox: { width: 260, height: 160 } };

      inst
        .start(
          { facingMode: "environment" },
          config,
          (decodedText) => {
            if (detectedRef.current) return;
            detectedRef.current = true;
            const cb = onDetectedRef.current;
            stopScanner().finally(() => {
              if (cb) cb(decodedText);
            });
          },
          () => {}
        )
        .then(() => {
          if (cancelled) {
            stopScanner();
            return;
          }
          isRunningRef.current = true;
          setStarting(false);
        })
        .catch((err) => {
          if (cancelled) return;
          setStarting(false);
          const raw = (err && (err.message || err.toString())) || "";
          const msg = String(raw).toLowerCase();
          if (
            msg.includes("permission") ||
            msg.includes("notallowed") ||
            msg.includes("not allowed") ||
            msg.includes("denied")
          ) {
            setError(
              "Permesso fotocamera negato. Consentilo dalle impostazioni del browser e ricarica."
            );
          } else if (
            msg.includes("notfound") ||
            msg.includes("not found") ||
            msg.includes("no camera") ||
            msg.includes("devicesnot")
          ) {
            setError("Nessuna fotocamera trovata su questo dispositivo.");
          } else if (msg.includes("secure") || msg.includes("https") || msg.includes("insecure")) {
            setError(
              "La fotocamera funziona solo su HTTPS. Apri l'app dal link sicuro (https://…)."
            );
          } else if (msg.includes("inuse") || msg.includes("in use") || msg.includes("busy")) {
            setError(
              "La fotocamera è in uso da un'altra app. Chiudi le altre app e riprova."
            );
          } else {
            setError(
              "Impossibile avviare la fotocamera. " +
                (raw ? `(${raw}) ` : "") +
                "Inserisci il codice manualmente."
            );
          }
        });
    })();

    return () => {
      cancelled = true;
      stopScanner();
    };
  }, [open]);

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose && onClose()}>
      <DialogContent className="max-w-md" data-testid="scanner-dialog">
        <DialogHeader>
          <DialogTitle className="font-display text-xl">Scansiona Codice</DialogTitle>
          <DialogDescription className="text-slate-600">
            {label ? `Seriale per: ${label}` : "Inquadra il codice a barre o QR"}
          </DialogDescription>
        </DialogHeader>
        <div className="scanner-region border border-slate-200 rounded-md overflow-hidden bg-slate-900 min-h-[240px] flex items-center justify-center relative">
          <div id={containerIdRef.current} className="w-full" />
          {starting && !error && (
            <div className="absolute inset-0 flex items-center justify-center text-slate-300 text-sm pointer-events-none">
              Avvio fotocamera…
            </div>
          )}
        </div>
        {error && (
          <div
            data-testid="scanner-error"
            className="mt-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700"
          >
            {error}
          </div>
        )}
        <Button
          type="button"
          variant="outline"
          className="h-12 mt-2"
          onClick={() => onClose && onClose()}
          data-testid="scanner-close-btn"
        >
          <X size={18} className="mr-2" />
          Chiudi
        </Button>
      </DialogContent>
    </Dialog>
  );
}
