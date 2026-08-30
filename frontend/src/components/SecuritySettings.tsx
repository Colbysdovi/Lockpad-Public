import { useEffect, useState } from "react";
import { LogOut, ShieldAlert } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { SettingsSection } from "@/components/SettingsPrimitives";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useToast } from "@/lib/useToast";
import { useT } from "@/lib/i18n";

// Settings → Security.
//
// Two things live here, both about who can reach this server rather than what is in
// it: the warning that the app is open to the network with no password, and the one
// action that can take a session away from a device you no longer have.
//
// There is deliberately no list of active sessions. The server signs a token and
// forgets it — that is what makes a restart harmless and leaves nothing to leak —
// so it genuinely does not know how many devices are logged in. Building the list
// would mean storing every session, which is the design being kept.

interface SessionInfo {
  authRequired: boolean;
  id?: string | null;
  issuedAt?: string | null;
  expiresAt?: string | null;
}

function formatDate(iso?: string | null): string {
  const t = useT();
  if (!iso) return t("common.noValue");
  return new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

export function SecuritySettings() {
  const t = useT();
  const { warning } = useAuth();
  const toast = useToast();
  const [session, setSession] = useState<SessionInfo | null>(null);
  const [working, setWorking] = useState(false);

  useEffect(() => {
    api.get<SessionInfo>("/auth/session")
      .then(setSession)
      // A 401 here just means auth is on and this browser is not signed in, which
      // the rest of the app already handles; nothing to say on this page.
      .catch(() => setSession(null));
  }, []);

  const signOutOthers = async () => {
    setWorking(true);
    try {
      await api.post("/auth/session/revoke", {});
      toast(t("settings.security.signedOut"), { kind: "success" });
    } catch {
      toast(t("settings.security.signOutFailed"), { kind: "error" });
    } finally {
      setWorking(false);
    }
  };

  const authOff = session?.authRequired === false;

  return (
    <SettingsSection
      id="security-heading"
      title={t("settings.security.title")}
      description={t("settings.security.description")}
    >
      {/* The exposure warning. Shown here rather than only in the server log,
          because a log file on a headless machine is a place warnings go to be
          missed. It states the consequence, not the two variable names.

          No border and no card background, because on this page those mean "there
          is a button here" and this is something to read. What replaces them is a
          tint, which is louder than the border ever was — and it is a tint that
          now actually renders: the old `border-destructive/40 bg-destructive/10`
          compiled to NOTHING, because every palette colour in this project is a
          plain var() holding a hex and Tailwind cannot slice an alpha out of one.
          This warning has been quietly colourless the whole time.

          Why --destructive and not --warning, since the language here is warning-shaped:
          settled deliberately, keep destructive. --warning is the register for "you may
          want to know about this"; an unauthenticated server reachable by anything on the
          network is not advisory, it is a present condition under which any device in the
          house can read every unlocked note right now. The tier tracks how bad the
          situation is, not how politely the sentence is phrased. Recorded here so it
          stops reading as an open question. */}
      {warning && (
        <div
          role="alert"
          className="mb-3 flex gap-3 rounded-xl bg-[color-mix(in_srgb,var(--destructive)_10%,var(--canvas))] p-4"
        >
          <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0 text-destructive" />
          <div className="min-w-0 text-sm">
            <div className="font-medium text-destructive">{t("settings.security.exposed")}</div>
            <p className="mt-1 text-muted-foreground">{warning}</p>
          </div>
        </div>
      )}

      {/* Stays an action card even when the button is disabled for want of a
          password. It is an action that currently has nothing to act on, not a
          status display, and demoting it to plain text would file it under the
          wrong kind the moment somebody sets APP_PASSWORD. */}
      <div className="flex flex-col gap-3 rounded-xl border bg-card p-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5 font-medium">
            <LogOut className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
            {t("settings.security.devices")}
          </div>
          {authOff ? (
            <p className="mt-0.5 text-sm text-muted-foreground">
              {t("settings.security.noPassword")}
            </p>
          ) : (
            <p className="mt-0.5 text-sm text-muted-foreground">
              {t("settings.security.signOutOthers")}
              {session?.expiresAt && (
                <>
                  {" "}{t("settings.security.sessionUntil", { when: formatDate(session.expiresAt) })}
                </>
              )}
            </p>
          )}
        </div>
        <div className="shrink-0">
          <Button variant="outline" onClick={signOutOthers} disabled={working || authOff} className="gap-1.5">
            <LogOut className="h-4 w-4" /> {t("settings.security.signOutButton")}
          </Button>
        </div>
      </div>
    </SettingsSection>
  );
}
