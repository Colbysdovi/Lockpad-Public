# 📜 Changelog

What changed in each release of Lockpad, written for the person running it.

Entries describe what you can now do, not what was committed. If a change makes no
difference to anyone using the app, it is not in here.

---

## 🔖 v1.0.0 — "Ganvié" · 2026-08-30

The first release. Lockpad is a notes app that runs entirely on hardware you own: no
account, no vendor server, no telemetry, and no outbound network requests in normal
operation.

Since this is the first version there is nothing to compare it to, so what follows is
what the app does.

### 📝 Writing

- **A real rich-text editor.** Headings, bold, italic, strikethrough, highlight, bullet
  and numbered lists, checklists, quotes and code blocks.
- **Checklists keep finished work in its place.** Tick something and it folds away into
  a summary directly beneath its own checklist, rather than dropping to a pile at the
  foot of the note, away from the list it belongs to. Open the fold to see what you have
  done; untick anything and it goes back to its own position, not the end. The boxes are
  sized for a fingertip on a phone.
- **Pictures in your notes.** Paste or insert an image and it lives in the note. Large
  photographs are downscaled in your browser before they are ever sent, so a phone
  snapshot does not become a 12MB note.
- **Notes can point at each other.** Link one note to another and follow it; the note you
  linked to shows the connection back, so you can find your way in either direction.
- **A quick-note bar that lets you keep going.** Type at the bottom of any list and
  press Enter: the note is created and you stay where you are, ready for the next
  thought. `⌘Enter` creates it and opens it. `Shift+Enter` adds a line without saving.
- **Keyboard shortcuts**, with a dialog that lists them (`⌘⇧S`) rather than expecting you
  to memorise them.

### 📂 Organising

- **Folders that nest.** A folder can live inside another folder, and each one can carry
  its own colour.
- **Tags**, independent of folders, so a note can be filed in one place and still turn up
  under every subject it touches.
- **Search across everything**, powered by Postgres full-text search rather than a naive
  substring match, so it finds words in the middle of long notes.
- **Pinning is per page.** A note can be pinned in All Notes, inside a folder, and under a
  tag independently — pinning something to the top of one list does not clutter the
  others.
- **Select several notes at once** and archive, delete, move or tag them in one action.
- **Duplicate a note** when you want to reuse its shape. The copy appears directly
  beside the original rather than jumping to the top of the list, and it keeps the pins
  the original had, so it is where you would look for it.
- **Rename tags and folders**, with a warning if the name is already taken. Names that
  differ only in capitalisation or spacing count as taken — two tags you cannot tell
  apart in a list are not two tags.
- **Tidy up.** Settings can delete folders and tags nothing is using any more, so the
  sidebar does not silently accumulate.

### 🔍 Not losing things

- **Archive and trash are separate.** Archiving files something away; deleting puts it in
  the trash, where it stays until you empty it.
- **Undo, for a real length of time.** Deleting or archiving leaves a notification with an
  Undo button that lasts three minutes, and the countdown pauses while your pointer is
  over it. It is not a toast that vanishes before you have read it.
- **Full-library export.** One versioned JSON file containing every note — active,
  archived and trashed — plus folders, tags, links and every image embedded in the file
  itself. It is a backup that still restores on a different machine, not a set of links
  back to the server it was taken from.
- **Per-note export** as Markdown or PDF.
- **Import from elsewhere.** Google Keep, Evernote and Obsidian, with a preview of what
  will be created before anything is written.

### 🌐 Language

- **The interface speaks English and French** — menus, settings, dialogs, notifications,
  the first-run walkthrough and the sign-in screen.
- **Guessed once, then never argued about.** On a fresh install your browser's preferred
  language is read and adopted. After that your own choice wins: pick English on a French
  machine and it stays English on every visit, whatever the browser keeps saying.
- **Changed in Settings, and stored with the account** rather than with the browser, so it
  follows you to any device you sign in from. Both languages are always on screen at once,
  each written in its own language — a dropdown would hide the way out from the one person
  most likely to need it, someone looking at an interface they cannot read.
