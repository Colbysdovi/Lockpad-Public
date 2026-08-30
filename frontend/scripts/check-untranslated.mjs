// Fail the build on a user-facing English string that never made it into the
// catalogue.
//
// ── Why this exists ─────────────────────────────────────────────────────────
//
// The typed catalogue already guarantees that French has every key English has —
// a missing translation is a compile error. What it cannot see is a string that
// was never extracted in the first place: `<Button>Empty trash</Button>` compiles
// perfectly and is simply English forever.
//
// That gap was found the expensive way. Four separate rounds of "the app is
// translated" were followed by somebody opening a dialog and finding English in
// it, because the strings that get missed are the ones behind confirmations,
// error states and empty states — exactly the surfaces nobody clicks through
// while checking. Reading the interface cannot find them. Reading the source can.
//
// ── What it looks at ────────────────────────────────────────────────────────
//
// Comments are stripped first, then three places copy actually lives:
//   1. JSX text nodes, including ones that span lines or follow an icon element
//   2. props that render as copy (label, placeholder, aria-label, title, …)
//   3. calls that surface text (toast, setError, setAnnouncement, announce)
//
// It is deliberately noisy rather than clever. A false positive costs one line in
// ALLOWED below, with a reason; a false negative costs a French speaker finding
// English in a dialog.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(fileURLToPath(new URL(".", import.meta.url)), "..", "src");

const COPY_PROPS =
  "aria-label|placeholder|title|label|description|confirmLabel|cancelLabel|triggerLabel|emptyLabel|alt|announcement";
const COPY_CALLS = "toast|setError|setAnnouncement|announce";

/** Object fields that are never rendered. `source` records where a keyboard binding
 *  is defined, for whoever maintains the shortcut table. */
const NON_COPY_FIELDS = /\bsource:\s*$/;

/** Paths whose strings are not user-facing. */
const SKIP_PATHS = [`${"lib"}/i18n/`, "vite-env", ".test."];

/**
 * Strings that look like copy and are not. Every entry needs a reason — an
 * allowlist without reasons becomes the place regressions go to hide.
 */
const ALLOWED = new Map([
  ["Lockpad", "the product name, untranslated in both languages by the glossary"],
  ["English", "a language name, deliberately written in its own language"],
  ["Français", "a language name, deliberately written in its own language"],
  ["Enter", "a keycap. The key on the reader's keyboard says Enter whatever the interface says"],
  ["Promise", "a TypeScript generic parameter caught by the JSX-text pattern"],
  ["Partial", "a TypeScript generic parameter caught by the JSX-text pattern"],
  ["Keep-export.json", "a filename in the onboarding illustration, not copy"],
  ["Replay first run (dev)", "dev-only; import.meta.env.DEV removes this branch from production builds"],
  ["Re-arm", "dev-only; see above"],
  [
    "Re-arms the first-run flag so the welcome animation and the wizard play again on reload. Adds no notes, because starter-note seeding stays done. Never ships to production.",
    "dev-only; see above",
  ],
  ["Onboarding reset is development-only.", "dev-only error from a route production does not serve"],
  ["ProseMirror note-preview", "a className, matched because it happens to start with a capital"],
  // Brand names. Never translated in either language — "Google Docs" is called that
  // in French too — and they identify a service rather than describing anything.
  ["Google Docs", "a brand name"],
  ["Google Sheets", "a brand name"],
  ["Google Slides", "a brand name"],
  ["Google Drive", "a brand name"],
  ["Google Maps", "a brand name"],
  ["Apple Music", "a brand name"],
  ["Layout.tsx", "the `source` field on a shortcut: developer metadata, never rendered"],
]);

/**
 * Contexts in which a quoted string is code rather than copy. Matched against the
 * ~40 characters before the literal.
 *
 * `t(` and `translate(` are here because a string ALREADY in the catalogue is the
 * catalogue's own English value being read back, not an untranslated one.
 *
 * A `[:,]` rule used to sit here and was removed: it excluded the else-branch of
 * every ternary, which is exactly where `{busy ? "Emptying…" : "Empty trash"}` hides
 * — the shape that prompted this script in the first place. Object values are copy
 * often enough to be worth the extra noise too.
 */
const NOT_COPY_CONTEXT =
  /(?:className|class|key|type|role|to|href|src|id|name|value|htmlFor|data-[\w-]+|rel|target|method|autoComplete|inputMode|accept|scope|slot|as|variant|side|align|granularity|style)\s*=\s*$|(?:from|import)\s+$|\b(?:t|tr|translate|tOutsideReact|getAttribute|setAttribute|querySelector|querySelectorAll|classList\.(?:add|remove|toggle|contains)|matchMedia|getItem|setItem|removeItem|createElement|addEventListener|removeEventListener|includes|startsWith|endsWith|split|join|replace|localStorage|sessionStorage)\(\s*$/;

function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
    .replace(/^\s*\/\/.*$/gm, "")
    .replace(/(?<=[;,)}\s])\/\/[^\n]*$/gm, "");
}

