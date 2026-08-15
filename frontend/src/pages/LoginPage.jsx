import { useState } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { useAuth } from "../lib/AuthContext";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "../components/ui/card";
import { toast } from "sonner";
import { Package, ShieldCheck, User as UserIcon, Lock } from "@phosphor-icons/react";

function formatError(err) {
  const d = err?.response?.data?.detail;
  if (typeof d === "string") return d;
  if (Array.isArray(d)) return d.map((e) => e?.msg || JSON.stringify(e)).join(" • ");
  return err?.message || "Errore imprevisto";
}

function BootstrapForm({ onDone }) {
  const { bootstrapFirstAdmin } = useAuth();
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    if (password !== confirm) {
      toast.error("Le password non coincidono");
      return;
    }
    if (password.length < 6) {
      toast.error("La password deve avere almeno 6 caratteri");
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
      toast.success("Amministratore creato — accesso effettuato");
      onDone?.();
    } catch (e) {
      toast.error("Bootstrap fallito", { description: formatError(e) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="w-full max-w-md border-slate-200" data-testid="bootstrap-card">
      <CardHeader>
        <div className="flex items-center gap-2 text-amber-700">
          <ShieldCheck size={22} weight="bold" />
          <span className="text-[11px] tracking-[0.2em] uppercase font-semibold">
            Primo Avvio
          </span>
        </div>
        <CardTitle className="font-display text-2xl">Crea il primo Amministratore</CardTitle>
        <CardDescription>
          Il database utenti è vuoto. Definisci le credenziali dell'Admin iniziale.
          Sarai autenticato automaticamente al termine.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={submit} className="space-y-3" data-testid="bootstrap-form">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-sm font-semibold">Nome</Label>
              <Input
                data-testid="bootstrap-first-name"
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
                required
                className="h-11 mt-1"
                autoFocus
              />
            </div>
            <div>
              <Label className="text-sm font-semibold">Cognome</Label>
              <Input
                data-testid="bootstrap-last-name"
                value={lastName}
                onChange={(e) => setLastName(e.target.value)}
                required
                className="h-11 mt-1"
              />
            </div>
          </div>
          <div>
            <Label className="text-sm font-semibold">Username</Label>
            <Input
              data-testid="bootstrap-username"
              value={username}
              onChange={(e) => setUsername(e.target.value.toLowerCase())}
              placeholder="es. mrossi"
              required
              className="h-11 mt-1 font-mono-tight"
            />
            <div className="text-[11px] text-slate-500 mt-0.5">
              Minuscole, numeri, . _ - (2-32 caratteri)
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-sm font-semibold">Password</Label>
              <Input
                data-testid="bootstrap-password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={6}
                className="h-11 mt-1"
              />
            </div>
            <div>
              <Label className="text-sm font-semibold">Ripeti Password</Label>
              <Input
                data-testid="bootstrap-password-confirm"
                type="password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                required
                minLength={6}
                className="h-11 mt-1"
              />
            </div>
          </div>
          <Button
            type="submit"
            disabled={busy}
            className="h-12 w-full bg-amber-600 hover:bg-amber-700"
            data-testid="bootstrap-submit-btn"
          >
            {busy ? "Creazione…" : "Crea Amministratore e Accedi"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

function LoginForm() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);

  const from = location.state?.from?.pathname || "/";

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      await login(username.trim().toLowerCase(), password);
      toast.success("Accesso effettuato");
      navigate(from, { replace: true });
    } catch (e) {
      toast.error("Accesso negato", { description: formatError(e) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="w-full max-w-sm border-slate-200" data-testid="login-card">
      <CardHeader>
        <div className="flex items-center gap-2 text-slate-900">
          <div className="w-10 h-10 rounded-md bg-slate-900 text-white grid place-items-center font-mono-tight font-bold text-sm">
            MG
          </div>
          <div>
            <div className="text-[10px] tracking-[0.2em] uppercase text-slate-500 font-semibold">
              Elios Tech
            </div>
            <CardTitle className="font-display text-xl">Magazzino</CardTitle>
          </div>
        </div>
        <CardDescription className="pt-2">
          Accedi con il tuo username per iniziare a lavorare.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={submit} className="space-y-4" data-testid="login-form">
          <div>
            <Label className="text-sm font-semibold" htmlFor="lg-user">
              <UserIcon size={13} className="inline mr-1" /> Username
            </Label>
            <Input
              id="lg-user"
              data-testid="login-username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              required
              autoFocus
              autoComplete="username"
              className="h-12 mt-1 font-mono-tight"
            />
          </div>
          <div>
            <Label className="text-sm font-semibold" htmlFor="lg-pwd">
              <Lock size={13} className="inline mr-1" /> Password
            </Label>
            <Input
              id="lg-pwd"
              data-testid="login-password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              autoComplete="current-password"
              className="h-12 mt-1"
            />
          </div>
          <Button
            type="submit"
            disabled={busy || !username || !password}
            className="h-12 w-full bg-slate-900 hover:bg-slate-800"
            data-testid="login-submit-btn"
          >
            {busy ? "Verifica…" : "Accedi"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

export default function LoginPage() {
  const { bootstrap, isAuthenticated, isLoading } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  // Se già autenticato, redirect
  if (!isLoading && isAuthenticated) {
    const from = location.state?.from?.pathname || "/";
    setTimeout(() => navigate(from, { replace: true }), 0);
  }

  const showBootstrap = bootstrap?.needs_bootstrap === true;

  return (
    <div
      className="min-h-screen bg-slate-50 flex flex-col items-center justify-center p-4"
      data-testid="login-page"
    >
      <div className="mb-6 flex items-center gap-2 text-slate-500">
        <Package size={16} />
        <span className="text-[11px] tracking-[0.2em] uppercase font-semibold">
          Elios Tech — Magazzino
        </span>
      </div>
      {showBootstrap ? (
        <BootstrapForm onDone={() => navigate("/", { replace: true })} />
      ) : (
        <LoginForm />
      )}
      <div className="mt-6 text-[11px] text-slate-400 text-center max-w-sm">
        Notion resta la Single Source of Truth per l'inventario. Utenti e password
        sono gestiti localmente e protetti da hashing bcrypt.
      </div>
    </div>
  );
}
