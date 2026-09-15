// F30 — Dialog per associare QR Code multi-slot dopo il picking di un seriale.
// Il prompt appare solo se il prodotto è configurato in product_qr_config con enabled=true.
// Es. Daze Duo: slots=["right","left"] → chiede una associazione per presa.
import { useEffect, useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { QrCode, X, Check } from "@phosphor-icons/react";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "./ui/dialog";
import BarcodeScanner from "./BarcodeScanner";
import { normalizeQrCode } from "../lib/qr";

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

const SLOT_LABELS = {
  single: { label: "QR", icon: "🏷️" },
  right: { label: "Presa destra", icon: "🔌" },
  left: { label: "Presa sinistra", icon: "🔌" },
};

/** Fetch della config prodotto + bindings esistenti per il seriale. */
export async function fetchQrRequirements(productPageId, serial) {
  if (!productPageId || !serial) return { enabled: false, slots: [], existingBySlot: {} };
  try {
    const [cfgRes, bindRes] = await Promise.all([
      axios.get(`${API}/qr/product-config/${productPageId}`),
      axios.get(`${API}/qr/bindings`, { params: { sn: serial } }),
    ]);
    const cfg = cfgRes.data || {};
    const existingBySlot = {};
    for (const b of bindRes.data?.items || []) existingBySlot[b.slot] = b;
    return {
      enabled: !!cfg.enabled,
      slots: cfg.slots || [],
      existingBySlot,
    };
  } catch (e) {
    return { enabled: false, slots: [], existingBySlot: {} };
  }
}

export default function QrSlotAssociationDialog({ open, onClose, serial, productPageId, productName, initialConfig }) {
  const [step, setStep] = useState("prompt"); // prompt | select-slot | scan | done
  const [config, setConfig] = useState(initialConfig || null);
  const [selectedSlot, setSelectedSlot] = useState(null);
  const [scannerOpen, setScannerOpen] = useState(false);
  const [qrManual, setQrManual] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) {
      setStep("prompt"); setSelectedSlot(null); setQrManual("");
      return;
    }
    if (initialConfig) { setConfig(initialConfig); return; }
    fetchQrRequirements(productPageId, serial).then(setConfig);
  }, [open, serial, productPageId, initialConfig]);

  if (!open || !config) return null;
  const availableSlots = (config.slots || []).filter((s) => !config.existingBySlot?.[s]);

  const beginSlot = (slot) => {
    setSelectedSlot(slot);
    setQrManual("");
    setStep("scan");
  };

  const saveQr = async (qrRaw) => {
    const qr = normalizeQrCode(qrRaw || "").trim();
    if (!qr) {
      toast.error("QR non valido");
      return;
    }
    setBusy(true);
    try {
      await axios.post(`${API}/qr/bindings`, {
        serial, slot: selectedSlot, qr_code: qr,
        product_page_id: productPageId, product_name: productName,
      });
      toast.success(`✅ QR ${SLOT_LABELS[selectedSlot]?.label || selectedSlot} associato`);
      // Aggiorna config locale
      const newBySlot = { ...(config.existingBySlot || {}), [selectedSlot]: { slot: selectedSlot, qr_code: qr, serial } };
      const newCfg = { ...config, existingBySlot: newBySlot };
      setConfig(newCfg);
      const remaining = (newCfg.slots || []).filter((s) => !newBySlot[s]);
      if (remaining.length === 0) {
        onClose(true); // tutto associato
      } else {
        // Ancora slot da fare: prompt
        setStep("prompt");
        setSelectedSlot(null);
      }
    } catch (e) {
      const d = e?.response?.data?.detail;
      const msg = typeof d === "string" ? d : d?.message || "Errore associazione";
      const conflict = typeof d === "object" ? d?.conflict : null;
      toast.error("QR non associato", {
        description: conflict
          ? `${msg}. Attualmente su ${conflict.serial}/${conflict.slot} (${conflict.product_name || "—"})`
          : msg,
        duration: 8000,
      });
    } finally { setBusy(false); }
  };

  const remaining = (config.slots || []).filter((s) => !config.existingBySlot?.[s]);
  const associated = (config.slots || []).filter((s) => !!config.existingBySlot?.[s]);

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose(false)}>
      <DialogContent className="max-w-md w-[95vw]" data-testid="qr-slot-dialog">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <QrCode size={20} weight="bold" className="text-indigo-600" />
            Associazione QR Code
          </DialogTitle>
          <DialogDescription>
            <div className="mt-1 text-slate-700 space-y-0.5">
              <div><b>{productName}</b></div>
              <div className="font-mono-tight text-xs text-slate-500">Seriale: {serial}</div>
            </div>
          </DialogDescription>
        </DialogHeader>

        {/* Riepilogo slot già associati */}
        {associated.length > 0 && (
          <div className="text-xs bg-emerald-50 border border-emerald-200 rounded-md p-2 space-y-1" data-testid="qr-slot-associated">
            <div className="uppercase tracking-wider text-emerald-700 font-bold text-[10px]">Già associati</div>
            {associated.map((s) => (
              <div key={s} className="flex items-center gap-2">
                <Check size={12} weight="bold" className="text-emerald-600" />
                <span>{SLOT_LABELS[s]?.icon} {SLOT_LABELS[s]?.label || s}</span>
                <span className="font-mono-tight text-slate-700">{config.existingBySlot[s]?.qr_code}</span>
              </div>
            ))}
          </div>
        )}

        {step === "prompt" && remaining.length > 0 && (
          <div className="space-y-3">
            <div className="text-sm text-slate-700">
              {associated.length === 0
                ? "Vuoi associare anche il QR Code?"
                : `Vuoi associare anche ${remaining.length === 1 ? "l'altro slot" : "gli altri slot"}?`}
            </div>
            <div className="grid grid-cols-1 gap-2">
              {remaining.length === 1 ? (
                <Button
                  onClick={() => beginSlot(remaining[0])}
                  className="h-11 bg-indigo-600 hover:bg-indigo-700 text-white justify-start"
                  data-testid={`qr-slot-begin-${remaining[0]}`}
                >
                  <QrCode size={16} weight="bold" />
                  Inserisci QR — {SLOT_LABELS[remaining[0]]?.icon} {SLOT_LABELS[remaining[0]]?.label || remaining[0]}
                </Button>
              ) : (
                <>
                  <div className="text-[10px] uppercase tracking-wider text-slate-500 font-bold">Seleziona slot</div>
                  {remaining.map((s) => (
                    <Button
                      key={s} variant="outline"
                      onClick={() => beginSlot(s)}
                      className="h-11 justify-start border-slate-300"
                      data-testid={`qr-slot-select-${s}`}
                    >
                      {SLOT_LABELS[s]?.icon} {SLOT_LABELS[s]?.label || s}
                    </Button>
                  ))}
                </>
              )}
            </div>
          </div>
        )}

        {step === "scan" && selectedSlot && (
          <div className="space-y-3">
            <div className="text-sm text-slate-700">
              Scansiona il QR Code — <b>{SLOT_LABELS[selectedSlot]?.label || selectedSlot}</b>
            </div>
            <div className="flex gap-2">
              <Input
                autoFocus
                value={qrManual}
                onChange={(e) => setQrManual(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter" && qrManual.trim()) saveQr(qrManual); }}
                placeholder="QR Code (o incolla URL)…"
                className="h-11 font-mono-tight flex-1"
                data-testid="qr-slot-manual-input"
                disabled={busy}
              />
              <Button
                onClick={() => setScannerOpen(true)}
                variant="outline" className="h-11 shrink-0"
                data-testid="qr-slot-scan-btn"
                disabled={busy}
              >
                <QrCode size={16} weight="bold" />
              </Button>
            </div>
            <div className="flex gap-2">
              <Button variant="ghost" onClick={() => { setStep("prompt"); setSelectedSlot(null); }} disabled={busy} className="flex-1">
                Indietro
              </Button>
              <Button
                onClick={() => saveQr(qrManual)}
                disabled={busy || !qrManual.trim()}
                className="flex-1 bg-indigo-600 hover:bg-indigo-700 text-white"
                data-testid="qr-slot-confirm-btn"
              >
                {busy ? "Salvo…" : "Associa"}
              </Button>
            </div>
            {scannerOpen && (
              <BarcodeScanner
                open={true}
                onClose={() => setScannerOpen(false)}
                label={`Scansiona QR — ${SLOT_LABELS[selectedSlot]?.label}`}
                onDetected={(v) => { setScannerOpen(false); saveQr(v); }}
              />
            )}
          </div>
        )}

        <DialogFooter className="flex-col-reverse sm:flex-row gap-2">
          <Button
            variant="outline"
            onClick={() => onClose(false)}
            disabled={busy}
            className="w-full sm:w-auto"
            data-testid="qr-slot-skip-btn"
          >
            <X size={14} /> {remaining.length === (config.slots || []).length ? "Salta" : "Chiudi"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
