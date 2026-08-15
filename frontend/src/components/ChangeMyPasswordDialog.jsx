import { useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from "./ui/dialog";
import { Eye, EyeSlash, Lock } from "@phosphor-icons/react";

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;
const TOKEN_KEY = "elios_jwt";

function formatError(err) {
  const d = err?.response?.data?.detail;
  if (typeof d === "string") return d;
  if (Array.isArray(d)) return d.map((e) => e?.msg || JSON.stringify(e)).join(" • ");
  return err?.message || "Errore";
}

export default function ChangeMyPasswordDialog({ open, onClose }) {
  const [oldPwd, setOldPwd] = useState("");
  const [newPwd, setNewPwd] = useState("");
  const [confirm, setConfirm] = useState("");
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    if (newPwd !== confirm) {
      toast.error("Le password non coincidono");
      return;
    }
    if (newPwd.length < 6) {
      toast.error("La nuova password deve avere almeno 6 caratteri");
      return;
    }
    setBusy(true);
    try {
      const { data } = await axios.post(`${API}/auth/change-my-password`, {
        old_password: oldPwd,
        new_password: newPwd,
      });
      // Il backend restituisce un nuovo token con pwv aggiornato — sostituisco
      if (data?.token) {
        try { localStorage.setItem(TOKEN_KEY, data.token); } catch {}
      }
      toast.success("Password aggiornata");
      setOldPwd(""); setNewPwd(""); setConfirm("");
      onClose?.();
    } catch (err) {
      toast.error("Errore", { description: formatError(err) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose?.()}>
      <DialogContent className="max-w-sm" data-testid="change-my-password-dialog">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Lock size={18} /> Cambia password
          </DialogTitle>
          <DialogDescription>
            La vecchia password è necessaria per confermare la modifica.
            Il nuovo token sostituirà quello attuale.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-3">
          <div>
            <Label className="text-sm font-semibold">Password attuale</Label>
            <div className="relative">
              <Input
                type={show ? "text" : "password"}
                value={oldPwd}
                onChange={(e) => setOldPwd(e.target.value)}
                required
                autoFocus
                className="h-11 mt-1 pr-10"
                data-testid="cmp-old-password"
              />
            </div>
          </div>
          <div>
            <Label className="text-sm font-semibold">Nuova password</Label>
            <div className="relative">
              <Input
                type={show ? "text" : "password"}
                value={newPwd}
                onChange={(e) => setNewPwd(e.target.value)}
                required
                minLength={6}
                className="h-11 mt-1 pr-10"
                data-testid="cmp-new-password"
              />
              <button
                type="button"
                onClick={() => setShow((s) => !s)}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-900 mt-0.5"
                tabIndex={-1}
                aria-label={show ? "Nascondi" : "Mostra"}
                data-testid="cmp-show-password"
              >
                {show ? <EyeSlash size={16} /> : <Eye size={16} />}
              </button>
            </div>
          </div>
          <div>
            <Label className="text-sm font-semibold">Ripeti nuova password</Label>
            <Input
              type={show ? "text" : "password"}
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              required
              minLength={6}
              className="h-11 mt-1"
              data-testid="cmp-confirm-password"
            />
          </div>
          <DialogFooter className="pt-2">
            <Button type="button" variant="outline" onClick={onClose}>Annulla</Button>
            <Button
              type="submit"
              disabled={busy}
              className="bg-slate-900 hover:bg-slate-800"
              data-testid="cmp-submit"
            >
              {busy ? "Aggiorno…" : "Aggiorna password"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
