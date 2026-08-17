// What version of Lockpad is this, and where does someone go to see what changed.
//
// The version is BAKED IN at build time (`VITE_APP_VERSION`, set by the Dockerfile
// and by CI — see docs/RELEASING.md). It is deliberately not stored in the database
// and not fetched from anywhere: a value that travels with the build artifact can
// never disagree with the code that is running. Update the image, and the number
// changes by itself.
//
// Nothing here ever talks to the network. "Check for updates" is a plain link the
// user's own browser follows — the same kind of thing as a bookmark. Lockpad makes
// zero outbound requests, and a background update-check would be the first crack in
// that; whether a newer release exists is worth a click, not a beacon.

// CI passes the git tag on a tagged build ("v1.3.0"), and a short commit marker
// otherwise ("main-a1b2c3d"). A local `docker compose build` passes nothing, so the
// Dockerfile's own default of "dev" applies.
const RAW = import.meta.env.VITE_APP_VERSION?.trim();

/** The exact string the build was stamped with. Never empty. */
export const APP_VERSION = RAW && RAW.length > 0 ? RAW : "dev";

/** True only for a real tagged release (`v1.2.3`), which is what decides whether we
 *  present this as a version or as a development build. Anything else — "dev", a
 *  commit marker, a hand-set string — is NOT a release and must not look like one,
 *  or a bug report against "v1.3.0" could mean any of a dozen different builds. */
export const IS_RELEASE = /^v\d+\.\d+\.\d+(?:[-+].+)?$/.test(APP_VERSION);

/** Every release line gets a name as well as a number — the series is cities and towns in
 *  Benin, and the pool it is drawn from is docs/release-names.md. Deliberately not
 *  alphabetical: the point is recall, and "are you on Ganvié?" is a question someone can
 *  answer without looking it up.
 *
 *  Keyed by the MAJOR.MINOR line rather than the exact version, because a patch release
 *  keeps its line's name — v1.0.1 is still Ganvié. Patches fix things; they do not
 *  re-brand. A line with no entry here simply shows its number, which is what makes
 *  forgetting to add one harmless rather than a blank on screen. */
const RELEASE_NAMES: Record<string, string> = {
  "1.0": "Ganvié",
};

/** The name for this build, or null if there isn't one — an untagged build never gets a
 *  name, because a name would present it as a release when it is not. */
export const RELEASE_NAME: string | null = (() => {
  if (!IS_RELEASE) return null;
  const line = APP_VERSION.replace(/^v/, "").split(".").slice(0, 2).join(".");
  return RELEASE_NAMES[line] ?? null;
})();

/** How the version reads in the interface. The separator is part of the name branch, not
 *  appended afterwards, so an unnamed release can never render a dangling "v1.4.0 ·". */
export const VERSION_LABEL = IS_RELEASE
  ? RELEASE_NAME
    ? `${APP_VERSION} · ${RELEASE_NAME}`
    : APP_VERSION
  : `Development build (${APP_VERSION})`;

/** Where "Check for updates" sends the browser. The PUBLIC repo: it is the one a
 *  self-hosted user can actually open, and the releases there are the releases the
 *  published images correspond to. */
export const RELEASES_URL = "https://github.com/Colbysdovi/Lockpad-Public/releases";