- **Notes are searched in the language they are written in.** Each note records its own
  language, and full-text search stems accordingly, so searching a French note matches the
  other forms of a French word. Notes too short to tell from are treated as English, where
  stemming has almost nothing to do anyway.
- **Switching takes a moment on purpose.** The app blurs for a little over a second and
  comes back already translated, instead of flickering through the change word by word.

### 🔒 Privacy, concretely

- **Nothing leaves your hardware.** No analytics, no telemetry, no error reporting, no
  CDN-hosted fonts or scripts, no external APIs.
- **Per-note encryption, with the key never reaching the server.** Lock a note and its
  contents are encrypted in your browser with AES-GCM-256, using a key derived from your
  passphrase by PBKDF2-SHA-256 at 600,000 iterations. The server stores the ciphertext and
  the parameters; it never sees the passphrase or the plaintext. A locked note is also
  excluded from the export file, and the file says which notes it skipped.
- **The database is not reachable from outside.** Postgres has no published port; only the
  backend can talk to it.
- **Remote access without exposing anything to the internet.** Tailscale `serve` makes the
  app reachable from your own devices over your tailnet. It is never `funnel`, which is
  the mode that would publish it publicly.
- **One password for the app**, because it is built for one person. There is no account
  system to leak.
- **Sign other devices out** from Settings, without changing your password.

### 🐳 Running it

- **One command to install it**, or build it from source if you would rather read the
  code on the way past. The installer asks whether you want to reach Lockpad from your
  phone and sets up Tailscale for you if you say yes — and if that part fails, it says so
  and leaves the app you just installed running.
- **Your install stays on the version you installed.** It is pinned to a release, so the
  app does not change underneath you on a day you did not choose. Updating is deliberate:
  edit one line in `.env` and pull.
- **Updates apply their own database migrations.** Pull the new images and restart; there
  is no manual migration step to remember or get wrong.
- **Backup and restore scripts** that round-trip your Postgres data.
- **HTTPS on your own network** without a Tailscale client, using your own certificate.
  This matters beyond the padlock: browsers only expose the cryptography that per-note
  locking needs over a secure connection, so plain `http://` would quietly disable the
  feature.
- **It installs like an app on a phone**, via a web manifest, so it can sit on your home
  screen and open without browser furniture.
- **A first run that explains itself** — a short welcome, and a handful of starter notes
  you can delete once you have the idea.
- **Settings tells you which version you are running**, and links to the release notes so
  you can see what a newer one contains before deciding to update.

### 🚧 Known limits

- Single user by design. There is no multi-user mode, and adding one would be a change in
  what the product is rather than a setting.
- Per-note locking needs HTTPS. Over plain `http://<ip>` the browser withholds the
  cryptography API, so the feature is unavailable — which is why the install offers
  Tailscale or a LAN certificate rather than plain HTTP.
- Not yet tested on ARM hardware. It may well work; nobody has confirmed it, and this
  document is not the place to guess.

---

<!-- ─────────────────────────────────────────────────────────────────────────────
     Template for the next release. Copy the block below, keep the section names
     that apply and delete the ones that do not.

     Two rules that matter more than the shape:

     1. Write what a user can now do, not what changed in the code. "Search finds
        words inside long notes" — not "switched search to a tsvector column".
     2. Write it before pushing the tag. The GitHub Release body is copied from
        here, and that page is where Settings → About sends every user, so an
        empty one makes the update button pointless. See docs/RELEASING.md.

     The name comes from the pool of Benin towns in docs/release-names.md — pick
     one, then move it to that file's Used table. A patch release keeps its line's
     name, so v1.0.1 is still "Ganvié".
     ─────────────────────────────────────────────────────────────────────────────

## 🔖 vX.Y.Z — "Name" · YYYY-MM-DD

One or two sentences on what this release is for.

### 🆕 Added
- ...

### 📈 Improved
- ...

### 🩹 Fixed
- ...

### 🚧 Known limits
- ...
-->
