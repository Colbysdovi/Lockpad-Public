// The development backend: a complete, disposable Lockpad, seeded and ready.
//
// Running this boots an embedded Postgres, applies the real migrations, fills the
// database with a demo library, and starts the ACTUAL backend on :4000 — the same
// app.ts the production server builds, not a stub. `npm run dev` in the frontend
// proxies to it. Nothing needs to be installed and nothing is left behind.
//
// IMPORTANT: the database is created fresh on every start, so RESTARTING THIS
// THROWS AWAY WHATEVER YOU WERE DOING and re-seeds from scratch. That is what makes
// it reliable for QA — every session begins from an identical, known library — but
// it also means the backend has no watch mode: picking up a backend change means a
// restart, and a restart means losing any notes typed in the meantime.
//
// Two modes. Plain `npm run dev:preview` gives the demo library below, marked as
// already onboarded — the normal world, and the one every other feature is QA'd
// against. `SEED=none npm run dev:preview` gives an empty, never-onboarded instance,
// which is the only way to exercise the genuine first-run path (welcome animation,
// starter-note seeding, the wizard). See the onboarding block near the bottom.
//
// The seed below is written to be REALISTIC rather than minimal: notes of every
// kind (checklists, code, quotes, smart links, a locked one), spread across folders
// and tags, pinned in different scopes, with timestamps fanned out over weeks. A
// demo library that all looks the same hides exactly the bugs manual QA is for —
// ordering, truncation, empty states, colour, and how a long list actually behaves.
import { startTestDb } from "./helpers/db.js";

const db = await startTestDb();
process.env.DATABASE_URL = db.url;
process.env.LOG_DIR = "./logs";
process.env.CORS_ORIGINS = "http://localhost:5173";
process.env.BACKEND_PORT = "4000";

const { buildApp } = await import("../src/app.js");
const { prisma } = await import("../src/prisma.js");

const app = buildApp();

// ── TipTap content builders ──────────────────────────────────────────────────
// Small helpers that produce ProseMirror/TipTap doc JSON so the seed reads like
// prose. Strings are auto-wrapped as text nodes; pass a node for rich inline
// content (e.g. links). Node types match the editor's extensions (StarterKit +
// TaskList/TaskItem + Link + CodeBlockLowlight).
type J = any;
const inl = (x: J | string): J => (typeof x === "string" ? { type: "text", text: x } : x);
const link = (text: string, href: string): J => ({ type: "text", text, marks: [{ type: "link", attrs: { href } }] });
const p = (...c: (J | string)[]): J => (c.length ? { type: "paragraph", content: c.map(inl) } : { type: "paragraph" });
const h = (level: number, ...c: (J | string)[]): J => ({ type: "heading", attrs: { level }, content: c.map(inl) });
const quote = (...c: (J | string)[]): J => ({ type: "blockquote", content: [p(...c)] });
const bullet = (...items: (string | J[])[]): J => ({
  type: "bulletList",
  content: items.map((it) => ({ type: "listItem", content: [{ type: "paragraph", content: (typeof it === "string" ? [it] : it).map(inl) }] })),
});
const ordered = (...items: (string | J[])[]): J => ({
  type: "orderedList",
  content: items.map((it) => ({ type: "listItem", content: [{ type: "paragraph", content: (typeof it === "string" ? [it] : it).map(inl) }] })),
});
const tasks = (...items: [boolean, string | J[]][]): J => ({
  type: "taskList",
  content: items.map(([checked, it]) => ({ type: "taskItem", attrs: { checked }, content: [{ type: "paragraph", content: (typeof it === "string" ? [it] : it).map(inl) }] })),
});
const code = (language: string, text: string): J => ({ type: "codeBlock", attrs: { language }, content: [{ type: "text", text }] });
// Smart-link block (prd-smart-link-blocks.md): an atom whose whole appearance is
// derived from the stored URL + provider id. `provider` must match an id in
// frontend/src/lib/smartLinkProviders.ts, otherwise it renders as a generic link.
const slink = (provider: string, url: string): J => ({ type: "smartLink", attrs: { url, provider } });
const doc = (...content: J[]): J => ({ type: "doc", content });

