import { useEffect, useRef, useState } from "react";
import axios from "axios";
import { Input } from "./ui/input";
import { Button } from "./ui/button";
import { CheckCircle, Warning, X, Plus, Minus, Trash, Camera } from "@phosphor-icons/react";
import { toast } from "sonner";
import BarcodeScanner from "./BarcodeScanner";

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

// Cache impostazioni beep — letta una sola volta al primo render di un collector.
// Il client la aggiorna quando l'admin salva le impostazioni.
let _cachedSoundEnabled = null;
async function isBeepEnabled() {
  if (_cachedSoundEnabled !== null) return _cachedSoundEnabled;
  try {
    const { data } = await axios.get(`${API}/settings`);
    _cachedSoundEnabled = !!data?.scanner?.sound_enabled;
  } catch {
    _cachedSoundEnabled = false;
  }
  return _cachedSoundEnabled;
}
// Reset cache quando l'admin salva impostazioni (evento globale opzionale)
if (typeof window !== "undefined") {
  window.addEventListener("elios:settings-changed", () => { _cachedSoundEnabled = null; });
}

// Beep breve via WebAudio — nessun asset esterno, nessun import extra.
let _audioCtx = null;
function playBeep(frequency = 880, durationMs = 100) {
  try {
    if (!_audioCtx) {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return;
      _audioCtx = new Ctx();
    }
    if (_audioCtx.state === "suspended") _audioCtx.resume();
    const osc = _audioCtx.createOscillator();
    const gain = _audioCtx.createGain();
    osc.frequency.value = frequency;
    osc.type = "sine";
    gain.gain.setValueAtTime(0.001, _audioCtx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.2, _audioCtx.currentTime + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, _audioCtx.currentTime + durationMs / 1000);
    osc.connect(gain).connect(_audioCtx.destination);
    osc.start();
    osc.stop(_audioCtx.currentTime + durationMs / 1000 + 0.02);
  } catch { /* silent */ }
}

/**
 * SerialCollector — inserimento di N seriali per un prodotto A Seriale.
 *
 * Comportamento:
 *  - NESSUN pulsante "Cerca" per riga: la validazione parte automaticamente
 *    su ENTER (tastiera / scanner fisico Bluetooth/USB) o dopo la scansione
 *    con la fotocamera del dispositivo (pulsante 📷 per riga).
 *  - La logica di validazione è identica alla F6 (endpoint /api/inventory/lookup)
 *    e alle regole per Arrivi/Spedizioni.
 *  - Focus automatico: dopo una validazione OK il focus salta al primo campo
 *    vuoto successivo.
 */
