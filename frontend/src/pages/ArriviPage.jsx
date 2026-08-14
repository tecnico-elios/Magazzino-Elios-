import { Link } from "react-router-dom";
import { ArrowSquareIn, ArrowRight } from "@phosphor-icons/react";

/**
 * ArriviPage — placeholder until F2.
 * We keep the route reachable so navigation feels complete; the real screen
 * will be built in F2 with scan-driven flow and Notion writes to Consegne/Entrate.
 */
export default function ArriviPage() {
  return (
    <div
      className="max-w-2xl mx-auto px-6 py-16 text-center"
      data-testid="arrivi-page"
    >
      <div className="inline-flex w-20 h-20 rounded-full bg-emerald-100 items-center justify-center mb-4">
        <ArrowSquareIn size={40} weight="bold" className="text-emerald-700" />
      </div>
      <h1 className="font-display text-3xl font-bold text-slate-900">
        Arrivi
      </h1>
      <p className="text-slate-500 mt-2">
        Registrazione ingressi materiali su Consegne Wallbox / Entrate.
      </p>
      <div className="mt-6 bg-emerald-50 border border-emerald-200 rounded-md p-5 text-left text-emerald-900 text-sm">
        <div className="font-semibold uppercase tracking-wider text-xs text-emerald-800 mb-2">
          In arrivo con la fase F2
        </div>
        Scansione rapida barcode / QR / seriale, campo Fornitore o Mittente
        (usato solo per l'email — non salvato su Notion), controllo duplicati
        seriali, conferma live su Notion e email automatica ai destinatari.
      </div>
      <Link
        to="/spedizioni"
        data-testid="arrivi-goto-spedizioni"
        className="inline-flex items-center gap-1 mt-6 h-11 px-5 border border-slate-300 rounded-md text-slate-700 hover:text-slate-900 hover:border-slate-400 font-semibold"
      >
        Vai a Spedizioni <ArrowRight size={16} />
      </Link>
    </div>
  );
}