// ── Folders & tags ───────────────────────────────────────────────────────────
const fProduct = await prisma.folder.create({ data: { name: "Product", color: "#d8b4fe" } });
const fEng = await prisma.folder.create({ data: { name: "Engineering", color: "#93c5fd" } });
// Top-level, like every other folder here. The SCHEMA supports nesting
// (parentFolderId, self-referential) and the API still honours it, but the
// front-end does not present a folder tree — so a nested folder in the demo
// library would be showing a shape the product does not have. A seed exists to
// rehearse the real thing; anything in it that cannot be reached through the UI
// is a false rehearsal, and the first bug it hides is "how does this even
// render". Nest here again only if the front-end grows a tree to nest into.
const fLockpad = await prisma.folder.create({ data: { name: "Lockpad", color: "#fca5a5" } });
const fIdeas = await prisma.folder.create({ data: { name: "Ideas", color: "#fcd34d" } });
const fPersonal = await prisma.folder.create({ data: { name: "Personal", color: "#86efac" } });

// Leftovers, so the Settings cleanup actually has something to clean in dev. Three
// plain empty folders, each offered separately. "Q1 drafts" used to be a CHILD of
// "Archive 2024", which made the pair one empty subtree that cleanup offered as a
// single entry — a genuinely different case, but one no user can create while the
// front-end has no way to nest a folder. It is flat now for the same reason as
// "Lockpad" above. If nesting ever reaches the UI, re-parenting this line is the
// one-word change that brings the subtree case back.
const fOldArchive = await prisma.folder.create({ data: { name: "Archive 2024", color: "#cbd5e1" } });
await prisma.folder.create({ data: { name: "Q1 drafts" } });
await prisma.folder.create({ data: { name: "Scratch" } });
// Tags created and then abandoned — never applied to any note below.
for (const name of ["roadmap", "q3-planning"]) await prisma.tag.create({ data: { name } });

const tagCache = new Map<string, string>();
async function tag(name: string): Promise<string> {
  let id = tagCache.get(name);
  if (!id) {
    const t = await prisma.tag.create({ data: { name } });
    id = t.id;
    tagCache.set(name, id);
  }
  return id;
}

// ── The dataset ──────────────────────────────────────────────────────────────
// A Senior Product Designer/Engineer's personal notes: product thinking, eng
// notes, checklists, quotes, business ideas, and life admin. Varied title/body
// length, colors, tags, folders, pins, and a few archived/trashed for demoing.
interface Seed {
  title: string;
  color?: string | null;
  folderId?: string | null;
  tags?: string[];
  pin?: "all" | { folder: string } | { tag: string };
  archived?: boolean;
  deleted?: boolean;
  agoMin: number; // updatedAt = now - agoMin
  content: J;
}

const MIN = 1, HOUR = 60, DAY = 60 * 24;

