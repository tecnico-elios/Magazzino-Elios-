import { useEffect, useRef, useState } from "react";
import axios from "axios";
import { Input } from "./ui/input";
import { Button } from "./ui/button";
import { Badge } from "./ui/badge";
import { MagnifyingGlass, CheckCircle, Warning, X, Plus, Minus, Trash } from "@phosphor-icons/react";
import { toast } from "sonner";

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

/**
 * SerialCollector — inserimento di N seriali per un prodotto A Seriale.
 *
 * Props:
 *  - pending: { id, name, quantity, serials[] }  (serials pre-allocati "" o valorizzati)
 *  - mode: "arrivi" | "spedizioni"
 *  - existingSerials: string[]  — seriali già presenti in altre righe della lista
 *  - onChange(pending): aggiorna serials/quantity
 *  - onCommit(pending): tutti validi → aggiungi alla lista
 *  - onCancel(): abbandona
 */
export default function SerialCollector({ pending, mode, existingSerials = [], onChange, onCommit, onCancel }) {
  const refs = useRef([]);
  const [validations, setValidations] = useState({}); // idx -> {state: idle|checking|ok|error, message}

  useEffect(() => {
    // focus la prima riga vuota
    const firstEmpty = pending.serials.findIndex((s) => !s || !s.trim());
    const target = firstEmpty === -1 ? 0 : firstEmpty;
    setTimeout(() => refs.current[target]?.focus(), 30);
  }, [pending.id, pending.quantity]);

  const setSerial = (idx, val) => {
    const next = { ...pending, serials: pending.serials.map((s, i) => (i === idx ? val : s)) };
    onChange(next);
    if (!val || !val.trim()) setValidations((v) => ({ ...v, [idx]: { state: "idle" } }));
  };

  const changeQty = (delta) => {
    const newQ = Math.max(1, pending.quantity + delta);
    if (newQ === pending.quantity) return;
    if (newQ < pending.quantity) {
      // Rimuovi righe eccedenti solo se vuote — altrimenti chiedi conferma
      const toRemove = pending.quantity - newQ;
      const nonEmptyTail = pending.serials.slice(newQ).filter((s) => (s || "").trim());
      if (nonEmptyTail.length > 0) {
        if (!window.confirm(`Vuoi rimuovere ${toRemove} riga/righe? Alcuni seriali già inseriti verranno eliminati.`)) {
          return;
        }
      }
      onChange({ ...pending, quantity: newQ, serials: pending.serials.slice(0, newQ) });
    } else {
      const add = newQ - pending.quantity;
      onChange({ ...pending, quantity: newQ, serials: [...pending.serials, ...Array(add).fill("")] });
    }
  };

  const focusNext = (idx) => {
    // trova primo campo vuoto dopo idx
    for (let j = idx + 1; j < pending.quantity; j++) {
      if (!(pending.serials[j] || "").trim()) {
        refs.current[j]?.focus();
        return true;
      }
    }
    // se tutti pieni, focus fuori
    refs.current[idx]?.blur();
    return false;
  };

  const validateOne = async (idx) => {
    const value = (pending.serials[idx] || "").trim();
    if (!value) return;
    // Duplicati nel collector
    const dupInCollector = pending.serials
      .map((s, i) => ({ s: (s || "").trim(), i }))
      .filter((x) => x.s === value && x.i !== idx).length > 0;
    if (dupInCollector) {
      setValidations((v) => ({ ...v, [idx]: { state: "error", message: "Duplicato in questa lista" } }));
      return;
    }
    // Duplicati in altre righe già confermate
    if (existingSerials.map((x) => (x || "").toLowerCase()).includes(value.toLowerCase())) {
      setValidations((v) => ({ ...v, [idx]: { state: "error", message: "Già presente nella lista temporanea" } }));
      return;
    }
    setValidations((v) => ({ ...v, [idx]: { state: "checking" } }));
    try {
      const { data } = await axios.get(`${API}/inventory/lookup`, { params: { code: value } });
      if (mode === "arrivi") {
        // Regola arrivi: SN NON deve essere in magazzino (già entrato)
        if (data.status === "in_warehouse") {
          setValidations((v) => ({ ...v, [idx]: { state: "error", message: "Già presente in magazzino" } }));
          return;
        }
        // Ok se unseen o out (rientro) — per unseen (nuovo) NON bloccare
        setValidations((v) => ({
          ...v,
          [idx]: {
            state: "ok",
            message: data.status === "unseen" ? "Seriale nuovo — verrà creato in Notion" : "Rientro riconosciuto",
          },
        }));
        focusNext(idx);
        return;
      }
      // Spedizioni: SN DEVE essere in magazzino (in_warehouse)
      if (data.status === "in_warehouse") {
        setValidations((v) => ({ ...v, [idx]: { state: "ok", message: "Presente in Entrate — pronto" } }));
        focusNext(idx);
      } else if (data.status === "out") {
        setValidations((v) => ({ ...v, [idx]: { state: "error", message: "Già uscito in una spedizione precedente" } }));
      } else {
        setValidations((v) => ({ ...v, [idx]: { state: "error", message: "Mai entrato in magazzino" } }));
      }
    } catch (e) {
      setValidations((v) => ({ ...v, [idx]: { state: "error", message: "Errore verifica Notion" } }));
    }
  };

  const allValid = () =>
    pending.serials.every((s, i) => (s || "").trim() && validations[i]?.state === "ok") &&
    pending.serials.length === pending.quantity;

  const submit = () => {
    if (!allValid()) {
      toast.error("Completa e valida tutti i seriali prima di continuare");
      return;
    }
    // controllo finale duplicati
    const dedup = new Set(pending.serials.map((s) => s.trim()));
    if (dedup.size !== pending.serials.length) {
      toast.error("Sono presenti seriali duplicati");
      return;
    }
    onCommit(pending);
  };

  const badgeMode = mode === "spedizioni"
    ? "bg-blue-600 hover:bg-blue-700"
    : "bg-emerald-600 hover:bg-emerald-700";

  return (
    <section
      className="bg-white border border-slate-200 rounded-md p-4 space-y-3"
      data-testid="serial-collector"
    >
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          <div className="text-[10px] tracking-[0.2em] uppercase text-slate-500 font-semibold">
            Prodotto A Seriale
          </div>
          <div className="font-display text-xl font-bold text-slate-900 mt-0.5" data-testid="collector-name">
            {pending.name}
          </div>
        </div>
        <div className="flex items-center gap-1">
          <span className="text-xs text-slate-500 mr-2">Quantità</span>
          <Button type="button" variant="outline" size="icon" className="h-9 w-9" onClick={() => changeQty(-1)}
            disabled={pending.quantity <= 1} data-testid="collector-qty-minus">
            <Minus size={14} />
          </Button>
          <div className="h-9 min-w-[3rem] px-3 border border-slate-200 rounded-md grid place-items-center font-mono-tight font-bold" data-testid="collector-qty">
            {pending.quantity}
          </div>
          <Button type="button" variant="outline" size="icon" className="h-9 w-9" onClick={() => changeQty(1)}
            data-testid="collector-qty-plus">
            <Plus size={14} />
          </Button>
          <Button type="button" variant="outline" onClick={onCancel} className="ml-2 h-9 border-red-300 text-red-600 hover:bg-red-50" data-testid="collector-cancel">
            <X size={14} className="mr-1" /> Annulla
          </Button>
        </div>
      </div>

      <ul className="space-y-2" data-testid="collector-rows">
        {pending.serials.map((sn, idx) => {
          const v = validations[idx] || { state: "idle" };
          return (
            <li key={idx} className="flex items-center gap-2" data-testid={`collector-row-${idx}`}>
              <div className="w-16 shrink-0 text-xs uppercase tracking-wider text-slate-500 font-semibold">
                Seriale {idx + 1}
              </div>
              <div className="flex-1 relative">
                <Input
                  ref={(el) => (refs.current[idx] = el)}
                  value={sn}
                  onChange={(e) => setSerial(idx, e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      validateOne(idx);
                    }
                  }}
                  placeholder="Inserisci o scansiona il seriale"
                  className={`h-11 font-mono-tight pr-10 ${
                    v.state === "ok" ? "border-emerald-400 bg-emerald-50/40" :
                    v.state === "error" ? "border-red-400 bg-red-50/40" : ""
                  }`}
                  data-testid={`collector-input-${idx}`}
                  autoComplete="off"
                />
                {v.state === "ok" && (
                  <CheckCircle size={18} weight="fill" className="absolute right-2 top-1/2 -translate-y-1/2 text-emerald-600 pointer-events-none" />
                )}
                {v.state === "error" && (
                  <Warning size={18} weight="fill" className="absolute right-2 top-1/2 -translate-y-1/2 text-red-600 pointer-events-none" />
                )}
              </div>
              <Button
                type="button"
                variant="outline"
                onClick={() => validateOne(idx)}
                disabled={!sn || !sn.trim() || v.state === "checking"}
                className="h-11 shrink-0"
                data-testid={`collector-search-${idx}`}
              >
                <MagnifyingGlass size={14} className="mr-1" />
                {v.state === "checking" ? "…" : "Cerca"}
              </Button>
              {sn && sn.trim() && (
                <Button type="button" variant="outline" size="icon"
                  onClick={() => { setSerial(idx, ""); setValidations((vv) => ({ ...vv, [idx]: { state: "idle" } })); refs.current[idx]?.focus(); }}
                  className="h-11 w-11 shrink-0 border-slate-300 text-slate-500 hover:bg-slate-50"
                  data-testid={`collector-clear-${idx}`}
                  aria-label="Pulisci">
                  <Trash size={14} />
                </Button>
              )}
            </li>
          );
        })}
      </ul>

      {/* Messages */}
      <div className="space-y-1">
        {pending.serials.map((_, idx) => {
          const v = validations[idx];
          if (!v || v.state === "idle" || v.state === "checking") return null;
          return (
            <div key={idx} className={`text-xs pl-16 ${v.state === "ok" ? "text-emerald-700" : "text-red-600"}`}>
              <strong>Seriale {idx + 1}:</strong> {v.message}
            </div>
          );
        })}
      </div>

      <div className="flex items-center justify-between gap-2 pt-2 border-t border-slate-100">
        <div className="text-xs text-slate-500">
          {pending.serials.filter((s) => (s || "").trim()).length} / {pending.quantity} inseriti ·
          {" "}
          {Object.values(validations).filter((v) => v.state === "ok").length} validati
        </div>
        <Button
          type="button"
          onClick={submit}
          disabled={!allValid()}
          className={`h-11 text-white ${badgeMode}`}
          data-testid="collector-commit"
        >
          Aggiungi alla lista
        </Button>
      </div>
    </section>
  );
}
