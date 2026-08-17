import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { ApiError, api, setUnauthorizedHandler } from "./api";

// Who is allowed in.
//
// Lockpad is single-user and self-hosted, so there are no accounts — just an
// optional password on the whole app. Whether one is set is the SERVER's decision
// (an env var), which is why the app has to ask on startup rather than assume.
//
// The four states:
//   loading     — still asking the server; render nothing rather than flash a
//                 login screen at someone who does not need one.
//   open        — no password configured. The app is simply usable. This is a
//                 legitimate setup for a server that is already private (a home
//                 LAN, a Tailscale tailnet), not a misconfiguration.
//   authed      — a password is set and the session cookie is valid.
//   needs-login — a password is set and we do not have a valid session.
//   unreachable — the server did not answer at all. Deliberately NOT the same as
//                 needs-login: see the catch in refresh() for why conflating the
//                 two hands the user a password box that can never work.
type Status = "loading" | "open" | "authed" | "needs-login" | "unreachable";

// How long to wait before asking again while the server is down. Short enough that
// starting the backend feels like the app fixes itself, long enough not to hammer
// a server that is still booting.
const RETRY_MS = 3000;

interface AuthCtx {
  status: Status;
  /** Ask the server again. Wired to the retry button on the unreachable screen;
   *  also runs on a timer while unreachable, so a backend that comes back up
   *  restores the app without anyone reloading the page. */
  refresh: () => Promise<void>;
  // Set only when the server is reachable beyond this machine AND has no password —
  // the one configuration pair that leaves every unlocked note open to the network.
  // Null the rest of the time, which is the normal case.
  warning: string | null;
  login: (password: string, remember: boolean) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthCtx>({
  status: "loading",
  refresh: async () => {},
  warning: null,
  login: async () => {},
  logout: async () => {},
});

export const useAuth = () => useContext(AuthContext);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<Status>("loading");
  const [warning, setWarning] = useState<string | null>(null);

  // Ask the server what the situation is. Runs once on mount; the answer decides
  // whether the app renders or the login screen does.
  const refresh = useCallback(async () => {
    try {
      const s = await api.get<{ authRequired: boolean; authenticated: boolean; warning?: string }>("/auth/status");
      setWarning(s.warning ?? null);
      // No password configured → app is open.
      if (!s.authRequired) setStatus("open");
      else setStatus(s.authenticated ? "authed" : "needs-login");
    } catch (e) {
      // Two very different failures used to land here together, and treating them
      // the same was a bug worth spelling out.
      //
      // "You are not authenticated" (401/403) still fails CLOSED — the login screen
      // is exactly right, and rendering the app to someone unentitled is the thing
      // worth avoiding.
      //
      // "The server never answered" is NOT that. A dead backend, a stopped
      // container, a dev server that is not running — none of them are an
      // authentication problem, and showing a password box for them is actively
      // misleading: every password is wrong, because /auth/login is just as dead as
      // /auth/status. There is nothing to protect either, since the notes live
      // behind the same unreachable API. So say what actually happened.
      const denied = e instanceof ApiError && (e.status === 401 || e.status === 403);
      setStatus(denied ? "needs-login" : "unreachable");
    }
  }, []);

  // While the server is down, keep asking. This is what makes "start the backend"
  // the whole fix — the app recovers on its own instead of needing a reload.
  useEffect(() => {
    if (status !== "unreachable") return;
    const t = setInterval(() => { void refresh(); }, RETRY_MS);
    return () => clearInterval(t);
  }, [status, refresh]);

  useEffect(() => {
    refresh();
    // Sessions expire while the app is open, so any request coming back 401 must be
    // able to bounce the user out — wherever in the app it happened. Registering one
    // handler here means no individual caller has to think about it.
    // Any protected request returning 401 drops us back to the login screen.
    setUnauthorizedHandler(() => setStatus("needs-login"));
    return () => setUnauthorizedHandler(null);
  }, [refresh]);

  const login = useCallback(async (password: string, remember: boolean) => {
    await api.post("/auth/login", { password, remember }); // throws on 401
    setStatus("authed");
  }, []);

  const logout = useCallback(async () => {
    await api.post("/auth/logout");
    setStatus("needs-login");
  }, []);

  return <AuthContext.Provider value={{ status, refresh, warning, login, logout }}>{children}</AuthContext.Provider>;
}
