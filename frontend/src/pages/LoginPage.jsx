import { useState } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import axios from "axios";
import { useAuth } from "../lib/AuthContext";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { toast } from "sonner";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from "../components/ui/dialog";
import { Eye, EyeSlash, User as UserIcon, Lock, ShieldCheck } from "@phosphor-icons/react";

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

function formatError(err) {
  const d = err?.response?.data?.detail;
  if (typeof d === "string") return d;
  if (Array.isArray(d)) return d.map((e) => e?.msg || JSON.stringify(e)).join(" • ");
  return err?.message || "Errore imprevisto";
}

function BootstrapForm() {
  const { bootstrapFirstAdmin } = useAuth();
  const navigate = useNavigate();
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [show, setShow] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    if (password !== confirm) {
      toast.error("Le password non coincidono");
      return;
    }
    setBusy(true);
    try {
      await bootstrapFirstAdmin({
        first_name: firstName.trim(),
        last_name: lastName.trim(),
        username: username.trim().toLowerCase(),
        password,
      });
      toast.success("Admin creato — accesso effettuato");
      navigate("/", { replace: true });
    } catch (err) {
      toast.error("Bootstrap fallito", { description: formatError(err) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="space-y-3" data-testid="bootstrap-form">
      <div className="text-center pb-2">
        <div className="inline-flex items-center gap-1 text-[10px] tracking-[0.25em] uppercase text-amber-200/90 font-semibold border border-amber-200/30 px-2 py-0.5 rounded-full">
          <ShieldCheck size={11} /> Primo Avvio
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <Input
          data-testid="bootstrap-first-name"
          placeholder="Nome"
          value={firstName}
          onChange={(e) => setFirstName(e.target.value)}
          required
          className="h-12 bg-slate-900/40 border-slate-100/30 text-white placeholder:text-slate-300/60 focus-visible:ring-amber-300/50"
          autoFocus
        />
        <Input
          data-testid="bootstrap-last-name"
          placeholder="Cognome"
          value={lastName}
          onChange={(e) => setLastName(e.target.value)}
          required
          className="h-12 bg-slate-900/40 border-slate-100/30 text-white placeholder:text-slate-300/60 focus-visible:ring-amber-300/50"
        />
      </div>
      <Input
        data-testid="bootstrap-username"
        placeholder="Username"
        value={username}
        onChange={(e) => setUsername(e.target.value.toLowerCase())}
        required
        className="h-12 bg-slate-900/40 border-slate-100/30 text-white placeholder:text-slate-300/60 font-mono-tight focus-visible:ring-amber-300/50"
      />
      <div className="grid grid-cols-2 gap-2">
        <div className="relative">
          <Input
            data-testid="bootstrap-password"
            type={show ? "text" : "password"}
            placeholder="Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={6}
            className="h-12 bg-slate-900/40 border-slate-100/30 text-white placeholder:text-slate-300/60 focus-visible:ring-amber-300/50 pr-10"
          />
          <button type="button" onClick={() => setShow((s) => !s)}
            className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-300 hover:text-white"
            tabIndex={-1}>{show ? <EyeSlash size={16} /> : <Eye size={16} />}</button>
        </div>
        <Input
          data-testid="bootstrap-password-confirm"
          type={show ? "text" : "password"}
          placeholder="Ripeti password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          required
          minLength={6}
          className="h-12 bg-slate-900/40 border-slate-100/30 text-white placeholder:text-slate-300/60 focus-visible:ring-amber-300/50"
        />
      </div>
      <Button
        type="submit"
        disabled={busy}
        className="h-12 w-full bg-slate-800/80 hover:bg-slate-800 text-white border border-white/10 mt-2"
        data-testid="bootstrap-submit-btn"
      >
        {busy ? "Creazione…" : "Crea Amministratore"}
      </Button>
    </form>
  );
}

function LoginForm() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  const [remember, setRemember] = useState(false);
  const [busy, setBusy] = useState(false);
  const [forgotOpen, setForgotOpen] = useState(false);

  const from = location.state?.from?.pathname || "/";

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      await login(username.trim().toLowerCase(), password, remember);
      toast.success("Accesso effettuato");
      navigate(from, { replace: true });
    } catch (err) {
      toast.error("Accesso negato", { description: formatError(err) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <form onSubmit={submit} className="space-y-3" data-testid="login-form">
        {/* Logo card interno */}
        <div className="flex items-center justify-center pb-2">
          <div className="flex items-center gap-2 text-white">
            <div className="w-6 h-6 rounded-sm bg-amber-400/20 border border-amber-300/40 grid place-items-center">
              <div className="w-2 h-2 rounded-full bg-amber-300"></div>
            </div>
            <div className="text-[13px] tracking-[0.35em] font-semibold uppercase">
              Elios<span className="text-amber-300">Tech</span>
            </div>
          </div>
        </div>

        {/* Username */}
        <div>
          <Label className="sr-only" htmlFor="lg-user">Username</Label>
          <div className="relative">
            <UserIcon size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-300/70 pointer-events-none" />
            <Input
              id="lg-user"
              data-testid="login-username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              required
              autoFocus
              autoComplete="username"
              placeholder="Username"
              className="h-12 pl-10 bg-slate-900/40 border-slate-100/30 text-white placeholder:text-slate-300/60 font-mono-tight focus-visible:ring-amber-300/50 focus-visible:border-amber-300/40"
            />
          </div>
        </div>

        {/* Password + show/hide */}
        <div>
          <Label className="sr-only" htmlFor="lg-pwd">Password</Label>
          <div className="relative">
            <Lock size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-300/70 pointer-events-none" />
            <Input
              id="lg-pwd"
              data-testid="login-password"
              type={show ? "text" : "password"}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              autoComplete="current-password"
              placeholder="Password"
              className="h-12 pl-10 pr-10 bg-slate-900/40 border-slate-100/30 text-white placeholder:text-slate-300/60 focus-visible:ring-amber-300/50 focus-visible:border-amber-300/40"
            />
            <button
              type="button"
              onClick={() => setShow((s) => !s)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-300 hover:text-white"
              tabIndex={-1}
              aria-label={show ? "Nascondi password" : "Mostra password"}
              data-testid="login-toggle-password"
            >
              {show ? <EyeSlash size={18} /> : <Eye size={18} />}
            </button>
          </div>
        </div>

        {/* Remember me */}
        <label className="flex items-center gap-2 text-slate-100/90 select-none cursor-pointer text-sm pt-1">
          <input
            type="checkbox"
            checked={remember}
            onChange={(e) => setRemember(e.target.checked)}
            className="w-4 h-4 rounded border-slate-300 text-amber-500 focus:ring-amber-300"
            data-testid="login-remember-me"
          />
          <span>Rimani collegato</span>
        </label>

        {/* Submit */}
        <Button
          type="submit"
          disabled={busy || !username || !password}
          className="h-12 w-full bg-slate-950/70 hover:bg-slate-900 text-white border border-white/15 rounded-md mt-2 text-base font-semibold tracking-wide shadow-lg shadow-black/40"
          data-testid="login-submit-btn"
        >
          {busy ? "Verifica…" : "Login"}
        </Button>

        {/* Forgot password (admin flow) */}
        <div className="text-center pt-1">
          <button
            type="button"
            onClick={() => setForgotOpen(true)}
            className="text-[12px] text-slate-200/80 hover:text-white underline underline-offset-2"
            data-testid="login-forgot-password"
          >
            Password dimenticata?
          </button>
        </div>
      </form>

      <ForgotPasswordDialog open={forgotOpen} onClose={() => setForgotOpen(false)} />
    </>
  );
}

function ForgotPasswordDialog({ open, onClose }) {
  const [username, setUsername] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setMsg("");
    try {
      const { data } = await axios.post(`${API}/auth/forgot-password`, {
        username: username.trim().toLowerCase(),
      });
      setMsg(data.message || "Richiesta inviata.");
    } catch (err) {
      setMsg("Richiesta inviata. Se lo username esiste, verrai contattato.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose?.()}>
      <DialogContent className="max-w-sm" data-testid="forgot-password-dialog">
        <DialogHeader>
          <DialogTitle>Password dimenticata</DialogTitle>
          <DialogDescription>
            Solo gli Amministratori possono recuperare le proprie credenziali.
            Inserisci il tuo username: un altro Admin potrà reimpostarla dalla
            sezione Gestione Utenti.
          </DialogDescription>
        </DialogHeader>
        {msg ? (
          <div className="text-sm text-slate-700 bg-slate-50 border border-slate-200 rounded p-3" data-testid="forgot-msg">
            {msg}
          </div>
        ) : (
          <form onSubmit={submit} className="space-y-3">
            <Input
              value={username}
              onChange={(e) => setUsername(e.target.value.toLowerCase())}
              placeholder="Il tuo username"
              className="h-11 font-mono-tight"
              required
              autoFocus
              data-testid="forgot-username"
            />
            <DialogFooter>
              <Button type="button" variant="outline" onClick={onClose}>Chiudi</Button>
              <Button type="submit" disabled={busy || !username} className="bg-slate-900 hover:bg-slate-800" data-testid="forgot-submit">
                {busy ? "Invio…" : "Invia richiesta"}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

export default function LoginPage() {
  const { bootstrap, isAuthenticated, isLoading } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  if (!isLoading && isAuthenticated) {
    const from = location.state?.from?.pathname || "/";
    setTimeout(() => navigate(from, { replace: true }), 0);
  }

  const showBootstrap = bootstrap?.needs_bootstrap === true;

  return (
    <div className="relative min-h-screen w-full overflow-hidden bg-slate-950" data-testid="login-page">
      {/* Hero background (warehouse) */}
      <div
        className="absolute inset-0 bg-cover bg-center"
        style={{
          backgroundImage:
            "url('https://images.unsplash.com/photo-1553413077-190dd305871c?auto=format&fit=crop&w=2000&q=80')",
        }}
        aria-hidden
      />
      {/* Depth overlay */}
      <div className="absolute inset-0 bg-gradient-to-b from-slate-950/60 via-slate-900/50 to-slate-950/85" aria-hidden />
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_20%_20%,rgba(255,200,80,0.08),transparent_40%)]" aria-hidden />

      {/* Top bar with logo */}
      <div className="relative z-10 flex items-center justify-between px-5 sm:px-10 pt-6">
        <div className="flex items-center gap-2 text-white">
          <div className="w-7 h-7 rounded-sm bg-amber-400/20 border border-amber-300/40 grid place-items-center">
            <div className="w-3 h-3 rounded-full bg-amber-300"></div>
          </div>
          <div className="text-sm sm:text-base tracking-[0.35em] font-semibold uppercase">
            Elios<span className="text-amber-300">Tech</span>
          </div>
        </div>
      </div>

      {/* Main content */}
      <div className="relative z-10 flex flex-col lg:flex-row items-center lg:items-start justify-center lg:justify-around gap-8 lg:gap-16 px-5 sm:px-10 py-10 sm:py-16 min-h-[calc(100vh-64px)]">
        {/* Headline */}
        <div className="max-w-xl text-white text-center lg:text-left lg:pt-6 flex-1">
          <h1 className="font-display font-bold leading-[1.02] text-4xl sm:text-5xl lg:text-6xl tracking-tight drop-shadow-2xl">
            Portale di<br />Gestione<br />
            <span className="text-amber-300">Magazzino</span>
          </h1>
          <p className="mt-4 text-slate-200/80 max-w-md text-sm sm:text-base hidden sm:block">
            Scanner rapido, inventario Notion, movimentazioni tracciate — accedi con le tue
            credenziali per iniziare a lavorare.
          </p>
        </div>

        {/* Glass card */}
        <div className="w-full max-w-sm">
          <div
            className="relative rounded-2xl border border-white/15 bg-slate-900/40 backdrop-blur-xl px-6 py-7 shadow-[0_10px_60px_-15px_rgba(0,0,0,0.6)]"
            data-testid={showBootstrap ? "bootstrap-card" : "login-card"}
          >
            {/* Subtle circuit accent */}
            <div className="absolute -right-4 top-8 hidden md:block opacity-30 pointer-events-none" aria-hidden>
              <svg width="60" height="120" viewBox="0 0 60 120" fill="none">
                <circle cx="50" cy="10" r="3" fill="#fbbf24" />
                <circle cx="30" cy="40" r="2" fill="#fbbf24" />
                <circle cx="50" cy="70" r="2" fill="#fbbf24" />
                <line x1="50" y1="13" x2="30" y2="37" stroke="#fbbf24" strokeWidth="0.6" />
                <line x1="30" y1="42" x2="50" y2="67" stroke="#fbbf24" strokeWidth="0.6" />
              </svg>
            </div>
            {showBootstrap ? <BootstrapForm /> : <LoginForm />}
          </div>
          <div className="mt-4 text-center text-[10px] uppercase tracking-[0.2em] text-slate-300/60">
            Notion SSOT · Bcrypt · JWT
          </div>
        </div>
      </div>
    </div>
  );
}
