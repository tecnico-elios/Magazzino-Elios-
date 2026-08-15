import { useEffect, useState } from "react";
import axios from "axios";
import { useNavigate, useSearchParams, Link } from "react-router-dom";
import { toast } from "sonner";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "../components/ui/card";
import { Eye, EyeSlash, Lock } from "@phosphor-icons/react";

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

function formatError(err) {
  const d = err?.response?.data?.detail;
  if (typeof d === "string") return d;
  if (Array.isArray(d)) return d.map((e) => e?.msg || JSON.stringify(e)).join(" • ");
  return err?.message || "Errore";
}

export default function ResetPasswordPage() {
  const [params] = useSearchParams();
  const token = params.get("token");
  const navigate = useNavigate();
  const [newPwd, setNewPwd] = useState("");
  const [confirm, setConfirm] = useState("");
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (!token) navigate("/login", { replace: true });
  }, [token, navigate]);

  const submit = async (e) => {
    e.preventDefault();
    if (newPwd !== confirm) {
      toast.error("Le password non coincidono");
      return;
    }
    if (newPwd.length < 6) {
      toast.error("Almeno 6 caratteri");
      return;
    }
    setBusy(true);
    try {
      await axios.post(`${API}/auth/reset-password`, { token, new_password: newPwd });
      setDone(true);
      toast.success("Password aggiornata — puoi accedere");
      setTimeout(() => navigate("/login", { replace: true }), 1200);
    } catch (err) {
      toast.error("Errore", { description: formatError(err) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4" data-testid="reset-password-page">
      <Card className="w-full max-w-sm border-slate-200">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Lock size={20} /> Reimposta password
          </CardTitle>
          <CardDescription>
            Inserisci la nuova password. Il link è valido una sola volta e per 1 ora.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {done ? (
            <div className="text-sm text-emerald-700 bg-emerald-50 border border-emerald-200 rounded p-3">
              Password aggiornata. Reindirizzamento al login…
            </div>
          ) : (
            <form onSubmit={submit} className="space-y-3">
              <div>
                <Label>Nuova password</Label>
                <div className="relative">
                  <Input
                    type={show ? "text" : "password"}
                    value={newPwd}
                    onChange={(e) => setNewPwd(e.target.value)}
                    required
                    minLength={6}
                    className="h-11 mt-1 pr-10"
                    autoFocus
                    data-testid="reset-new-password"
                  />
                  <button
                    type="button"
                    onClick={() => setShow((s) => !s)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-900 mt-0.5"
                    tabIndex={-1}
                  >
                    {show ? <EyeSlash size={16} /> : <Eye size={16} />}
                  </button>
                </div>
              </div>
              <div>
                <Label>Ripeti password</Label>
                <Input
                  type={show ? "text" : "password"}
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  required
                  minLength={6}
                  className="h-11 mt-1"
                  data-testid="reset-confirm-password"
                />
              </div>
              <Button
                type="submit"
                disabled={busy}
                className="h-11 w-full bg-slate-900 hover:bg-slate-800"
                data-testid="reset-submit-btn"
              >
                {busy ? "Aggiorno…" : "Aggiorna password"}
              </Button>
              <Link to="/login" className="block text-center text-sm text-slate-500 hover:text-slate-900">
                Torna al login
              </Link>
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
