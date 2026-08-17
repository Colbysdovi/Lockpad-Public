import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";

// The client half of first-run onboarding.
//
// Everything here reads or writes ONE server-side row. That placement is the whole
// point and worth restating where it can be seen: a localStorage flag would be
// easier and would be wrong, because one Lockpad instance is reached from several
// devices. Open your own months-old library on a new phone and a browser-local flag
// says "brand new install, here's the welcome tour" — which is not a cosmetic bug,
// since the same condition also decides whether to write starter notes.

export interface OnboardingState {
  onboarded: boolean;
  onboardedAt: string | null;
  seeded: boolean;
}

const KEY = ["onboarding"] as const;

// The dev-reset path, hoisted so it can be ELIMINATED rather than merely unused.
//
// Vite substitutes a literal `false` for import.meta.env.DEV in a production build,
// so this whole expression folds to `null` and the endpoint's name never reaches the
// bundle. Leaving the string in — even with the button stripped and the server
// answering 404 — would hand anyone reading the JavaScript the name of a reset route
// to go looking for. That is the same reasoning the server uses when it returns 404
// instead of 403, and it would be odd to argue it there and give it away here.
const DEV_RESET_PATH = import.meta.env.DEV ? "/onboarding/reset" : null;

export function useOnboardingState() {
  return useQuery({
    queryKey: KEY,
    queryFn: () => api.get<OnboardingState>("/onboarding"),
    // The answer changes at most twice in an instance's life. Refetching it on every
    // window focus would be pure noise against a value that is, in practice, frozen.
    staleTime: Infinity,
    refetchOnWindowFocus: false,
  });
}

export function useOnboardingActions() {
  const qc = useQueryClient();
  const refresh = () => qc.invalidateQueries({ queryKey: KEY });

  return {
    /** Write the starter notes. Idempotent on the server, so calling it twice is
     *  harmless — which matters, because React strict mode does exactly that. */
    seed: useMutation({
      mutationFn: () => api.post<OnboardingState & { created: number }>("/onboarding/seed"),
      onSuccess: () => {
        refresh();
        // The list has new notes in it now. Without this the wizard's live preview
        // would be reading a cache that predates the very notes it exists to show.
        qc.invalidateQueries({ queryKey: ["notes"] });
        qc.invalidateQueries({ queryKey: ["folders"] });
        qc.invalidateQueries({ queryKey: ["tags"] });
      },
    }),

    /** Completed or skipped — the same call. Both mean "this person has been offered
     *  the tour", which is the only question the flag answers. */
    complete: useMutation({
      mutationFn: () => api.post<OnboardingState>("/onboarding/complete"),
      onSuccess: refresh,
    }),

    /** Development only. Absent from production bundles (see DEV_RESET_PATH), and
     *  refused by the server there regardless — two independent guards, because the
     *  client-side one is a build-tool behaviour and the server-side one is a fact. */
    reset: useMutation({
      mutationFn: () =>
        DEV_RESET_PATH
          ? api.post<OnboardingState>(DEV_RESET_PATH)
          : Promise.reject(new Error("Onboarding reset is development-only.")),
      onSuccess: () => {
        refresh();
        qc.invalidateQueries({ queryKey: ["notes"] });
      },
    }),
  };
}
