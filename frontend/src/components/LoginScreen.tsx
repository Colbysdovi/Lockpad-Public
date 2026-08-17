import { useState } from "react";
import { motion } from "framer-motion";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/lib/auth";
import { Logo } from "./Logo";
import { EASE_FOLLOW } from "@/lib/motion";

// The password gate.
//
// Shown only when the server was started with a password configured AND there is no
// valid session. Lockpad is single-user, so there is no username and no account —
// one password for the whole app.
//
// "Remember me" is ON by default, which is the right default for a personal server
// you reach from your own devices: it asks for a 30-day session instead of one that
// dies with the browser tab. Turning it off is there for a shared or borrowed
// machine.
//
// This is NOT the same as a note's lock. This password guards access to the app; a
// note's passphrase encrypts that note's contents in the browser and is never sent
// anywhere. Someone who gets past this screen still cannot read a locked note.
export function LoginScreen() {
  const { login } = useAuth();
  const [password, setPassword] = useState("");
  const [remember, setRemember] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!password) return;
    setBusy(true);
    setError(null);
    try {
      await login(password, remember);
    } catch {
      setError("Incorrect password.");
      setPassword("");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-[100dvh] items-center justify-center bg-canvas p-4">
      <motion.form
        onSubmit={submit}
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3, ease: EASE_FOLLOW }}
        className="flex w-full max-w-sm flex-col gap-4 rounded-2xl border bg-card p-6 shadow-xl"
      >
        <div className="flex flex-col items-center gap-2 pb-1">
          <Logo />
          <p className="text-sm text-muted-foreground">Enter your password to unlock.</p>
        </div>

        <Input
          type="password"
          autoFocus
          placeholder="Password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          aria-label="Password"
          // Match the in-app unlock field (LockPanel): a roomier, touch-friendly
          // password box rather than the compact base input.
          className="h-11 px-3.5 sm:h-10"
        />

        {error && <p className="text-sm text-destructive">{error}</p>}

        <label className="flex cursor-pointer select-none items-center gap-2 text-sm text-muted-foreground">
          <input
            type="checkbox"
            checked={remember}
            onChange={(e) => setRemember(e.target.checked)}
            className="h-4 w-4 rounded border-input"
            style={{ accentColor: "var(--primary)" }}
          />
          Remember me on this device
        </label>

        <Button type="submit" disabled={busy || !password} className="h-11 w-full sm:h-10">
          {busy ? "Unlocking…" : "Unlock"}
        </Button>
      </motion.form>
    </div>
  );
}