const notes: Seed[] = [
  {
    // Covers the smart-link block type so "All notes" shows every kind of content a
    // note can hold. Four different providers, so the bundled brand marks (and the
    // preview's smart-link styling) are all exercised at once.
    title: "Handoff links for the settings redesign",
    folderId: fProduct.id,
    tags: ["design", "ux"],
    agoMin: 12 * MIN,
    content: doc(
      p("Everything for Thursday's review in one place, so nobody has to dig through Slack again."),
      slink("figma", "https://www.figma.com/file/8kQ2mXvR/lockpad-settings-redesign"),
      slink("linear", "https://linear.app/lockpad/issue/LP-482/settings-information-architecture"),
      slink("github", "https://github.com/lockpad/lockpad/pull/311"),
      slink("youtube", "https://www.youtube.com/watch?v=wf-BqAjZb8M"),
      p("Open question for the review: do we keep Advanced as a separate page, or collapse it into a disclosure at the bottom of each section?"),
    ),
  },
  {
    // Deliberate "max case": a very long note to stress the sticky toolbar while
    // scrolling. Pinned so it's always one click away.
    title: "Master doc: everything I know about building Lockpad (the long one)",
    color: "indigo",
    folderId: fEng.id,
    tags: ["engineering", "architecture", "design"],
    pin: "all",
    agoMin: 5 * MIN,
    content: doc(
      p("A running brain-dump of how Lockpad fits together — kept in one place so I stop re-deriving the same decisions. Long on purpose; skim the headings."),
      h(2, "First principles"),
      ordered(
        "Your notes live on your hardware. No account, no cloud, no telemetry.",
        "The server can hold ciphertext but never the key or the plaintext.",
        "Calm by default: warm surfaces, quiet motion, nothing that nags.",
        "Make the right thing the easy thing; make the dangerous thing reversible.",
        "Boring, legible tech beats clever tech that only I understand.",
      ),
      quote("If I can't explain a subsystem to a tired version of myself at 2am, it's too complex."),
      h(2, "Architecture at a glance"),
      p("Fastify + Prisma over Postgres on the backend; Vite + React + TanStack Query on the front. One process, one database, one static bundle. Everything is bundled locally so the running app makes zero outbound requests."),
      p("Requests flow client → /api (Vite proxy in dev, reverse proxy in prod) → Fastify routes → Prisma → Postgres. The list is cursor-paginated and virtualized; the editor is TipTap/ProseMirror."),
      code("text", "browser ──/api──> Fastify ──> Prisma ──> Postgres\n   │                                   ▲\n   └── TanStack Query cache ── invalidate ┘"),
      h(2, "Data model"),
      p("Small on purpose. A note is the center of gravity; everything else hangs off it."),
      bullet(
        "Note — title, content (TipTap JSON), color, folderId, isLocked, encryptedContent, cryptoMeta, archivedAt, deletedAt, timestamps.",
        "Folder — self-referential tree (parentFolderId), optional color.",
        "Tag — unique name, joined to notes through NoteTag.",
        "NoteLink — directed source→target edges for backlinks.",
        "PinnedNote — (noteId, scope) so pinning is per page: \"all\" | \"folder:<id>\" | \"tag:<id>\".",
      ),
      h(2, "Security model"),
      p("Locking is client-side. When you lock a note we derive a key from your passphrase with Argon2id, encrypt the content in the browser, and send only the ciphertext + KDF params. The plaintext and the key never leave the tab."),
      code("typescript", "async function lock(note: Note, passphrase: string) {\n  const salt = crypto.getRandomValues(new Uint8Array(16));\n  const key = await argon2id({ pass: passphrase, salt, memoryCost: 19456, timeCost: 2, parallelism: 1 });\n  const iv = crypto.getRandomValues(new Uint8Array(12));\n  const ciphertext = await aesGcmEncrypt(key, iv, serialize(note.content));\n  return { ciphertext, cryptoMeta: { kdf: 'argon2id', salt, iv } };\n}"),
      p("Threat model I actually care about: someone with read access to the DB or a backup should learn nothing about locked notes beyond their existence and size."),
      tasks(
        [true, "Key derivation is client-side"],
        [true, "Ciphertext-only at rest for locked notes"],
        [false, "Length-hiding padding for locked bodies"],
        [false, "Recovery-code flow (so a forgotten passphrase isn't fatal)"],
        [false, "Threat-model doc reviewed by a second pair of eyes"],
      ),
      h(2, "Frontend notes"),
      p("The list is a virtualized card grid — lanes computed from container width, rows measured so variable-height cards self-correct. The detail view is a centered modal that expands from the clicked card and shrinks back into it on close."),
      p("The title row and the formatting toolbar are both sticky: the title pins under the top edge, and the toolbar pins directly beneath it using a CSS variable (--note-title-h) published by a ResizeObserver, so the toolbar always lands right under the title even when the title wraps to multiple lines."),
      bullet(
        "Sticky detection uses an IntersectionObserver on a 1px sentinel, not a per-frame scroll handler.",
        "Motion honors prefers-reduced-motion app-wide via a single MotionConfig.",
        "Top/bottom list gradients fade notes into the canvas as they leave the viewport.",
        "Every icon button shares one hover scrim + a styled tooltip.",
      ),
      h(2, "Performance budget"),
      bullet(
        "JS ≤ 180 KB gzipped on first load.",
        "First note interactive < 1.5s on a mid-range Android.",
        "No layout shift on card hover — the action bar's height is reserved, not toggled.",
        "Never animate backdrop-filtered elements; it forces per-frame recomposite.",
      ),
      h(2, "Design system"),
      p("Warm terracotta over the borrowed blue/slate. Cream canvas, espresso text, a brick-red primary, and a cooler crimson for destructive so \"delete\" never reads like the brand color."),
      bullet(
        [inl("Canvas "), link("#F2EAE0", "https://www.colorhexa.com/f2eae0"), inl(" · Primary "), link("#A34B3C", "https://www.colorhexa.com/a34b3c")],
        [inl("Text "), link("#3B2F27", "https://www.colorhexa.com/3b2f27"), inl(" · Destructive "), link("#9E1B32", "https://www.colorhexa.com/9e1b32")],
        "Interaction scrim derives from the foreground so hovers feel warm, not grey.",
        "Tooltips are a dark espresso chip in both themes for one consistent label.",
      ),
      quote("The details are not the details. They make the design. — Charles Eames"),
      h(2, "Roadmap"),
      h(3, "v0.5 — trust & recovery"),
      tasks([false, "Recovery codes"], [false, "WebAuthn unlock"], [false, "Per-note lock hint on the dialog"]),
      h(3, "v0.6 — mobile polish"),
      tasks([false, "Bottom-sheet gestures"], [false, "Offline queue for edits"], [false, "Home-screen PWA install nudge"]),
      h(2, "Things that have bitten me"),
      ordered(
        "Animating a scaled, backdrop-blurred panel → jank. Fix: ease-in on close, no blur mid-transform.",
        "Installing a dep after Vite's dep-scan → duplicate React. Fix: cold restart so it optimizes in one pass.",
        "getBoundingClientRect during the open animation returns the mid-scale height → toolbar pinned too high. Use offsetHeight.",
        "@updatedAt is auto-managed, so seed timestamps need raw SQL to backdate.",
      ),
      h(2, "Open questions"),
      bullet(
        "Do we ever want cross-device sync, or is that a different product?",
        "Is a plugin surface worth the security surface it opens?",
        "How much of the editor should be keyboard-only navigable before v1?",
        "What's the story for very large notes (10k+ words) — do we chunk the doc?",
      ),
      p("If you're reading this far, congratulations — you've now scrolled far enough to prove the sticky toolbar keeps up. That was the whole point of making this note absurdly long."),
      p("End of the master doc. Everything below the fold in real notes should feel exactly this calm to scroll through."),
    ),
  },
  {
    title: "Why our onboarding drops off at step 3",
    color: "red",
    folderId: fProduct.id,
    tags: ["ux", "design"],
    pin: "all",
    agoMin: 12 * MIN,
    content: doc(
      p("Step 3 asks people to set a passphrase before they've felt any value. Funnel says we lose ~38% right here."),
      h(3, "Hypotheses"),
      bullet(
        "The passphrase screen reads as a chore, not a benefit — no framing of what it protects.",
        "We ask for it before the first note exists, so there's nothing to lose yet.",
        "No password-manager affordance → people stall trying to invent one.",
      ),
      p("Next: try deferring the lock to first sensitive note. See ", link("the funnel breakdown", "https://analytics.local/funnels/onboarding"), "."),
    ),
  },
  {
    title: "Design principles I keep coming back to",
    color: "purple",
    folderId: fProduct.id,
    tags: ["design", "quote"],
    pin: "all",
    agoMin: 2 * HOUR,
    content: doc(
      ordered(
        "Make the right thing the easy thing.",
        "Defaults are decisions — spend them carefully.",
        "Show state, don't make people remember it.",
        "Every setting is a small failure to decide.",
      ),
      quote("The details are not the details. They make the design. — Charles Eames"),
    ),
  },
  {
    title: "Ship it.",
    tags: ["quote"],
    agoMin: 40 * MIN,
    content: doc(quote("A good plan violently executed now is better than a perfect plan next week.")),
  },
  {
    title: "Lockpad v0.4 — release checklist",
    color: "blue",
    folderId: fLockpad.id,
    tags: ["todo", "engineering"],
    pin: "all",
    agoMin: 25 * MIN,
    content: doc(
      h(3, "Before tagging"),
      tasks(
        [true, "Bump version + changelog"],
        [true, "Run full e2e on a clean DB"],
        [false, "Verify zero outbound requests in prod build"],
        [false, "pg_dump backup pulled from NAS"],
        [false, "Smoke-test import (Keep, Standard Notes, .md)"],
      ),
      p("Cut the tag only once the outbound-request check is green."),
    ),
  },
  {
    title: "Zero-knowledge architecture notes",
    color: "teal",
    folderId: fEng.id,
    tags: ["architecture", "engineering"],
    pin: "all",
    agoMin: 3 * HOUR,
    content: doc(
      p("The server should never be able to read a locked note. Key derivation stays client-side; only ciphertext + KDF params touch the DB."),
      h(3, "Key derivation"),
      code("typescript", "const key = await argon2id({\n  pass: passphrase,\n  salt,               // random per note\n  memoryCost: 19456,  // 19 MiB\n  timeCost: 2,\n  parallelism: 1,\n});"),
      p("Never persist the key or the plaintext — see ", link("the crypto spec", "https://github.com/lockpad/spec/blob/main/crypto.md"), "."),
    ),
  },
  {
    title: "Idea: a focus timer that actually locks the distracting apps",
    color: "amber",
    folderId: fIdeas.id,
    tags: ["idea"],
    agoMin: 6 * HOUR,
    content: doc(
      p("Pomodoro apps are honor-system. What if the timer held the keys — during a session, opening Twitter requires your passphrase?"),
      bullet("Local-first, no account", "Blocklist per session profile", "\"Break glass\" override with a 60s cool-down"),
      p("Monetization: one-time purchase, no subscription. That's the whole pitch."),
    ),
  },
  {
    title: "Reframing the settings page as progressive disclosure instead of a wall of toggles",
    folderId: fProduct.id,
    tags: ["ux", "design"],
    agoMin: 5 * HOUR,
    content: doc(
      p("Most people touch three settings, ever. Lead with those; tuck the long tail behind \"Advanced\". The wall-of-toggles look signals complexity we don't actually have."),
    ),
  },
  {
    title: "Books to read this quarter",
    color: "green",
    folderId: fPersonal.id,
    tags: ["reading"],
    agoMin: 2 * DAY,
    content: doc(
      tasks(
        [true, "The Design of Everyday Things — Norman"],
        [false, "Thinking in Systems — Meadows"],
        [false, "A Philosophy of Software Design — Ousterhout"],
        [false, "Shape Up — Basecamp"],
      ),
    ),
  },
  {
    title: "1:1 with Maya — growth areas",
    folderId: fPersonal.id,
    tags: ["career", "meeting"],
    agoMin: 4 * DAY,
    content: doc(
      bullet(
        "Wants more surface area on architecture decisions — pair on the sync layer.",
        "Feedback: writing is sharp, presentations bury the lede.",
        "Next step: she'll drive the v0.5 kickoff doc.",
      ),
    ),
  },
  {
    title: "Weekly review template",
    color: "slate",
    tags: ["todo"],
    agoMin: 8 * HOUR,
    content: doc(
      h(3, "This week"),
      tasks([false, "What moved the product forward?"], [false, "What did I avoid?"], [false, "One thing to cut next week"]),
      h(3, "Next week's one big thing"),
      p(),
    ),
  },
  {
    title: "The best interface is no interface",
    color: "indigo",
    tags: ["quote", "design"],
    pin: { tag: "design" },
    agoMin: 30 * HOUR,
    content: doc(
      quote("The best interface is no interface. The best notification is the one you never had to send."),
      p("Counterpoint I keep forgetting: \"no UI\" still needs a mental model. Invisible ≠ intuitive."),
    ),
  },
  {
    title: "Debugging the sticky-toolbar jank",
    color: "orange",
    folderId: fLockpad.id,
    tags: ["engineering"],
    agoMin: 55 * MIN,
    content: doc(
      p("The header shimmied on scroll because we recalculated `getBoundingClientRect` every frame and set React state from it."),
      p("Fix: an IntersectionObserver on a zero-height sentinel toggles a `stuck` class — event-driven, no per-scroll setState."),
      code("tsx", "const io = new IntersectionObserver(\n  ([e]) => setStuck(!e.isIntersecting),\n  { rootMargin: `-${titleH}px 0px 0px 0px` },\n);"),
    ),
  },
  {
    title: "Side-project ideas backlog",
    color: "amber",
    folderId: fIdeas.id,
    tags: ["idea"],
    pin: { folder: fIdeas.id },
    agoMin: 26 * HOUR,
    content: doc(
      bullet(
        "Self-hosted read-later that strips trackers on ingest",
        "A CLI that turns git history into a standup summary",
        "Terracotta — a warm, calm design-token starter kit",
        "Offline-first habit tracker with a physical e-ink companion",
        "\"Boring stack\" template repo: Fastify + Prisma + React, batteries included",
      ),
    ),
  },
  {
    title: "Call the dentist",
    tags: ["todo"],
    agoMin: 90 * MIN,
    content: doc(p("Left molar, twinge on cold. Booking line opens 9am.")),
  },
  {
    title: "Terracotta palette exploration",
    color: "red",
    folderId: fProduct.id,
    tags: ["design"],
    agoMin: 20 * MIN,
    content: doc(
      p("Moving off the borrowed blue/slate tokens toward a warm cream → terracotta → espresso range. Feels calmer, more \"personal notebook\" than \"SaaS dashboard\"."),
      bullet(
        [inl("Canvas "), link("#F2EAE0", "https://www.colorhexa.com/f2eae0")],
        [inl("Primary "), link("#A34B3C", "https://www.colorhexa.com/a34b3c")],
        [inl("Espresso text "), link("#3B2F27", "https://www.colorhexa.com/3b2f27")],
      ),
      p("Destructive needs a cooler crimson so it never reads as the terracotta primary."),
    ),
  },
  {
    title: "Notes on self-hosting & backups",
    color: "teal",
    folderId: fEng.id,
    tags: ["engineering", "architecture"],
    agoMin: 3 * DAY,
    content: doc(
      h(3, "Deploy"),
      p("Ship code with a git archive tarball to the NAS, rebuild the frontend there, keep secrets off git."),
      code("bash", "git archive --format=tar HEAD | ssh nas 'tar -x -C /srv/lockpad'\nssh nas 'cd /srv/lockpad/frontend && npm ci && npm run build'"),
      h(3, "Backups"),
      tasks([true, "Nightly pg_dump"], [false, "Test a restore end-to-end"], [false, "Off-site copy encrypted at rest"]),
    ),
  },
  {
    title: "Meeting: Q3 roadmap sync",
    folderId: fProduct.id,
    tags: ["meeting"],
    agoMin: 6 * DAY,
    content: doc(
      h(3, "Decisions"),
      bullet("v0.5 theme: trust & recovery", "Push mobile polish to v0.6", "No accounts, ever — reaffirmed"),
      h(3, "Action items"),
      tasks([false, "Draft recovery-code UX (me)"], [false, "Spike WebAuthn unlock (Maya)"], [true, "Book the usability round"]),
    ),
  },
  {
    title: "Why I finally left cloud notes apps",
    color: "purple",
    folderId: fPersonal.id,
    tags: ["reading"],
    agoMin: 9 * DAY,
    content: doc(
      p("Ten years of notes living on someone else's server, mined for whatever comes next. The switch wasn't about features — it was about not renting my own memory."),
      p("Self-hosted isn't for everyone. But the calm of knowing the data is just… mine, on a box in the closet, is worth the weekend of setup."),
    ),
  },
  {
    title: "Keyboard shortcuts to add",
    color: "blue",
    folderId: fLockpad.id,
    tags: ["engineering", "todo"],
    agoMin: 70 * MIN,
    content: doc(
      tasks(
        [true, "⌘K — search"],
        [true, "⌘N — new note"],
        [false, "⌘⇧L — lock/unlock current note"],
        [false, "⌘⌫ — move to trash (with undo toast)"],
        [false, "⌘\\ — toggle sidebar"],
      ),
    ),
  },
  {
    title: "Coffee brewing ratios",
    color: "orange",
    folderId: fPersonal.id,
    tags: ["recipe"],
    agoMin: 5 * DAY,
    content: doc(
      p("V60, medium grind, 94°C."),
      ordered("60 g/L — so 18 g coffee to 300 g water", "Bloom 45 g, wait 40s", "Pour to 180 g, then to 300 g by 1:45", "Aim to finish the drawdown by 2:45"),
    ),
  },
  {
    title: "Interview questions for a senior designer",
    folderId: fProduct.id,
    tags: ["career"],
    agoMin: 11 * DAY,
    content: doc(
      ordered(
        "Show me something you shipped that you'd now design differently.",
        "Walk me through a time data contradicted your instinct.",
        "How do you decide what NOT to build?",
        "Critique our onboarding — live.",
      ),
    ),
  },
  {
    title: "Performance budget for the app shell",
    color: "green",
    folderId: fEng.id,
    tags: ["engineering", "architecture"],
    agoMin: 4 * DAY,
    content: doc(
      bullet("JS ≤ 180 KB gzipped on first load", "First note interactive < 1.5s on a mid Android", "No layout shift on card hover (reserve the action-bar height)"),
      p("Virtualize the list; lazy-load the editor only when a note opens."),
    ),
  },
  {
    title: "Quote wall",
    color: "indigo",
    tags: ["quote"],
    agoMin: 13 * DAY,
    content: doc(
      quote("Simplicity is the ultimate sophistication. — da Vinci"),
      quote("Programs must be written for people to read. — Abelson & Sussman"),
      quote("You can't fix what you refuse to see."),
    ),
  },
  {
    title: "Field notes: usability test, round 2",
    color: "pink",
    folderId: fProduct.id,
    tags: ["ux"],
    agoMin: 7 * DAY,
    content: doc(
      p("Five participants, remote, thinking aloud. Task set: capture a note, lock it, find it again a day later."),
      h(3, "What worked"),
      bullet("Everyone found search instantly (⌘K discoverable via the placeholder).", "The lock icon read as \"private\" without explanation."),
      h(3, "What hurt"),
      bullet("P2 & P4 didn't realize a locked note needed the passphrase to reopen.", "\"Move to trash\" felt scary — the undo toast fixed it once they saw it."),
      quote("\"Oh — it's just… mine? There's no account?\" — P3, delighted and suspicious"),
      h(3, "Follow-ups"),
      tasks([false, "Add a one-line hint on the lock dialog"], [false, "Make the undo toast linger to 8s"]),
    ),
  },
  {
    title: "Trip planning — Lisbon",
    color: "amber",
    folderId: fPersonal.id,
    tags: ["travel"],
    agoMin: 16 * DAY,
    content: doc(
      tasks([true, "Flights"], [true, "Airbnb in Alfama"], [false, "Day trip to Sintra"], [false, "Book Time Out Market dinner"]),
      p("Reading list before: ", link("a walking guide to Alfama", "https://example.com/alfama-walk"), "."),
    ),
  },
  {
    title: "Gratitude, unfiltered",
    color: "green",
    folderId: fPersonal.id,
    agoMin: 18 * DAY,
    content: doc(bullet("Quiet mornings before the house wakes", "Work that feels like play most days", "Old friends who pick up mid-sentence")),
  },
  {
    title: "Old landing-page copy (v0.2)",
    folderId: fIdeas.id,
    tags: ["idea"],
    archived: true,
    agoMin: 21 * DAY,
    content: doc(
      p("\"Your notes. Your server. Nobody else's business.\" — punchy but we tested it as slightly hostile. Archiving; keep for reference."),
    ),
  },
  {
    title: "Deprecated auth flow (pre zero-knowledge)",
    color: "slate",
    folderId: fEng.id,
    tags: ["engineering"],
    archived: true,
    agoMin: 28 * DAY,
    content: doc(
      p("The old server-side session model. Superseded by client-side key derivation — kept only so we remember why we moved."),
      code("text", "POST /login { password } → sets httpOnly cookie   // don't do this anymore"),
    ),
  },
  {
    title: "Scratch: random regex I'll need again",
    folderId: fEng.id,
    tags: ["engineering"],
    deleted: true,
    agoMin: 24 * DAY,
    content: doc(code("regex", "/(?<=\\/notes\\/)([a-z0-9]{25})/  // pull a cuid from a path")),
  },
];

