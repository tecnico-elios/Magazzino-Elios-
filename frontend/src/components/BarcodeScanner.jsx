import { useEffect, useRef, useState } from "react";
import { Html5Qrcode } from "html5-qrcode";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "./ui/dialog";
import { Button } from "./ui/button";
import { X } from "@phosphor-icons/react";

export default function BarcodeScanner({ open, onClose, onDetected, label }) {
  const scannerRef = useRef(null);
  const containerId = "barcode-scanner-region";
  const [error, setError] = useState("");
  const [starting, setStarting] = useState(false);

  useEffect(() => {
    if (!open) return;
    setError("");
    setStarting(true);
    const html5Qr = new Html5Qrcode(containerId, { verbose: false });
    scannerRef.current = html5Qr;

    const config = { fps: 12, qrbox: { width: 260, height: 160 } };

    html5Qr
      .start(
        { facingMode: "environment" },
        config,
        (decodedText) => {
          onDetected(decodedText);
          html5Qr
            .stop()
            .then(() => html5Qr.clear())
            .catch(() => {});
        },
        () => {}
      )
      .then(() => setStarting(false))
      .catch((err) => {
        setStarting(false);
        setError(
          err?.message?.includes("Permission")
            ? "Permesso fotocamera negato. Consentilo dalle impostazioni del browser."
            : "Impossibile avviare la fotocamera. Inserisci il codice manualmente."
        );
      });

    return () => {
      if (scannerRef.current) {
        scannerRef.current
          .stop()
          .then(() => scannerRef.current && scannerRef.current.clear())
          .catch(() => {});
      }
    };
  }, [open, onDetected]);

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-md" data-testid="scanner-dialog">
        <DialogHeader>
          <DialogTitle className="font-display text-xl">Scansiona Codice</DialogTitle>
          <DialogDescription className="text-slate-600">
            {label ? `Seriale per: ${label}` : "Inquadra il codice a barre o QR"}
          </DialogDescription>
        </DialogHeader>
        <div className="scanner-region border border-slate-200 rounded-md overflow-hidden bg-slate-900 min-h-[220px] flex items-center justify-center">
          <div id={containerId} className="w-full" />
          {starting && !error && (
            <div className="text-slate-300 text-sm p-4">Avvio fotocamera…</div>
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
          onClick={onClose}
          data-testid="scanner-close-btn"
        >
          <X size={18} className="mr-2" />
          Chiudi
        </Button>
      </DialogContent>
    </Dialog>
  );
}
