import { ArrowsClockwise } from "@phosphor-icons/react";

/**
 * MovimentiPage — placeholder until F4.
 * Will aggregate Entrate (Consegne) + Uscite (Tracker) as a single time-ordered
 * feed, without duplicating data locally.
 */
export default function MovimentiPage() {
  return (
    <div
      className="max-w-2xl mx-auto px-6 py-16 text-center"
      data-testid="movimenti-page"
    >
      <div className="inline-flex w-20 h-20 rounded-full bg-indigo-100 items-center justify-center mb-4">
        <ArrowsClockwise size={40} weight="bold" className="text-indigo-700" />
      </div>
      <h1 className="font-display text-3xl font-bold text-slate-900">
        Movimenti
      </h1>
      <p className="text-slate-500 mt-2">
        Timeline unica di Arrivi e Spedizioni letta da Notion.
      </p>
      <div className="mt-6 bg-indigo-50 border border-indigo-200 rounded-md p-5 text-left text-indigo-900 text-sm">
        <div className="font-semibold uppercase tracking-wider text-xs text-indigo-800 mb-2">
          In arrivo con la fase F4
        </div>
        Visualizzazione aggregata di Consegne/Entrate e Spedizioni/Uscite con
        filtri per data, prodotto, cliente, fornitore, operatore. Nessuna
        duplicazione dei dati: sempre letta live da Notion.
      </div>
    </div>
  );
}
