import React from "react";
import ReactDOM from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter } from "react-router-dom";
import { MotionConfig } from "framer-motion";
import App from "./App";
import { AuthProvider } from "./lib/auth";
import { ToastProvider } from "./lib/useToast";
import { AppLanguageProvider } from "./lib/i18n/AppLanguageProvider";
import { TooltipProvider } from "./components/ui/tooltip";
// Self-hosted Newsreader (variable, optical-size axis) for titles — bundled
// locally by Vite, NO external/CDN request (preserves the zero-outbound privacy
// guarantee). font-display: swap falls back to a system serif while it loads.
import "@fontsource-variable/newsreader/opsz.css";
import "./index.css";

// Where the app boots. The nesting of providers below is load-bearing, so each one
// carries a note about why it sits where it does.

// staleTime 10s: a note list stays trusted for ten seconds before a refetch is
// considered, which is long enough that navigating between folders and back feels
// instant, and short enough that nothing goes visibly out of date. Focus refetching
// is off by default and re-enabled per query where it earns its keep — the note
// list turns it back on so returning to the tab self-heals the ordering.
const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 10_000, refetchOnWindowFocus: false } },
});

ReactDOM.createRoot(document.getElementById("root")!).render(
  // StrictMode double-invokes effects and state initializers in development, on
  // purpose, to surface anything that isn't safe to run twice. Several places in
  // this codebase are written the way they are BECAUSE of it — see noteFx's claim
  // registry and the editor's create-or-reuse effect. Leave it on.
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <BrowserRouter>
          {/* Honor the OS "reduce motion" setting app-wide (PRD 7): framer-motion
              animations (incl. card hover-lift) collapse to instant when set. */}
          <MotionConfig reducedMotion="user">
            {/* Shared tooltip delay group for every icon button (300ms open;
                instant when moving between buttons within 500ms). TooltipProvider
                must sit ABOVE ToastProvider: the toast tray is rendered by
                ToastProvider and contains a Tooltip (the ✕ "Dismiss"), so it needs
                the tooltip context in scope. */}
            <TooltipProvider delayDuration={300} skipDelayDuration={500}>
              {/* The interface language, and everything that reads it. It sits here
                  rather than higher because it queries (needs QueryClientProvider)
                  and asks whether there is a session (needs AuthProvider), and it
                  sits above ToastProvider because the toast tray renders its own
                  copy and would otherwise be the one surface left in English. */}
              <AppLanguageProvider>
                <ToastProvider>
                  <App />
                </ToastProvider>
              </AppLanguageProvider>
            </TooltipProvider>
          </MotionConfig>
        </BrowserRouter>
      </AuthProvider>
    </QueryClientProvider>
  </React.StrictMode>
);
