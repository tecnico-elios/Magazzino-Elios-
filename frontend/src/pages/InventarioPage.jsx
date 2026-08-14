import { useMemo, useState } from "react";
import { useInventoryCtx } from "../lib/InventoryContext";
import { Input } from "../components/ui/input";
import { Badge } from "../components/ui/badge";
import { MagnifyingGlass, Package } from "@phosphor-icons/react";

/**
 * InventarioPage — read-only live view of Notion Inventario stock.
 * Free-text search over name/code/category. Configuration of "Tipo Gestione"
 * (A Quantità / A Seriale) will move here in F5.
 */
export default function InventarioPage() {
  const { items, loading, error } = useInventoryCtx();
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return items;
    return items.filter(
      (it) =>
        (it.name || "").toLowerCase().includes(q) ||
        (it.code || "").toLowerCase().includes(q) ||
        (it.category || "").toLowerCase().includes(q)
    );
  }, [items, query]);

  return (
    <div
      className="max-w-7xl mx-auto px-4 sm:px-6 py-6 sm:py-8 space-y-4"
      data-testid="inventario-page"
    >
      <div>
        <h1 className="font-display text-3xl sm:text-4xl font-bold text-slate-900">
          Inventario
        </h1>
        <p className="text-slate-500 mt-1 text-sm">
          Stock live da Notion — {items.length} prodotti · Notion è l'unica
          fonte di verità.
        </p>
      </div>

      <div className="relative max-w-md">
        <MagnifyingGlass
          size={18}
          className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none"
        />
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Cerca per nome, codice o categoria…"
          className="pl-10 h-11"
          data-testid="inventario-search"
          autoComplete="off"
        />
      </div>

      {error && (
        <div className="border border-red-200 bg-red-50 text-red-700 p-4 rounded-md text-sm">
          {error}
        </div>
      )}

      {loading && !items.length ? (
        <div className="text-slate-500 py-12 text-center text-sm">
          Caricamento inventario Notion…
        </div>
      ) : (
        <div className="bg-white border border-slate-200 rounded-md overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm" data-testid="inventario-table">
              <thead className="bg-slate-50 border-b border-slate-200">
                <tr>
                  <th className="text-left px-4 py-3 font-semibold text-slate-600 text-xs uppercase tracking-wider">
                    Prodotto
                  </th>
                  <th className="text-left px-4 py-3 font-semibold text-slate-600 text-xs uppercase tracking-wider">
                    Codice
                  </th>
                  <th className="text-left px-4 py-3 font-semibold text-slate-600 text-xs uppercase tracking-wider hidden sm:table-cell">
                    Categoria
                  </th>
                  <th className="text-right px-4 py-3 font-semibold text-slate-600 text-xs uppercase tracking-wider">
                    Quantità
                  </th>
                  <th className="text-center px-4 py-3 font-semibold text-slate-600 text-xs uppercase tracking-wider">
                    Gestione
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filtered.length === 0 ? (
                  <tr>
                    <td
                      colSpan="5"
                      className="text-center py-10 text-slate-400 text-sm"
                    >
                      Nessun prodotto corrisponde ai criteri di ricerca.
                    </td>
                  </tr>
                ) : (
                  filtered.map((it) => {
                    const qty = Number(it.quantity) || 0;
                    const zero = qty <= 0;
                    return (
                      <tr
                        key={it.id}
                        data-testid={`inv-row-${it.id}`}
                        className="hover:bg-slate-50"
                      >
                        <td className="px-4 py-3 font-medium text-slate-900">
                          <div className="flex items-center gap-2">
                            <Package
                              size={14}
                              className="text-slate-400 shrink-0"
                            />
                            <span>{it.name}</span>
                          </div>
                        </td>
                        <td className="px-4 py-3 font-mono-tight text-xs text-slate-500">
                          {it.code || "—"}
                        </td>
                        <td className="px-4 py-3 text-slate-500 hidden sm:table-cell">
                          {it.category || "—"}
                        </td>
                        <td
                          className={`px-4 py-3 text-right font-mono-tight font-semibold ${
                            zero ? "text-red-600" : "text-slate-900"
                          }`}
                        >
                          {qty}{" "}
                          <span className="text-slate-400 text-xs font-normal">
                            {it.unit || "pz"}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-center">
                          {it.serialized ? (
                            <Badge
                              variant="outline"
                              className="border-amber-300 text-amber-800 bg-amber-50"
                            >
                              A Seriale
                            </Badge>
                          ) : (
                            <Badge
                              variant="outline"
                              className="border-slate-300 text-slate-600"
                            >
                              A Quantità
                            </Badge>
                          )}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="text-xs text-slate-400 text-center pt-2">
        La ricerca per barcode/QR/seriale con conferma live su Notion è
        disponibile in Arrivi e Spedizioni.
      </div>
    </div>
  );
}
