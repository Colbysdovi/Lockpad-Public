// Smart-link provider registry + matcher (prd-smart-link-blocks.md).
//
// Recognition is PURELY string-based against the pasted URL — hostname + optional
// path pattern. NOTHING is ever fetched (no DNS, no favicon service, no metadata),
// which is the feature's load-bearing privacy guarantee. Adding a provider is a data
// change here (+ a slug in smartLinkIconData if a brand icon exists), never a change
// to the matching logic.
//
// `icon` is a slug into BRAND_ICONS (see smartLinkIconData.ts). A few providers whose
// brand marks were removed from the icon set for trademark reasons (LinkedIn, Slack,
// CodePen) intentionally have no icon and render a neutral fallback glyph + their
// label — still recognizable, and safer trademark-wise.

interface Matcher {
  host: string; // matched as an exact host OR a subdomain suffix (".host")
  path?: RegExp; // optional pathname guard, to split providers that share a host
}

export interface Provider {
  id: string;
  label: string;
  icon?: string; // BRAND_ICONS slug; omitted → neutral fallback glyph
  match: Matcher[];
}

// Order matters only among providers sharing a host (path-guarded ones first). Every
// other provider is host-unique.
export const PROVIDERS: Provider[] = [
  // Video
  { id: "youtube", label: "YouTube", icon: "youtube", match: [{ host: "youtube.com" }, { host: "youtu.be" }] },
  { id: "vimeo", label: "Vimeo", icon: "vimeo", match: [{ host: "vimeo.com" }] },
  { id: "twitch", label: "Twitch", icon: "twitch", match: [{ host: "twitch.tv" }] },
  { id: "loom", label: "Loom", icon: "loom", match: [{ host: "loom.com" }] },
  // Design & collaboration
  { id: "figma", label: "Figma", icon: "figma", match: [{ host: "figma.com" }] },
  { id: "miro", label: "Miro", icon: "miro", match: [{ host: "miro.com" }] },
  { id: "sketch", label: "Sketch", icon: "sketch", match: [{ host: "sketch.com" }] },
  // Google apps (docs.google.com is shared → path-guarded; check these before Drive)
  { id: "googledocs", label: "Google Docs", icon: "googledocs", match: [{ host: "docs.google.com", path: /^\/document\// }] },
  { id: "googlesheets", label: "Google Sheets", icon: "googlesheets", match: [{ host: "docs.google.com", path: /^\/spreadsheets\// }] },
  { id: "googleslides", label: "Google Slides", icon: "googleslides", match: [{ host: "docs.google.com", path: /^\/presentation\// }] },
  { id: "googledrive", label: "Google Drive", icon: "googledrive", match: [{ host: "drive.google.com" }] },
  { id: "googlemaps", label: "Google Maps", icon: "googlemaps", match: [
    { host: "maps.google.com" },
    { host: "google.com", path: /^\/maps/ },
    { host: "maps.app.goo.gl" },
    { host: "goo.gl", path: /^\/maps/ },
  ] },
  // Docs & productivity
  { id: "notion", label: "Notion", icon: "notion", match: [{ host: "notion.so" }, { host: "notion.site" }] },
  { id: "dropbox", label: "Dropbox", icon: "dropbox", match: [{ host: "dropbox.com" }] },
  { id: "airtable", label: "Airtable", icon: "airtable", match: [{ host: "airtable.com" }] },
  // Professional & social
  { id: "linkedin", label: "LinkedIn", match: [{ host: "linkedin.com" }] },
  { id: "x", label: "X", icon: "x", match: [{ host: "x.com" }, { host: "twitter.com" }] },
  { id: "instagram", label: "Instagram", icon: "instagram", match: [{ host: "instagram.com" }] },
  { id: "facebook", label: "Facebook", icon: "facebook", match: [{ host: "facebook.com" }, { host: "fb.com" }] },
  { id: "reddit", label: "Reddit", icon: "reddit", match: [{ host: "reddit.com" }] },
  { id: "tiktok", label: "TikTok", icon: "tiktok", match: [{ host: "tiktok.com" }] },
  { id: "pinterest", label: "Pinterest", icon: "pinterest", match: [{ host: "pinterest.com" }] },
  // Dev
  { id: "github", label: "GitHub", icon: "github", match: [{ host: "github.com" }] },
  { id: "gitlab", label: "GitLab", icon: "gitlab", match: [{ host: "gitlab.com" }] },
  { id: "codepen", label: "CodePen", match: [{ host: "codepen.io" }] },
  { id: "codesandbox", label: "CodeSandbox", icon: "codesandbox", match: [{ host: "codesandbox.io" }] },
  { id: "npm", label: "npm", icon: "npm", match: [{ host: "npmjs.com" }] },
  // Communication
  { id: "slack", label: "Slack", match: [{ host: "slack.com" }] },
  { id: "discord", label: "Discord", icon: "discord", match: [{ host: "discord.com" }, { host: "discord.gg" }] },
  { id: "zoom", label: "Zoom", icon: "zoom", match: [{ host: "zoom.us" }] },
  { id: "whatsapp", label: "WhatsApp", icon: "whatsapp", match: [{ host: "whatsapp.com" }, { host: "wa.me" }] },
  { id: "telegram", label: "Telegram", icon: "telegram", match: [{ host: "t.me" }, { host: "telegram.org" }] },
  // Music
  { id: "spotify", label: "Spotify", icon: "spotify", match: [{ host: "spotify.com" }] },
  { id: "applemusic", label: "Apple Music", icon: "applemusic", match: [{ host: "music.apple.com" }] },
  // Project management
  { id: "trello", label: "Trello", icon: "trello", match: [{ host: "trello.com" }] },
  { id: "asana", label: "Asana", icon: "asana", match: [{ host: "asana.com" }] },
  { id: "jira", label: "Jira", icon: "jira", match: [{ host: "atlassian.net" }] },
  { id: "linear", label: "Linear", icon: "linear", match: [{ host: "linear.app" }] },
  // Portfolio & writing
  { id: "behance", label: "Behance", icon: "behance", match: [{ host: "behance.net" }] },
  { id: "dribbble", label: "Dribbble", icon: "dribbble", match: [{ host: "dribbble.com" }] },
  { id: "medium", label: "Medium", icon: "medium", match: [{ host: "medium.com" }] },
  // Travel
  { id: "airbnb", label: "Airbnb", icon: "airbnb", match: [{ host: "airbnb.com" }] },
];

const BY_ID = new Map(PROVIDERS.map((p) => [p.id, p]));

export function providerById(id: string | null | undefined): Provider | null {
  return id ? BY_ID.get(id) ?? null : null;
}

function hostMatches(hostname: string, host: string): boolean {
  return hostname === host || hostname.endsWith("." + host);
}

/** Parse a URL string, tolerating a missing scheme (defaults to https). null if it
 *  isn't a plausible absolute URL. */
export function parseUrl(raw: string): URL | null {
  const text = raw.trim();
  // A bare "youtube.com/..." has no scheme; prepend https for parsing. Reject anything
  // with whitespace or that clearly isn't a hostname.disallow non http(s) schemes.
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(text) ? text : `https://${text}`;
  try {
    const url = new URL(withScheme);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    if (!url.hostname.includes(".")) return null; // "localhost", bare words → not a link
    return url;
  } catch {
    return null;
  }
}

/** The provider a URL belongs to, or null if it matches none (→ stays a plain link). */
export function matchProvider(raw: string): Provider | null {
  const url = parseUrl(raw);
  if (!url) return null;
  const hostname = url.hostname.toLowerCase().replace(/^www\./, "");
  for (const provider of PROVIDERS) {
    for (const m of provider.match) {
      if (hostMatches(hostname, m.host) && (!m.path || m.path.test(url.pathname))) {
        return provider;
      }
    }
  }
  return null;
}
