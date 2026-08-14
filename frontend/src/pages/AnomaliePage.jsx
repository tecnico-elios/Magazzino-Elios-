import { Warning } from "@phosphor-icons/react";

/**
 * AnomaliePage — placeholder until F4.
 * Will register: codici sconosciuti, seriali inesistenti/duplicati/già usciti,
 * giacenza insufficiente, conflitti multi-utente, errori API/sincronizzazione.
 */
export default function AnomaliePage() {
  return (
    <div
      className="max-w-2xl mx-auto px-6 py-16 text-center"
      data-testid="anomalie-page"
    >
      <div className="inline-flex w-20 h-20 rounded-full bg-amber-100 items-center justify-center mb-4">
        <Warning size={40} weight="bold" className="text-amber-700" />
      </div>
      <h1 className="font-display text-3xl font-bold text-slate-900">
        Anomalie
      </h1>
      <p className="text-slate-500 mt-2">
        Registro eventi bloccanti e conflitti operativi.
      </p>
      <div className="mt-6 bg-amber-50 border border-amber-200 rounded-md p-5 text-left text-amber-900 text-sm">
        <div className="font-semibold uppercase tracking-wider text-xs text-amber-800 mb-2">
          In arrivo con la fase F4
        </div>
        Traccia automaticamente: barcode/QR/codici sconosciuti, seriali
        inesistenti o già usciti, duplicati, giacenze insufficienti, conflitti
        multi-utente ed errori di sincronizzazione con Notion.
      </div>
    </div>
  );
}
