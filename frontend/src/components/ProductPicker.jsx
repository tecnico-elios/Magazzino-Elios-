import { useEffect, useMemo, useRef, useState } from "react";
import { Input } from "./ui/input";
import { MagnifyingGlass, X } from "@phosphor-icons/react";

/**
 * ProductPicker — modal per selezionare un prodotto dinamicamente dalla cache
 * InventoryContext. Nessuna lista hardcoded. Search live su nome/codice/categoria.
 *
 * Props:
 *  - items: full inventory list
 *  - filter: "all" | "serialized" | "quantity"
 *  - onClose(): close without picking
 *  - onSelect(item): user picked
 *  - variant: optional "arrivi" | "spedizioni" for accent colors
 */
export default function ProductPicker({ items, filter = "all", onClose, onSelect }) {
  const [q, setQ] = useState("");
  const inputRef = useRef(null);

  useEffect(() => {
    setTimeout(() => inputRef.current?.focus(), 0);
  }, []);

  const filtered = useMemo(() => {
    const query = q.trim().toLowerCase();
    return items.filter((it) => {
      if (filter === "serialized" && !it.serialized) return false;
      if (filter === "quantity" && it.serialized) return false;
      if (!query) return true;
      return (
        (it.name || "").toLowerCase().includes(query) ||
        (it.code || "").toLowerCase().includes(query) ||
        (it.category || "").toLowerCase().includes(query)
      );
    });
  }, [items, filter, q]);

  const filterLabel =
    filter === "serialized"
      ? "(A Seriale)"
      : filter === "quantity"
      ? "(A Quantità)"
      : "";

  return (
    <div
      className="fixed inset-0 z-50 bg-black/50 flex items-start justify-center p-4"
      role="dialog"
      aria-modal="true"
      onClick={onClose}
      data-testid="product-picker"
    >
      <div
        className="bg-white rounded-lg w-full max-w-2xl mt-16 max-h-[70vh] flex flex-col shadow-xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="p-4 border-b border-slate-200 flex items-center gap-2">
          <div className="text-[10px] tracking-[0.2em] uppercase text-slate-500 font-semibold flex-1">
            Seleziona prodotto {filterLabel}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-slate-500 hover:text-slate-900 p-1"
            aria-label="Chiudi"
            data-testid="picker-close"
          >
            <X size={18} />
          </button>
        </div>
        <div className="p-4 border-b border-slate-100">
          <div className="relative">
            <MagnifyingGlass
              size={18}
              className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none"
            />
            <Input
              ref={inputRef}
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Cerca per nome, codice o categoria…"
              className="pl-10 h-11"
              autoComplete="off"
              data-testid="picker-search"
            />
          </div>
        </div>
        <div className="flex-1 overflow-y-auto divide-y divide-slate-100">
          {filtered.length === 0 ? (
            <div className="p-8 text-center text-slate-400 text-sm">
              Nessun prodotto{filterLabel && ` ${filterLabel.toLowerCase()}`} trovato.
            </div>
          ) : (
            filtered.map((it) => (
              <button
                key={it.id}
                type="button"
                onClick={() => onSelect(it)}
                className="w-full text-left px-4 py-3 hover:bg-slate-50 flex items-center justify-between"
                data-testid={`picker-item-${it.id}`}
              >
                <div className="min-w-0">
                  <div className="font-semibold text-slate-900">{it.name}</div>
                  <div className="text-xs text-slate-500 font-mono-tight">
                    {it.code || "—"} · {it.category || "—"}
                  </div>
                </div>
                <div className="text-right shrink-0 ml-3">
                  <div className="font-mono-tight font-semibold text-slate-900">
                    {it.quantity ?? 0} {it.unit || "pz"}
                  </div>
                  <div className="text-[10px] text-slate-400">
                    {it.serialized ? "A Seriale" : "A Quantità"}
                  </div>
                </div>
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
