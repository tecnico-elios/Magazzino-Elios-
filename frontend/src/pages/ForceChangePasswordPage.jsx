import { useState } from "react";
import { useNavigate } from "react-router-dom";
import axios from "axios";
import { useAuth } from "../lib/AuthContext";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { toast } from "sonner";
import { Eye, EyeSlash, Lock, ShieldWarning } from "@phosphor-icons/react";
import EliosLogo from "../components/EliosLogo";

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

function formatError(err) {
  const d = err?.response?.data?.detail;
  if (typeof d === "string") return d;
  if (Array.isArray(d)) return d.map((e) => e?.msg || JSON.stringify(e)).join(" • ");
  return err?.message || "Errore imprevisto";
}

/**
 * Pagina di cambio password obbligatorio al primo login.
 * L'utente è autenticato (must_change_password=true) ma non può usare il gestionale
 * finché non completa questa procedura. Reindirizzato qui automaticamente da AuthContext.
 */
export default function ForceChangePasswordPage() {
  const { user, applyRefreshedToken, refreshMe, logout } = useAuth();
  const navigate = useNavigate();
  const [oldPwd, setOldPwd] = useState("");
  const [newPwd, setNewPwd] = useState("");
  const [confirm, setConfirm] = useState("");
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    if (newPwd.length < 6) {
      toast.error("La nuova password deve avere almeno 6 caratteri");
      return;
    }
    if (newPwd !== confirm) {
      toast.error("Le password non coincidono");
      return;
    }
    if (newPwd === oldPwd) {
      toast.error("La nuova password deve essere diversa da quella temporanea");
      return;
    }
    setBusy(true);
    try {
      const { data } = await axios.post(`${API}/auth/change-my-password`, {
        old_password: oldPwd,
        new_password: newPwd,
      });
      if (data?.token && typeof applyRefreshedToken === "function") {
        applyRefreshedToken(data.token);
      }
      await refreshMe();
      toast.success("Password aggiornata — benvenuto!");
      navigate("/", { replace: true });
    } catch (err) {
      toast.error("Cambio password fallito", { description: formatError(err) });
    } finally {
      setBusy(false);
    }
  };

  const handleLogout = () => {
    logout();
    navigate("/login", { replace: true });
  };

  return (
    <div
      className="min-h-screen flex items-center justify-center p-4 relative bg-slate-950"
      data-testid="force-change-password-page"
    >
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          background:
            "radial-gradient(circle at 20% 20%, rgba(250,204,21,0.10), transparent 45%), radial-gradient(circle at 80% 80%, rgba(59,130,246,0.08), transparent 50%)",
        }}
      />
      <div className="relative w-full max-w-md rounded-xl bg-slate-900/60 border border-white/10 backdrop-blur-xl shadow-2xl shadow-black/50 p-6 sm:p-8">
        <div className="flex items-center gap-3 mb-6">
          <EliosLogo size={30} />
          <div>
            <div className="text-[10px] tracking-[0.22em] uppercase text-amber-300/80 font-semibold">
              Primo accesso
            </div>
            <div className="font-display text-lg font-bold text-white leading-tight">
              Imposta la tua password
            </div>
          </div>
        </div>

        <div className="flex items-start gap-2 rounded-md bg-amber-500/10 border border-amber-400/30 p-3 mb-4 text-amber-100 text-sm">
          <ShieldWarning size={20} className="shrink-0 text-amber-300 mt-0.5" />
          <div>
            Ciao <strong>{user?.full_name || user?.username}</strong>, per motivi di
            sicurezza devi cambiare la password temporanea prima di usare il gestionale.
          </div>
        </div>

        <form onSubmit={submit} className="space-y-3" data-testid="force-change-form">
          <div>
            <Label className="text-slate-200 text-sm">Password temporanea (attuale)</Label>
            <div className="relative mt-1">
              <Lock size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <Input
                type={show ? "text" : "password"}
                value={oldPwd}
                onChange={(e) => setOldPwd(e.target.value)}
                required
                autoFocus
                className="h-12 pl-9 pr-10 bg-slate-950/50 border-white/10 text-white placeholder:text-slate-500"
                data-testid="fcp-old-password"
              />
              <button
                type="button"
                onClick={() => setShow((s) => !s)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-300 hover:text-white"
                tabIndex={-1}
              >
                {show ? <EyeSlash size={18} /> : <Eye size={18} />}
              </button>
            </div>
          </div>

          <div>
            <Label className="text-slate-200 text-sm">Nuova password (min. 6 caratteri)</Label>
            <Input
              type={show ? "text" : "password"}
              value={newPwd}
              onChange={(e) => setNewPwd(e.target.value)}
              required
              minLength={6}
              className="h-12 mt-1 bg-slate-950/50 border-white/10 text-white placeholder:text-slate-500"
              data-testid="fcp-new-password"
            />
          </div>

          <div>
            <Label className="text-slate-200 text-sm">Conferma nuova password</Label>
            <Input
              type={show ? "text" : "password"}
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              required
              minLength={6}
              className="h-12 mt-1 bg-slate-950/50 border-white/10 text-white placeholder:text-slate-500"
              data-testid="fcp-confirm-password"
            />
          </div>

          <Button
            type="submit"
            disabled={busy || !oldPwd || !newPwd || !confirm}
            className="h-12 w-full bg-slate-950/70 hover:bg-slate-900 text-white border border-white/15 rounded-md mt-2 text-base font-semibold tracking-wide shadow-lg shadow-black/40"
            data-testid="fcp-submit"
          >
            {busy ? "Salvo…" : "Imposta password e continua"}
          </Button>

          <div className="text-center pt-1">
            <button
              type="button"
              onClick={handleLogout}
              className="text-[12px] text-slate-300/70 hover:text-white underline underline-offset-2"
              data-testid="fcp-logout"
            >
              Annulla e torna al login
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
