// F29 — Format helpers per date italiane (GG/MM/AAAA).
// Uso: import { formatDateIT } from "../lib/dateFmt";
// Input: "2026-09-16" (ISO date) o Date. Output: "16/09/2026". "" se falsy.
export function formatDateIT(iso) {
  if (!iso) return "";
  try {
    if (iso instanceof Date) {
      const d = iso;
      return `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()}`;
    }
    const s = String(iso).trim();
    // ISO YYYY-MM-DD → parse manuale per evitare timezone shift
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
    if (m) return `${m[3]}/${m[2]}/${m[1]}`;
    // Fallback: datetime completo
    const d = new Date(s);
    if (isNaN(d.getTime())) return s;
    return `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()}`;
  } catch { return String(iso || ""); }
}
