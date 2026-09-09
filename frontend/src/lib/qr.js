// F15 §10-15 — Parser universale QR Wallbox Daze.
// Accetta:
//   • QR con solo seriale (es. "26OT0400185")     → { serial, puk: null }
//   • QR JSON stile Daze (es. {serial:"...",puk:"..."})   → { serial, puk }
//   • QR JSON valido standard: '{"serial":"...","puk":"..."}' → { serial, puk }
// Restituisce sempre { serial, puk } — se il parsing fallisce ritorna
// { serial: <input trimmed>, puk: null } per non rompere i QR già funzionanti.

export function parseDazeQr(raw) {
  const value = (raw ?? "").toString().trim();
  if (!value) return { serial: "", puk: null };

  // Fast path: se non contiene "{" o "serial", trattalo come seriale puro
  if (!value.includes("{") && !/serial\s*:/i.test(value)) {
    return { serial: value, puk: null };
  }

  // 1° tentativo: JSON.parse standard
  try {
    const obj = JSON.parse(value);
    if (obj && typeof obj === "object") {
      const s = String(obj.serial ?? obj.SERIAL ?? "").trim();
      const p = String(obj.puk ?? obj.PUK ?? "").trim();
      if (s) return { serial: s, puk: p || null };
    }
  } catch { /* prova con regex sotto */ }

  // 2° tentativo: regex per JSON non-standard tipo {serial:"...",puk:"..."} senza virgolette sulle chiavi
  const mS = value.match(/serial\s*[:=]\s*["']?([A-Za-z0-9._\-\/]+)["']?/i);
  const mP = value.match(/puk\s*[:=]\s*["']?([A-Za-z0-9._\-\/]+)["']?/i);
  if (mS && mS[1]) {
    return { serial: mS[1].trim(), puk: (mP && mP[1]) ? mP[1].trim() : null };
  }

  // Fallback: mantieni il valore come seriale (non rompiamo i QR esistenti)
  return { serial: value, puk: null };
}