/** Does this read as English copy rather than as code?
 *
 *  The single most useful discriminator turned out to be the FIRST CHARACTER. Copy
 *  a person reads starts with a capital: "Empty trash", "Emptying…", "Archive",
 *  "Cancel". Code that happens to be a string almost never does — Tailwind class
 *  lists, CSS values, ProseMirror node names, query selectors and enum members are
 *  all lower-case or start with punctuation. Requiring a capital took this pass from
 *  404 findings to a handful without losing anything that mattered. */
function looksLikeCopy(value) {
  const v = value.trim();
  if (v.length < 3) return false;
  if (ALLOWED.has(v)) return false;
  // Must start like a sentence.
  if (!/^[A-Z]/.test(v)) return false;
  // A translated string carries French markers; treat those as already done.
  if (/[àâäçéèêëîïôöùûüœÀÂÄÇÉÈÊËÎÏÔÖÙÛÜŒ]/.test(v)) return false;
  // CSS values and Tailwind class lists.
  if (/var\(|calc\(|--|\d(?:px|rem|em|vh|vw|%)\b/.test(v)) return false;
  // camelCase or PascalCase identifiers: capitalised, no space, no sentence
  // punctuation. "Archive" is copy; "Placeholder" as a component name is not, so a
  // single bare word is only treated as copy when it reaches the interface through
  // one of the shape-specific passes above rather than through this broad one.
  if (!/[\s.…!?:]/.test(v)) return false;
  if (v.startsWith("http") || v.startsWith("/") || v.includes("${")) return false;
  return /[A-Za-z]{3,}/.test(v);
}

function* walk(dir) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) yield* walk(full);
    else if (/\.tsx?$/.test(entry)) yield full;
  }
}

const findings = [];
let filesChecked = 0;

for (const file of walk(root)) {
  const rel = relative(root, file);
  if (SKIP_PATHS.some((s) => rel.includes(s))) continue;
  filesChecked++;
  const src = stripComments(readFileSync(file, "utf8"));
  const lineOf = (index) => src.slice(0, index).split("\n").length;

  const record = (index, what) => findings.push(`${rel}:${lineOf(index)}  ${what}`);

  for (const m of src.matchAll(new RegExp(`(${COPY_PROPS})="([^"]+)"`, "g"))) {
    if (looksLikeCopy(m[2])) record(m.index, `${m[1]}="${m[2]}"`);
  }
  for (const m of src.matchAll(new RegExp(`(${COPY_CALLS})\\(\\s*"([^"]+)"`, "g"))) {
    if (looksLikeCopy(m[2])) record(m.index, `${m[1]}("${m[2]}")`);
  }
  // Every remaining string literal in the file.
  //
  // This is the broadest pass and it is the one that matters. The three above look
  // at specific SHAPES, and the string that prompted all of this fitted none of
  // them: `{emptying ? "Emptying…" : "Empty trash"}` is a JSX expression, so it is
  // not a text node, and neither literal sits in a prop. Anything that only knows
  // about shapes will keep missing whichever shape nobody thought of.
  //
  // So: look at every literal, and rule out the contexts that are definitely not
  // copy. Erring toward noise is deliberate — the failure this exists to prevent is
  // silent, and the failure it risks costs one allowlist line.
  for (const m of src.matchAll(/"([^"\n]{3,200})"/g)) {
    const value = m[1];
    if (!looksLikeCopy(value)) continue;
    const before = src.slice(Math.max(0, m.index - 40), m.index);
    if (NOT_COPY_CONTEXT.test(before) || NON_COPY_FIELDS.test(before)) continue;
    record(m.index, `string literal: ${JSON.stringify(value)}`);
  }

  // JSX text, collapsed across newlines so `<Icon />\n  Empty trash\n</Button>` is
  // caught — that exact shape is how "Empty trash" survived four manual sweeps.
  // `(?<![=!<>])` keeps the `>` of an arrow function or a comparison from being read
  // as the end of a JSX tag — `x => api.post(...)` followed by a `<` elsewhere on the
  // line otherwise looks exactly like a text node.
  for (const m of src.matchAll(/(?<![=!<>])>((?:[^<>{}]|\n){3,160}?)</g)) {
    const text = m[1].replace(/\s+/g, " ").trim();
    if (/^[A-Z]/.test(text) && looksLikeCopy(text)) record(m.index, `JSX text: ${JSON.stringify(text)}`);
  }
}

if (findings.length) {
  console.error(
    `\ncheck-untranslated: ${findings.length} user-facing string(s) not in the catalogue\n`
  );
  for (const f of [...new Set(findings)].sort()) console.error("  " + f);
  console.error(
    `\nMove each into frontend/src/lib/i18n/catalog.en.ts and catalog.fr.ts and read it` +
      `\nwith t(). If one is genuinely not copy, add it to ALLOWED in this script WITH` +
      `\nA REASON — an allowlist without reasons is where regressions hide.\n`
  );
  process.exit(1);
}

console.log(`check-untranslated: clean (${filesChecked} files).`);
