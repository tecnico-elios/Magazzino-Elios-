import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { Button } from "./ui/button";
import { Plus, Minus } from "@phosphor-icons/react";

/**
 * QtyDialog — popup quantità riusabile per Arrivi/Spedizioni.
 *
 * Props:
 *  - item: {name, quantity, unit}
 *  - initial: starting value (default 1)
 *  - maxAvailable: optional numeric max (Spedizioni → non superare stock). If set,
 *    UI mostra "Disponibili: N" e il pulsante Conferma è disabilitato se qty>max.
 *  - label: intestazione (default "Quantità")
 *  - confirmLabel: testo pulsante (default "Aggiungi")
 *  - variant: "arrivi" (emerald) | "spedizioni" (blue) — controlla colore CTA
 *  - onClose(), onConfirm(qty)
 */
export default function QtyDialog({
  item,
  initial = 1,
  maxAvailable,
  label = "Quantità",
  confirmLabel = "Aggiungi",
  variant = "arrivi",
  onClose,
  onConfirm,
}) {
  const [qty, setQty] = useState(String(initial));
  const inputRef = useRef(null);

  useEffect(() => {
    setTimeout(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    }, 0);
  }, []);

  const n = parseFloat(qty);
  const validNumber = isFinite(n) && n > 0;
  const overMax = typeof maxAvailable === "number" && n > maxAvailable;
  const canConfirm = validNumber && !overMax;

  const confirm = () => {
    if (!validNumber) {
      toast.error("Quantità non valida");
      return;
    }
    if (overMax) {
      toast.error(`Giacenza insufficiente (max ${maxAvailable})`);
      return;
    }
    onConfirm(n);
  };

  const ctaClass =
    variant === "spedizioni"
      ? "bg-blue-600 hover:bg-blue-700"
      : "bg-emerald-600 hover:bg-emerald-700";

  return (
    <div
      className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      onClick={onClose}
      data-testid="qty-dialog"
    >
      <div
        className="bg-white rounded-lg w-full max-w-md p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="text-[10px] tracking-[0.2em] uppercase text-slate-500 font-semibold">
          {label}
        </div>
        <div className="font-display text-2xl font-bold text-slate-900 mt-1">
          {item.name}
        </div>
        <div className="text-sm text-slate-500 mt-1">
          Stock attuale:{" "}
          <span className="font-mono-tight font-semibold text-slate-700">
            {item.quantity ?? 0} {item.unit || "pz"}
          </span>
          {typeof maxAvailable === "number" && (
            <>
              {" — "}
              <span className={overMax ? "text-red-600 font-semibold" : "text-emerald-700"}>
                Max: {maxAvailable}
              </span>
            </>
          )}
        </div>
        <div className="mt-5">
          <Label htmlFor="qty-input" className="text-slate-700 text-sm font-semibold">
            {label}
          </Label>
          <div className="mt-2 flex items-stretch gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                const cur = parseInt(qty || "0", 10);
                const next = Math.max(1, (isFinite(cur) ? cur : 1) - 1);
                setQty(String(next));
              }}
              disabled={parseInt(qty || "0", 10) <= 1}
              className="h-14 w-14 shrink-0 text-xl"
              aria-label="Diminuisci di 1"
              data-testid="qty-minus"
            >
              <Minus size={20} weight="bold" />
            </Button>
            <Input
              id="qty-input"
              ref={inputRef}
              type="number"
              min={1}
              step="1"
              value={qty}
              onChange={(e) => setQty(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  confirm();
                } else if (e.key === "ArrowUp") {
                  e.preventDefault();
                  const cur = parseInt(qty || "0", 10);
                  setQty(String(Math.max(1, (isFinite(cur) ? cur : 0) + 1)));
                } else if (e.key === "ArrowDown") {
                  e.preventDefault();
                  const cur = parseInt(qty || "0", 10);
                  setQty(String(Math.max(1, (isFinite(cur) ? cur : 1) - 1)));
                }
              }}
              className={`h-14 flex-1 min-w-0 text-2xl font-mono-tight font-bold text-center ${
                overMax ? "border-red-500 text-red-600" : ""
              }`}
              data-testid="qty-input"
            />
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                const cur = parseInt(qty || "0", 10);
                const next = Math.max(1, (isFinite(cur) ? cur : 0) + 1);
                setQty(String(next));
              }}
              className="h-14 w-14 shrink-0 text-xl"
              aria-label="Aumenta di 1"
              data-testid="qty-plus"
            >
              <Plus size={20} weight="bold" />
            </Button>
          </div>
          {overMax && (
            <div className="text-xs text-red-600 mt-2 font-semibold" data-testid="qty-over-max">
              🔴 GIACENZA INSUFFICIENTE — disponibili {maxAvailable}
            </div>
          )}
        </div>
        <div className="mt-5 flex gap-2 justify-end">
          <Button variant="outline" onClick={onClose} className="h-11" data-testid="qty-cancel">
            Annulla
          </Button>
          <Button
            onClick={confirm}
            disabled={!canConfirm}
            className={`h-11 text-white ${ctaClass}`}
            data-testid="qty-confirm"
          >
            {confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}
