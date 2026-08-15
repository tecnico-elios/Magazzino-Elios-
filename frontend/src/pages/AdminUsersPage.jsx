import { useEffect, useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { useAuth } from "../lib/AuthContext";
import { Link, Navigate } from "react-router-dom";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { Badge } from "../components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "../components/ui/dialog";
import { UserPlus, Key, ArrowLeft, PencilSimple, Prohibit, ArrowClockwise } from "@phosphor-icons/react";

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

function formatError(err) {
  const d = err?.response?.data?.detail;
  if (typeof d === "string") return d;
  if (Array.isArray(d)) return d.map((e) => e?.msg || JSON.stringify(e)).join(" • ");
  return err?.message || "Errore";
}

function CreateUserDialog({ open, onClose, onCreated }) {
  const [first, setFirst] = useState("");
  const [last, setLast] = useState("");
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState("operator");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) {
      setFirst(""); setLast(""); setUsername(""); setEmail(""); setPassword(""); setRole("operator");
    }
  }, [open]);

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      const { data } = await axios.post(`${API}/admin/users`, {
        first_name: first.trim(),
        last_name: last.trim(),
        username: username.trim().toLowerCase(),
        email: email.trim().toLowerCase() || undefined,
        password,
        role,
      });
      toast.success(`Utente ${data.username} creato`);
      onCreated?.(data);
      onClose();
    } catch (e) {
      toast.error("Creazione fallita", { description: formatError(e) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-md" data-testid="create-user-dialog">
        <DialogHeader>
          <DialogTitle>Nuovo utente</DialogTitle>
          <DialogDescription>La password verrà cifrata con bcrypt e non salvata in chiaro.</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-3">
          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label>Nome</Label>
              <Input value={first} onChange={(e) => setFirst(e.target.value)} required className="h-11 mt-1" data-testid="new-user-first-name" />
            </div>
            <div>
              <Label>Cognome</Label>
              <Input value={last} onChange={(e) => setLast(e.target.value)} required className="h-11 mt-1" data-testid="new-user-last-name" />
            </div>
          </div>
          <div>
            <Label>Username</Label>
            <Input
              value={username}
              onChange={(e) => setUsername(e.target.value.toLowerCase())}
              required
              className="h-11 mt-1 font-mono-tight"
              data-testid="new-user-username"
              placeholder="minuscole, numeri, . _ -"
            />
          </div>
          <div>
            <Label>Email (per recupero password)</Label>
            <Input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value.toLowerCase())}
              className="h-11 mt-1"
              data-testid="new-user-email"
              placeholder="opzionale — nome.cognome@eliostech.org"
            />
          </div>
          <div>
            <Label>Password (min 6 caratteri)</Label>
            <Input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={6}
              className="h-11 mt-1"
              data-testid="new-user-password"
            />
          </div>
          <div>
            <Label>Ruolo</Label>
            <div className="flex gap-2 mt-1">
              <button
                type="button"
                onClick={() => setRole("operator")}
                className={`h-11 px-4 rounded-md border font-semibold text-sm ${
                  role === "operator" ? "bg-slate-900 text-white border-slate-900" : "bg-white border-slate-300"
                }`}
                data-testid="new-user-role-operator"
              >
                Operatore
              </button>
              <button
                type="button"
                onClick={() => setRole("admin")}
                className={`h-11 px-4 rounded-md border font-semibold text-sm ${
                  role === "admin" ? "bg-amber-600 text-white border-amber-600" : "bg-white border-slate-300"
                }`}
                data-testid="new-user-role-admin"
              >
                Admin
              </button>
            </div>
          </div>
          <DialogFooter className="pt-2">
            <Button type="button" variant="outline" onClick={onClose}>Annulla</Button>
            <Button type="submit" disabled={busy} className="et-btn-primary border-0" data-testid="create-user-submit">
              {busy ? "Creo…" : "Crea utente"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function EditEmailDialog({ user, onClose, onDone }) {
  const [email, setEmail] = useState(user?.email || "");
  const [busy, setBusy] = useState(false);
  if (!user) return null;
  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      await axios.patch(`${API}/admin/users/${user.id}`, { email });
      toast.success(`Email aggiornata per ${user.username}`);
      onDone?.();
      onClose();
    } catch (e) {
      toast.error("Errore", { description: formatError(e) });
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-sm" data-testid="edit-email-dialog">
        <DialogHeader>
          <DialogTitle>Email — {user.username}</DialogTitle>
          <DialogDescription>Usata per il flusso "Password dimenticata".</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-3">
          <Input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value.toLowerCase())}
            className="h-11"
            placeholder="nome.cognome@eliostech.org"
            data-testid="edit-email-input"
            autoFocus
          />
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>Annulla</Button>
            <Button type="submit" disabled={busy} className="et-btn-primary border-0" data-testid="edit-email-submit">
              {busy ? "Salvo…" : "Salva email"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}


function ResetPwdDialog({ user, onClose, onDone }) {
  const [pwd, setPwd] = useState("");
  const [busy, setBusy] = useState(false);
  if (!user) return null;

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      await axios.post(`${API}/admin/users/${user.id}/reset-password`, { new_password: pwd });
      toast.success(`Password di ${user.username} reimpostata`, {
        description: "Tutte le sessioni precedenti sono state invalidate.",
      });
      onDone?.();
      onClose();
    } catch (e) {
      toast.error("Reset fallito", { description: formatError(e) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-sm" data-testid="reset-password-dialog">
        <DialogHeader>
          <DialogTitle>Reset password — {user.username}</DialogTitle>
          <DialogDescription>
            Non serve conoscere la vecchia password. Tutte le sessioni attive di questo utente
            verranno invalidate.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-3">
          <div>
            <Label>Nuova password (min 6)</Label>
            <Input
              type="password"
              value={pwd}
              onChange={(e) => setPwd(e.target.value)}
              required
              minLength={6}
              className="h-11 mt-1"
              data-testid="reset-password-input"
              autoFocus
            />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>Annulla</Button>
            <Button type="submit" disabled={busy} className="bg-amber-600 hover:bg-amber-700 text-white" data-testid="reset-password-submit">
              {busy ? "Reset…" : "Reset password"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export default function AdminUsersPage() {
  const { user: me, isAdmin, isLoading } = useAuth();
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);
  const [resetTarget, setResetTarget] = useState(null);
  const [emailTarget, setEmailTarget] = useState(null);

  const load = async () => {
    setLoading(true);
    try {
      const { data } = await axios.get(`${API}/admin/users`);
      setUsers(data.items || []);
    } catch (e) {
      toast.error("Errore caricamento utenti", { description: formatError(e) });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isAdmin) load();
  }, [isAdmin]);

  if (isLoading) return <div className="p-6 text-slate-500">Caricamento…</div>;
  if (!isAdmin) return <Navigate to="/" replace />;

  const toggleActive = async (u) => {
    try {
      await axios.patch(`${API}/admin/users/${u.id}`, { active: !u.active });
      toast.success(`Utente ${u.username} ${!u.active ? "riattivato" : "disattivato"}`);
      load();
    } catch (e) {
      toast.error("Aggiornamento fallito", { description: formatError(e) });
    }
  };

  const changeRole = async (u, newRole) => {
    if (u.role === newRole) return;
    try {
      await axios.patch(`${API}/admin/users/${u.id}`, { role: newRole });
      toast.success(`Ruolo aggiornato: ${u.username} → ${newRole}`);
      load();
    } catch (e) {
      toast.error("Aggiornamento fallito", { description: formatError(e) });
    }
  };

  const fmtDate = (v) => {
    if (!v) return "—";
    try { return new Date(v).toLocaleString("it-IT"); } catch { return v; }
  };

  return (
    <div className="min-h-screen bg-slate-50" data-testid="admin-users-page">
      <header className="et-header-dark sticky top-0 z-30">
        <div className="max-w-5xl mx-auto px-3 sm:px-6 py-3 sm:py-4 flex items-center justify-between gap-2 flex-wrap">
          <div className="flex items-center gap-2 sm:gap-3 min-w-0 flex-1 sm:flex-none">
            <Link
              to="/"
              className="h-10 inline-flex items-center px-3 rounded-md bg-white/5 border border-white/10 text-slate-100 hover:border-amber-300/50 hover:text-white text-sm transition-colors shrink-0"
            >
              <ArrowLeft size={16} className="mr-1" /> <span className="hidden xs:inline sm:inline">Magazzino</span>
            </Link>
            <div className="min-w-0">
              <div className="text-[10px] tracking-[0.22em] uppercase text-amber-300/80 font-semibold truncate">
                Amministrazione
              </div>
              <h1 className="font-display text-lg sm:text-2xl font-bold text-white leading-tight">
                Gestione Utenti
              </h1>
            </div>
          </div>
          <Button
            onClick={() => setCreateOpen(true)}
            className="h-10 et-btn-primary border-0 text-xs sm:text-sm shrink-0"
            data-testid="create-user-btn"
          >
            <UserPlus size={16} className="mr-1" /> <span className="whitespace-nowrap">Nuovo utente</span>
          </Button>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 sm:px-6 py-6">
        <div className="flex items-center justify-between mb-3">
          <div className="text-xs text-slate-500 uppercase tracking-wider">
            {users.length} utenti
          </div>
          <Button variant="outline" size="sm" onClick={load} disabled={loading} data-testid="reload-users-btn">
            <ArrowClockwise size={14} className={loading ? "animate-spin" : ""} />
          </Button>
        </div>

        <div className="et-card-elevated overflow-hidden">
          <div className="overflow-x-auto scrollbar-thin">
            <table className="et-table min-w-[820px]">
            <thead>
              <tr>
                <th>Utente</th>
                <th>Ruolo</th>
                <th>Stato</th>
                <th>Ultimo accesso</th>
                <th className="text-right">Azioni</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => {
                const isMe = me?.id === u.id;
                return (
                  <tr key={u.id} data-testid={`user-row-${u.username}`}>
                    <td className="px-4 py-3">
                      <div className="font-semibold text-slate-900">{u.full_name || u.username}</div>
                      <div className="text-xs font-mono-tight text-slate-500">@{u.username}</div>
                      <div className="text-xs text-slate-500 mt-0.5 flex items-center gap-1">
                        {u.email ? (
                          <span className="font-mono-tight">{u.email}</span>
                        ) : (
                          <span className="text-slate-400 italic">nessuna email</span>
                        )}
                        <button
                          type="button"
                          onClick={() => setEmailTarget(u)}
                          className="text-[10px] uppercase tracking-wider text-slate-500 hover:text-slate-900 underline underline-offset-2"
                          data-testid={`edit-email-${u.username}`}
                        >
                          modifica
                        </button>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex gap-1">
                        <button
                          type="button"
                          onClick={() => changeRole(u, "operator")}
                          disabled={isMe}
                          className={`px-2 h-7 rounded-md text-xs font-semibold border ${
                            u.role === "operator"
                              ? "bg-slate-900 text-white border-slate-900"
                              : "bg-white border-slate-300 text-slate-600 hover:border-slate-500"
                          } disabled:opacity-40`}
                          data-testid={`role-operator-${u.username}`}
                        >
                          Operatore
                        </button>
                        <button
                          type="button"
                          onClick={() => changeRole(u, "admin")}
                          disabled={isMe}
                          className={`px-2 h-7 rounded-md text-xs font-semibold border ${
                            u.role === "admin"
                              ? "bg-amber-600 text-white border-amber-600"
                              : "bg-white border-slate-300 text-slate-600 hover:border-amber-500"
                          } disabled:opacity-40`}
                          data-testid={`role-admin-${u.username}`}
                        >
                          Admin
                        </button>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      {u.active ? (
                        <Badge className="bg-emerald-100 text-emerald-800 border-emerald-200 hover:bg-emerald-100">
                          Attivo
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="border-red-200 text-red-700 bg-red-50">
                          Disattivato
                        </Badge>
                      )}
                      {isMe && (
                        <span className="ml-2 text-[10px] uppercase tracking-wider text-slate-400">tu</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-xs text-slate-500 font-mono-tight">
                      {fmtDate(u.last_login)}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1 justify-end">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => setResetTarget(u)}
                          className="h-8"
                          data-testid={`reset-${u.username}`}
                        >
                          <Key size={14} className="mr-1" /> Reset PW
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => toggleActive(u)}
                          disabled={isMe}
                          className={`h-8 ${u.active ? "border-red-300 text-red-600 hover:bg-red-50" : "border-emerald-300 text-emerald-700 hover:bg-emerald-50"}`}
                          data-testid={`toggle-active-${u.username}`}
                        >
                          <Prohibit size={14} className="mr-1" /> {u.active ? "Disattiva" : "Riattiva"}
                        </Button>
                      </div>
                    </td>
                  </tr>
                );
              })}
              {users.length === 0 && !loading && (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-slate-400">
                    Nessun utente.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
          </div>
        </div>
      </main>

      <CreateUserDialog open={createOpen} onClose={() => setCreateOpen(false)} onCreated={load} />
      <ResetPwdDialog user={resetTarget} onClose={() => setResetTarget(null)} onDone={load} />
      <EditEmailDialog user={emailTarget} onClose={() => setEmailTarget(null)} onDone={load} />
    </div>
  );
}
