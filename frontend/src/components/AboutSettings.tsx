import { useEffect, useState } from "react";
import { ExternalLink } from "@/components/icons";
import { SettingsSection, InfoBlock } from "@/components/SettingsPrimitives";
import { api } from "@/lib/api";
import { APP_VERSION, IS_RELEASE, RELEASES_URL, VERSION_LABEL } from "@/lib/version";

// Settings → About.
//
// Two things, both in service of one question: "what am I actually running, and is
// there something newer?"
//
// The version comes from the build itself (see lib/version.ts), so it updates the
// moment the image does and can never be stale. "Check for updates" is a LINK, not
// a check: Lockpad never contacts anyone, and a background version poll would be
// the first outbound request this app has ever made. Following a link is the user's
// browser doing what browsers do — the server is not involved at all.

interface Health {
  status: string;
  // Older backends (anything built before this feature) simply omit it.
  version?: string;
}

export function AboutSettings() {
  // The frontend knows its own version at build time; the backend's has to be
  // asked for. They are built and published together, so they normally agree —
  // when they don't, someone pulled one image and not the other, and that is
  // worth saying out loud rather than quietly showing one of the two.
  const [serverVersion, setServerVersion] = useState<string | null>(null);

  useEffect(() => {
    api.get<Health>("/health")
      .then((h) => setServerVersion(h.version ?? null))
      // Health is public and unthrottled, so a failure here means the server is
      // unreachable — which the rest of the app already surfaces. Stay quiet.
      .catch(() => setServerVersion(null));
  }, []);

  const mismatched = serverVersion !== null && serverVersion !== APP_VERSION;

  return (
    <SettingsSection
      id="about-heading"
      title="About"
      description="What this instance is running, and where newer versions are announced."
      className="mt-10"
    >
      {/* Plain text, no card, no button — because there is nothing here to do.
          Everything else on this page that wears a border does something when you
          click it, and a version number borrowing that shape sends people to press
          it. What used to be a "Check for updates" button is now the link it always
          really was: it has never checked anything, it opens GitHub. Dressing a
          navigation link as an app action was the misleading part. */}
      <InfoBlock title={<>Lockpad {VERSION_LABEL}</>}>
        <p>
          {IS_RELEASE
            ? "Quote this version if you report a problem — it points at exactly this code."
            : "Built from source rather than from a tagged release, so there is no release number to give."}
        </p>

        {/* A half-finished update: the two images are published together, so a
            disagreement means only one of them was pulled. Naming both versions
            is what turns a confusing bug report into an obvious fix. */}
        {mismatched && (
          <p className="mt-2 rounded-lg border border-[color-mix(in_srgb,var(--muted-foreground)_35%,transparent)] bg-[color-mix(in_srgb,var(--muted)_50%,transparent)] p-2">
            The server is running <span className="font-medium">{serverVersion}</span> while this page came from{" "}
            <span className="font-medium">{APP_VERSION}</span>. Pull both images and restart so they match.
          </p>
        )}

        {/* A real link, not a button that fetches: your browser navigates to
            GitHub, Lockpad requests nothing on your behalf. */}
        <p className="mt-2">
          <a
            href={RELEASES_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 font-medium text-foreground underline underline-offset-4 hover:text-primary"
          >
            <ExternalLink className="h-3.5 w-3.5" /> Releases on GitHub
          </a>
        </p>

        <p className="mt-2 text-xs">
          Lockpad itself never checks for updates and makes no outbound requests of any kind.
        </p>
      </InfoBlock>
    </SettingsSection>
  );
}