export default function SerialCollector({ pending, mode, existingSerials = [], onChange, onCommit, onCancel }) {
  const refs = useRef([]);
  const [validations, setValidations] = useState({}); // idx -> {state, message}
  const [cameraFor, setCameraFor] = useState(null); // idx della riga per cui è aperta la camera
  const debouncersRef = useRef({}); // idx -> timeout id (auto-validate)

  useEffect(() => {
    const firstEmpty = pending.serials.findIndex((s) => !s || !s.trim());
    const target = firstEmpty === -1 ? 0 : firstEmpty;
    setTimeout(() => refs.current[target]?.focus(), 30);
  }, [pending.id, pending.quantity]);

  // Cleanup dei debouncer al unmount
  useEffect(() => () => {
    Object.values(debouncersRef.current).forEach((t) => clearTimeout(t));
  }, []);

  const setSerial = (idx, val) => {
    const next = { ...pending, serials: pending.serials.map((s, i) => (i === idx ? val : s)) };
    onChange(next);
    if (!val || !val.trim()) {
      setValidations((v) => ({ ...v, [idx]: { state: "idle" } }));
      if (debouncersRef.current[idx]) { clearTimeout(debouncersRef.current[idx]); delete debouncersRef.current[idx]; }
      return;
    }
    // Arrivi: nessuna validazione — il seriale può essere nuovo e qualsiasi.
    // Verrà registrato su Notion solo con CONFERMA ARRIVO.
    if (mode === "arrivi") return;
    // Spedizioni: auto-validate dopo 500ms di inattività (F6 lookup su cache)
    if (debouncersRef.current[idx]) clearTimeout(debouncersRef.current[idx]);
    const capturedValue = val;
    debouncersRef.current[idx] = setTimeout(() => {
      validateOne(idx, capturedValue);
    }, 500);
  };

  const changeQty = (delta) => {
    const newQ = Math.max(1, pending.quantity + delta);
    if (newQ === pending.quantity) return;
    if (newQ < pending.quantity) {
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
    for (let j = idx + 1; j < pending.quantity; j++) {
      if (!(pending.serials[j] || "").trim()) {
        refs.current[j]?.focus();
        return true;
      }
    }
    refs.current[idx]?.blur();
    return false;
  };

  const validateOne = async (idx, overrideValue = null) => {
    const value = (overrideValue ?? pending.serials[idx] ?? "").toString().trim();
    if (!value) return;
    // Duplicati nel collector corrente
    const dupInCollector = pending.serials
      .map((s, i) => ({ s: (i === idx ? value : (s || "")).trim(), i }))
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
        if (data.status === "in_warehouse") {
          setValidations((v) => ({ ...v, [idx]: { state: "error", message: "Già presente in magazzino" } }));
          return;
        }
        setValidations((v) => ({
          ...v,
          [idx]: {
            state: "ok",
            message: data.status === "unseen" ? "Seriale nuovo — verrà creato in Notion" : "Rientro riconosciuto",
          },
        }));
        isBeepEnabled().then((on) => on && playBeep());
        focusNext(idx);
        return;
      }
      // Spedizioni
      if (data.status === "in_warehouse") {
        setValidations((v) => ({ ...v, [idx]: { state: "ok", message: "Presente in Entrate — pronto" } }));
        isBeepEnabled().then((on) => on && playBeep());
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

  const onCameraDetected = (idx, code) => {
    const value = (code || "").toString().trim();
    setCameraFor(null);
    if (!value) return;
    // Aggiorna il valore e valida immediatamente con la stessa pipeline (solo Spedizioni).
    // In Arrivi il seriale viene solo scritto nel campo — la validazione live è disattivata.
    setSerial(idx, value);
    if (mode !== "arrivi") validateOne(idx, value);
  };

  const allValid = () => {
    if (pending.serials.length !== pending.quantity) return false;
    // Arrivi: basta che tutti i seriali siano non vuoti — nessuna validazione richiesta.
    if (mode === "arrivi") {
      return pending.serials.every((s) => (s || "").trim().length > 0);
    }
    // Spedizioni: mantiene la validazione live F6 su ogni seriale.
    return pending.serials.every((s, i) => (s || "").trim() && validations[i]?.state === "ok");
  };

  const emitRefocus = () => {
    try { window.dispatchEvent(new Event("elios:refocus-scanner")); } catch { /* silent */ }
  };

  const handleCancel = () => {
    onCancel?.();
    emitRefocus();
  };

  const submit = () => {
    if (!allValid()) {
      toast.error("Completa e valida tutti i seriali prima di continuare");
      return;
    }
    const dedup = new Set(pending.serials.map((s) => s.trim()));
    if (dedup.size !== pending.serials.length) {
      toast.error("Sono presenti seriali duplicati");
      return;
    }
    onCommit(pending);
    emitRefocus();
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
          <div className="font-display text-lg sm:text-xl font-bold text-slate-900 mt-0.5 break-words" data-testid="collector-name">
            {pending.name}
          </div>
        </div>
        <div className="flex items-center gap-1 flex-wrap">
          <span className="text-xs text-slate-500 mr-2">Quantità</span>
          <Button type="button" variant="outline" size="icon" className="h-11 w-11" onClick={() => changeQty(-1)}
            disabled={pending.quantity <= 1} data-testid="collector-qty-minus">
            <Minus size={14} />
          </Button>
          <div className="h-11 min-w-[3rem] px-3 border border-slate-200 rounded-md grid place-items-center font-mono-tight font-bold" data-testid="collector-qty">
            {pending.quantity}
          </div>
          <Button type="button" variant="outline" size="icon" className="h-11 w-11" onClick={() => changeQty(1)}
            data-testid="collector-qty-plus">
            <Plus size={14} />
          </Button>
          <Button type="button" variant="outline" onClick={handleCancel} className="ml-2 h-11 border-red-300 text-red-600 hover:bg-red-50" data-testid="collector-cancel">
            <X size={14} className="mr-1" /> Annulla
          </Button>
        </div>
      </div>

      <ul className="space-y-2" data-testid="collector-rows">
        {pending.serials.map((sn, idx) => {
          const v = validations[idx] || { state: "idle" };
          return (
            <li key={idx} className="flex items-center gap-2 flex-wrap sm:flex-nowrap" data-testid={`collector-row-${idx}`}>
              <div className="w-full sm:w-20 shrink-0 text-xs uppercase tracking-wider text-slate-500 font-semibold">
                Seriale {idx + 1}
              </div>
              <div className="flex-1 min-w-0 relative">
                <Input
                  ref={(el) => (refs.current[idx] = el)}
                  value={sn}
                  onChange={(e) => setSerial(idx, e.target.value)}
                  onBlur={() => {
                    if (mode === "arrivi") return; // Arrivi: nessuna validazione
                    if ((sn || "").trim() && v.state !== "ok" && v.state !== "checking") {
                      if (debouncersRef.current[idx]) clearTimeout(debouncersRef.current[idx]);
                      validateOne(idx);
                    }
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      if (mode === "arrivi") return; // Arrivi: Enter non triggera lookup (seriale libero)
                      if (debouncersRef.current[idx]) clearTimeout(debouncersRef.current[idx]);
                      validateOne(idx);
                    }
                  }}
                  placeholder="Digita o scansiona il seriale (ENTER per validare)"
                  className={`h-11 font-mono-tight pr-9 ${
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
                {v.state === "checking" && (
                  <span className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 text-xs">…</span>
                )}
              </div>
              <Button
                type="button"
                variant="outline"
                size="icon"
                onClick={() => setCameraFor(idx)}
                className="h-11 w-11 shrink-0"
                data-testid={`collector-camera-${idx}`}
                aria-label={`Apri fotocamera per seriale ${idx + 1}`}
                title="Apri fotocamera"
              >
                <Camera size={16} />
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
            <div key={idx} className={`text-xs sm:pl-20 ${v.state === "ok" ? "text-emerald-700" : "text-red-600"}`}>
              <strong>Seriale {idx + 1}:</strong> {v.message}
            </div>
          );
        })}
      </div>

      <div className="flex items-center justify-between gap-2 pt-2 border-t border-slate-100 flex-wrap">
        <div className="text-xs text-slate-500">
          {pending.serials.filter((s) => (s || "").trim()).length} / {pending.quantity} inseriti ·{" "}
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

      <BarcodeScanner
        open={cameraFor !== null}
        onClose={() => setCameraFor(null)}
        onDetected={(code) => onCameraDetected(cameraFor, code)}
        label={cameraFor !== null ? `Inquadra il barcode/QR del seriale ${cameraFor + 1}` : ""}
      />
    </section>
  );
}
