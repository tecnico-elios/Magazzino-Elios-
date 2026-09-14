// F15 §10-15 — Parser universale QR Wallbox Daze + F22 (26/02/2026) — Normalizzazione QR URL.
// Accetta:
//   • QR con solo seriale (es. "26OT0400185")                    → { serial, puk: null }
//   • QR JSON stile Daze (es. {serial:"...",puk:"..."})          → { serial, puk }
//   • QR JSON valido standard: '{"serial":"...","puk":"..."}'    → { serial, puk }
// Restituisce sempre { serial, puk } — se il parsing fallisce ritorna
// { serial: <input trimmed>, puk: null } per non rompere i QR già funzionanti.

export function parseDazeQr(raw) {
  const value = (raw ?? "").toString().trim();
  if (!value) return { serial: "", puk: null };

  // Fast path: se non contiene "{" o "serial", trattalo come seriale puro (dopo normalizzazione URL)
  if (!value.includes("{") && !/serial\s*:/i.test(value)) {
    return { serial: normalizeQrCode(value), puk: null };
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
  return { serial: normalizeQrCode(value), puk: null };
}

// F22 (26/02/2026) — Estrae l'ID del QR da un URL Elios Tech.
// Esempi:
//   "https://qr.eliostech.it/webapp?qrCodeId=QRCODE_1119"       → "QRCODE_1119"
//   "https://qr.eliostech.it/webapp?qrCodeId=QRCODE_1119&x=1"   → "QRCODE_1119"
//   "http://qr.eliostech.it/?qrCodeId=QRCODE_1220"              → "QRCODE_1220"
//   "QRCODE_1119"                                               → "QRCODE_1119"
//   "26OT0400185"                                               → "26OT0400185" (invariato)
// Storico URL completi restano leggibili — ma qui vengono ricondotti all'ID puro.
export function normalizeQrCode(raw) {
  const value = (raw ?? "").toString().trim();
  if (!value) return "";
  // Tentativo 1: URL con parametro qrCodeId (case-insensitive)
  const m = value.match(/[?&]qr[cC]odeId=([^&\s]+)/i);
  if (m && m[1]) return decodeURIComponent(m[1]).trim();
  // Tentativo 2: se sembra un URL, estrai dalla query string in modo robusto
  if (/^https?:\/\//i.test(value)) {
    try {
      const u = new URL(value);
      // Cerca la chiave qrCodeId in qualunque case
      for (const [k, v] of u.searchParams.entries()) {
        if (k.toLowerCase() === "qrcodeid") return String(v).trim();
      }
    } catch { /* URL malformato — ricadi al valore raw */ }
  }
  // Nessun URL riconosciuto — ritorna il valore così com'è
  return value;
}