// ── Insert ───────────────────────────────────────────────────────────────────
const created: { id: string; agoMin: number }[] = [];
for (const n of notes) {
  const tagIds = await Promise.all((n.tags ?? []).map(tag));
  const note = await prisma.note.create({
    data: {
      title: n.title,
      content: n.content,
      color: n.color ?? null,
      folderId: n.folderId ?? null,
      archivedAt: n.archived ? new Date() : null,
      deletedAt: n.deleted ? new Date() : null,
      ...(tagIds.length ? { tags: { create: tagIds.map((tagId) => ({ tagId })) } } : {}),
    },
  });
  created.push({ id: note.id, agoMin: n.agoMin });

  if (n.pin && !n.archived && !n.deleted) {
    const scope = n.pin === "all" ? "all" : "folder" in n.pin ? `folder:${n.pin.folder}` : `tag:${n.pin.tag}`;
    // tag-scope pins use the tag id, not its name
    const realScope = scope.startsWith("tag:") ? `tag:${tagCache.get(scope.slice(4))}` : scope;
    await prisma.pinnedNote.create({ data: { noteId: note.id, scope: realScope } });
  }
}

// Spread updated/created timestamps so the list ordering + relative times look
// real (the @updatedAt column is auto-managed, so we backdate it with raw SQL).
//
// The value is written as an ISO-8601 UTC STRING cast to `timestamp`, not as a JS Date.
// The columns are TIMESTAMP(3) *without* time zone and Prisma reads them back as UTC,
// but the driver serializes a bound Date using the host's LOCAL offset, which the
// column then discards. On a UTC+2 machine every seeded note therefore landed two
// hours late, and anything more recent than 2h ago was stamped in the FUTURE — those
// notes outranked every genuinely new note in the `updatedAt desc` list, which is why
// a freshly created note did not show up first. Formatting to UTC ourselves takes the
// host's time zone out of the equation entirely.
for (const c of created) {
  const when = new Date(Date.now() - c.agoMin * 60 * 1000).toISOString();
  await prisma.$executeRaw`UPDATE "Note" SET "updatedAt" = ${when}::timestamp, "createdAt" = ${when}::timestamp WHERE "id" = ${c.id}`;
}

