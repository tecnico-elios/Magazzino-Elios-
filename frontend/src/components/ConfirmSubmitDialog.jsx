import { Warning, CircleNotch, X } from "@phosphor-icons/react";
import { Button } from "./ui/button";

/**
 * ConfirmSubmitDialog — final safety step before writing to Notion / sending email.
 * Renders a faithful summary of what will be persisted. The parent triggers this
 * dialog on the first "Confirm" click; only the dialog's own confirm button runs
 * the real submit. Cancel closes the dialog and preserves the temp list.
 *
 * Props:
 *   open       — visibility
 *   kind       — "arrivo" | "spedizione"
 *   items      — [{name, tipo_gestione, serialized, quantity, unit, serials[], code}]
 *   meta       — [{label, value}] for header fields (Cliente / Fornitore / Operatore …)
 *   submitting — disables buttons + shows spinner
 *   errorMsg   — inline error text (from last failed submit); cleared on retry
 *   onCancel   — closes dialog
 *   onConfirm  — runs the actual write
 */
export default function ConfirmSubmitDialog({
  open,
  kind = "arrivo",
  items = [],
  meta = [],
  submitting = false,
  errorMsg = null,
  onCancel,
  onConfirm,
}) {
  if (!open) return null;
  const isArrivo = kind === "arrivo";
  const title = isArrivo ? "Conferma arrivo" : "Conferma spedizione";
  const intro = isArrivo
    ? "Stai per registrare il seguente arrivo:"
    : "Stai per registrare la seguente spedizione:";
  const confirmLabel = isArrivo ? "Conferma Arrivo" : "Conferma Spedizione";
  const confirmClass = isArrivo
    ? "bg-emerald-600 hover:bg-emerald-700"
    : "bg-blue-600 hover:bg-blue-700";
  const totalPz = items.reduce((s, i) => s + (Number(i.quantity) || 0), 0);

  return (
    <div
      className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4 overflow-y-auto"
      role="dialog"
      aria-modal="true"
      data-testid="confirm-submit-dialog"
    >
      <div className="bg-white rounded-lg w-full max-w-lg shadow-xl my-8">
        <div className="px-5 py-4 border-b border-slate-200 flex items-start justify-between gap-3">
          <div className="flex items-start gap-2">
            <Warning size={22} weight="fill" className="text-amber-500 shrink-0 mt-0.5" />
            <div>
              <div className="font-display text-xl font-bold text-slate-900">
                {title}
              </div>
              <div className="text-sm text-slate-500 mt-0.5">{intro}</div>
            </div>
          </div>
          <button
            type="button"
            onClick={onCancel}
            disabled={submitting}
            className="text-slate-400 hover:text-slate-900 disabled:opacity-40"
            data-testid="confirm-close-btn"
            aria-label="Chiudi"
          >
            <X size={18} />
          </button>
        </div>

        <div className="px-5 py-4 space-y-4 max-h-[60vh] overflow-y-auto">
          {/* Products */}
          <div className="space-y-3" data-testid="confirm-items">
            {items.map((it, idx) => (
              <div
                key={`${it.name}-${idx}`}
                className="border border-slate-200 rounded-md p-3"
                data-testid={`confirm-item-${idx}`}
              >
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <div className="font-semibold text-slate-900">{it.name}</div>
                  {it.serialized ? (
                    <span className="text-[10px] uppercase tracking-wider font-bold px-2 py-0.5 rounded bg-amber-50 text-amber-800 border border-amber-200">
                      A Seriale
                    </span>
                  ) : (
                    <span className="text-[10px] uppercase tracking-wider font-bold px-2 py-0.5 rounded bg-slate-100 text-slate-700 border border-slate-200">
                      A Quantità
                    </span>
                  )}
                </div>
                {it.code && !it.serialized && (
                  <div className="text-xs text-slate-500 mt-1 font-mono-tight">
                    Codice: {it.code}
                  </div>
                )}
                <div className="text-sm text-slate-700 mt-1">
                  Quantità:{" "}
                  <span className="font-mono-tight font-semibold text-slate-900">
                    {it.quantity} {it.unit || "pz"}
                  </span>
                </div>
                {it.serialized && Array.isArray(it.serials) && it.serials.length > 0 && (
                  <div className="mt-2">
                    <div className="text-[10px] uppercase tracking-wider font-semibold text-slate-500 mb-1">
                      Seriali
                    </div>
                    <ul className="text-xs font-mono-tight text-slate-800 space-y-0.5">
                      {it.serials.map((sn) => (
                        <li key={sn} data-testid={`confirm-sn-${sn}`}>
                          • {sn}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            ))}
          </div>

          {/* Meta fields */}
          {meta.length > 0 && (
            <div className="border-t border-slate-200 pt-4 space-y-1 text-sm">
              {meta.map((m) => (
                <div key={m.label} className="flex justify-between gap-3">
                  <span className="text-slate-500 uppercase tracking-wider text-[10px] font-semibold self-center">
                    {m.label}
                  </span>
                  <span className="text-slate-900 font-semibold text-right">
                    {m.value || "—"}
                  </span>
                </div>
              ))}
              <div className="flex justify-between pt-2 border-t border-slate-100 mt-2">
                <span className="text-slate-500 uppercase tracking-wider text-[10px] font-semibold self-center">
                  Totale
                </span>
                <span className="text-slate-900 font-mono-tight font-bold">
                  {totalPz} pz · {items.length}{" "}
                  {items.length === 1 ? "prodotto" : "prodotti"}
                </span>
              </div>
            </div>
          )}

          {errorMsg && (
            <div
              className="border border-red-200 bg-red-50 text-red-800 rounded-md p-3 text-sm"
              data-testid="confirm-error"
            >
              {errorMsg}
            </div>
          )}

          <div className="text-sm text-slate-700 font-semibold text-center pt-1">
            {isArrivo
              ? "Sei sicuro di voler registrare questo arrivo?"
              : "Sei sicuro di voler confermare questa spedizione?"}
          </div>
        </div>

        <div className="px-5 py-4 border-t border-slate-200 flex gap-2 justify-end">
          <Button
            type="button"
            variant="outline"
            onClick={onCancel}
            disabled={submitting}
            className="h-11 min-w-[100px]"
            data-testid="confirm-cancel-btn"
          >
            Annulla
          </Button>
          <Button
            type="button"
            onClick={onConfirm}
            disabled={submitting}
            className={`h-11 min-w-[180px] text-white ${confirmClass}`}
            data-testid="confirm-submit-btn"
          >
            {submitting ? (
              <>
                <CircleNotch size={16} className="mr-2 animate-spin" />
                {isArrivo ? "Registrazione…" : "Invio in corso…"}
              </>
            ) : (
              confirmLabel
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}
