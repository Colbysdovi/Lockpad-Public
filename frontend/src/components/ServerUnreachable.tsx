import { useState } from "react";
import { motion } from "framer-motion";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/lib/auth";
import { Logo } from "./Logo";
import { EASE_FOLLOW } from "@/lib/motion";

// Shown when the server did not answer at all.
//
// This screen exists because the app used to show the PASSWORD screen here, which
// was the wrong answer to the wrong question: if /auth/status is unreachable then
// /auth/login is unreachable too, so every password typed into that box failed. It
// looked like "your password stopped working" when the truth was "the backend is
// not running" — the one thing the person could have acted on.
//
// So this says what happened, says what to do about it, and keeps checking in the
// background: start the backend and the app comes back on its own, with no reload.
export function ServerUnreachable() {
  const { refresh } = useAuth();
  // Purely presentational — the provider retries on its own timer regardless. This
  // just acknowledges the click, so pressing the button doesn't feel inert.
  const [checking, setChecking] = useState(false);

  const retry = async () => {
    setChecking(true);
    try {
      await refresh();
    } finally {
      // A successful check unmounts this screen, so the reset only matters when the
      // server is still down.
      setTimeout(() => setChecking(false), 400);
    }
  };

  return (
    <div className="flex min-h-[100dvh] items-center justify-center bg-canvas p-4">
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3, ease: EASE_FOLLOW }}
        className="w-full max-w-sm rounded-2xl border bg-card p-6 text-center shadow-sm"
        role="alert"
      >
        <div className="mb-4 flex justify-center">
          <Logo className="h-8 w-8" />
        </div>

        <h1 className="type-section mb-1">Can't reach the server</h1>
        <p className="text-sm text-muted-foreground">
          Lockpad loaded, but its backend didn't answer. Your notes are safe — the app
          simply has nothing to talk to yet.
        </p>

        <p className="mt-4 text-sm text-muted-foreground">
          If you're running it yourself, start the backend and this page will pick it up
          on its own.
        </p>

        <Button onClick={retry} disabled={checking} className="mt-5 w-full">
          {checking ? "Checking…" : "Try again"}
        </Button>

        <p className="mt-3 text-xs text-muted-foreground">Retrying automatically every few seconds.</p>
      </motion.div>
    </div>
  );
}