// ── First-run onboarding state ───────────────────────────────────────────────
// Two dev worlds, because onboarding is the one feature whose entire behaviour is
// "what does an instance look like before anyone has used it".
//
//   npm run dev:preview              the demo library, already onboarded
//   SEED=none npm run dev:preview    nothing at all, never onboarded
//
// The default is marked ONBOARDED on purpose. A populated library is what a real
// upgrading instance looks like, and the migration stamps those as already welcomed
// — so leaving the dev flag unset would both misrepresent that case and shove the
// wizard in front of every unrelated QA session. Testing the welcome flow is a thing
// you should have to ask for.
//
// SEED=none empties the tables the seed just filled rather than skipping the seed
// itself. That reads as waste and is deliberate: the seed is 500 lines of top-level
// statements whose later halves depend on the consts the earlier halves bind, so
// guarding it in place would mean restructuring the one file every other feature's
// QA depends on. Clearing afterwards costs about a second, touches nothing but this
// throwaway database, and leaves the default path — the one that matters daily —
// byte-for-byte as it was.
const EMPTY_LIBRARY = process.env.SEED === "none";
if (EMPTY_LIBRARY) {
  await prisma.$executeRawUnsafe(
    'TRUNCATE "NoteTag","NoteLink","PinnedNote","NoteImage","Note","Folder","Tag" RESTART IDENTITY CASCADE',
  );
} else {
  // BOTH stamps, matching exactly what the migration writes for a real instance
  // that already had notes when this feature arrived. Marking it onboarded but not
  // seeded would leave a state no production install can be in — and one where a
  // stray call to the seed endpoint would drop three starter notes into the middle
  // of the demo library.
  const now = new Date();
  await prisma.appState.upsert({
    where: { id: 1 },
    create: { id: 1, onboardedAt: now, seededAt: now },
    update: { onboardedAt: now, seededAt: now },
  });
}

await app.listen({ port: 4000, host: "0.0.0.0" });
console.error(
  EMPTY_LIBRARY
    ? "DEV BACKEND READY on :4000 — EMPTY library, not onboarded (first-run path)"
    : `DEV BACKEND READY on :4000 — seeded ${created.length} demo notes, already onboarded`,
);

for (const sig of ["SIGINT", "SIGTERM"] as const) {
  process.on(sig, async () => {
    await app.close();
    await prisma.$disconnect();
    await db.stop();
    process.exit(0);
  });
}
