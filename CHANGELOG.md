# 📜 Changelog

What changed in each release of Lockpad, written for the person running it.

Entries describe what you can now do, not what was committed. If a change makes no
difference to anyone using the app, it is not in here.

---

## 🔖 v1.1.2 — "Abomey" · 2026-09-12

Everyday work with a batch of notes gets less repetitive, and the folder colour picker
gets more room in it. Nothing here changes how Lockpad stores or protects anything.

A patch release, so it keeps the Abomey name: small improvements to how the app feels
day to day, and one fix that matters to anyone running nightly backups.

### 🆕 Added

- **Shift+click selects every note in between.** Tick a note, hold Shift and click
  another, and everything between the two is selected, in the order the list shows them —
  across the line between pinned notes and the rest, too. Shift+click again and the far
  end of the range moves, in either direction; notes you ticked by hand stay ticked the
  whole time. With nothing selected yet, Shift+click simply selects the note you clicked.
- **Escape deselects every note.** Anything open on top of the list goes first, one thing
  per press: a folder picker, a dialog, an open note. So pressing Escape to leave a note
  never throws away the selection waiting behind it.
- **Fifteen more folder colours,** behind "More colors" in the folder colour picker: a
  deeper shade of each of the ten pastels, plus raspberry, fuchsia, orchid, cyan and lime.
  Editing a folder whose colour lives in that second row opens straight onto it, so its
  colour never looks as if it has been cleared.

### 📈 Improved

- **A selection survives a move or a tag.** Filing notes into a folder no longer unticks
  them, so a batch can be moved and then tagged without selecting it all again. Deselect
  is the one control that ends a selection now. Archiving or deleting still clears it,
  because those notes leave the list.
- **The selection bar says what it counts, and what its last button does.** It reads
  "2 notes selected" instead of "2 selected", and "Clear" is now "Deselect". In French it
  is "Désélectionner" rather than "Effacer", which read as erasing the notes themselves.
- **The selection bar stays on one line in French.** It is a little wider, so the longer
  French labels no longer push the buttons onto a second row — and when a narrow window
  does make it wrap, the buttons no longer sit beside an empty gap on their left.
- **The folder colour picker shows its two choices.** The ready-made colours and a custom
  hex value are now two labelled groups instead of one block with a sentence explaining
  them, and the tick marks only the one in use. Each colour tells a screen reader whether
  it is selected, and the hex field has a real label instead of a placeholder.
- **A copy built from source says which release it came from.** Settings → About shows
  the version it was built from, such as `v1.1.2+src`, instead of "Development build".

### 🩹 Fixed

- **A failed backup no longer leaves an empty archive behind.** When `scripts/backup.sh`
  could not reach the database it still wrote a tiny file that looked like a backup, and
  that file took one of the fourteen kept slots — so enough failures in a row would push
  every real backup out. It now keeps an archive only when there is data in it, and leaves
  nothing when there is not.

---

## 🔖 v1.1.1 — "Abomey" · 2026-09-06

Identical to v1.1.0 for anyone using Lockpad. It corrected the project's own README
and build setup, which should not have needed a version number, and documentation
changes like that are now published without one.

---

## 🔖 v1.1.0 — "Abomey" · 2026-09-06

Two things you could not do before. A note can hold a **table** — a few options against a
few columns — with everything needed to shape one a click away from the cell you are
already in. And **search knows about your folders and tags**, so a note you remember only
as "the one in Budget" is findable by that, and you can narrow a search to one folder
without leaving the search box.

A new minor line, so a new name: Abomey, the royal capital of Dahomey, whose palace walls
recorded the kingdom in bas-relief. A release about writing things down in a shape you can
find again later.

### 🆕 Added

- **Tables, one slash away.** Type `/`, pick Table, and a three-by-three grid with a
  header row lands as its own block with the cursor already in the first cell. There is
  no size picker on purpose — deciding on dimensions before you have any data is exactly
  the stop-and-think that menu exists to avoid. Add rows and columns as the thing takes
  shape. It is deliberately not a spreadsheet: no formulas, no sorting, no merged cells.
- **Rows and columns can be added, moved and removed.** Insert above, below, left or
  right; move a row up or down and a column left or right; delete a row, a column, or the
  whole table. An action with nowhere to go — moving the top row up — is greyed out rather
  than quietly doing nothing when you press it.
- **Deleting the last row deletes the table.** Ask for the only remaining row to go and
  the table goes with it, instead of the app going silent and leaving you in a one-row
  table with no way out. `⌘Z` brings it all back.
- **The table actions come to you.** On a desktop a small handle appears in whichever cell
  holds the cursor and opens the same menu, so reshaping a table does not mean looking
  away to the toolbar for something you are doing right here. On a phone the toolbar's
  table button scrolls itself into view the moment you tap into a table, rather than
  waiting off the edge of a row you had no reason to scroll.
- **A wide table scrolls inside itself,** and its header row stays put while the rows
  slide underneath, so a long table never leaves you guessing which column you are
  reading. The note itself never scrolls sideways — nothing else in the app does.
- **Columns can be resized by dragging their edge,** wherever there is a mouse to do it
  with. The edge thickens and turns terracotta under the pointer, and the cursor changes,
  so the line tells you it can be dragged before you try. A table only grows wider than
  the note when its columns genuinely cannot fit; when they can, it goes back to filling
  the width by itself.
- **Tables read correctly to a screen reader,** because header cells are marked as the
  headers of their columns rather than merely looking like them — so a value is announced
  with the column it belongs to. Every action in the menu is reachable from the keyboard
  through the toolbar.
- **A table stays a table on the note card,** shown as a miniature grid rather than as a
  run-together line of words, and the words inside its cells are findable by search like
  any other text in the note.
- **Search knows about your folders and tags.** Typing a folder's name finds the notes
  filed in it, and typing a tag's name finds the notes carrying it — even when that word
  appears nowhere in the notes themselves. So a note you remember only as "the one in
  Budget" is now findable by that, and a result that turned up for that reason says so on
  its own row, rather than looking like a mistake. Accents are ignored on both sides:
  typing "cafe" finds a folder called "Café", which matters now the app speaks French.
- **Search can be narrowed to one folder or one tag.** A selector in the search bar reads
  "All notes" until you point it somewhere; results then come only from there, and the
  words you have already typed keep applying inside it. Choosing "All notes" again puts
  you back, without losing what you typed. Each folder and tag in that list shows how many
  notes it would give you for what you have typed, lined up in a column so you can read
  down them at a glance — so picking where to look is a decision rather than a guess, and a
  folder with nothing in it simply shows no number.

### 🩹 Fixed

- **The welcome no longer flashes the app at you before the guide arrives.** On a brand
  new library the opening animation used to fade out onto a working interface for about
  half a second before the welcome guide landed on top of it — long enough to start
  reaching for something, and then have a dialog take the screen. The three beats are now
  separate: the opening animation, then the guide by itself on the app's own paper, and
  only once you have finished or skipped it does Lockpad itself fade up — on your full
  note list, whichever page the browser happened to be pointed at. Replaying the guide
  later from Settings is untouched: it still opens over your library, and leaves you on
  the page you called it from.
- **A note reference opens where you are already reading.** Clicking a linked note from
  inside the text of a note used to throw it open in a new browser tab, while the panel
  you were reading moved on to it as well: the same note in two places, and a stray tab
  to close afterwards. It now does what the links in the note's header have always done.
  The note you clicked slides into the panel you are in, and the note you came from is
  waiting for you under Backlinks to slide you back.
- **A pasted link opens one tab, not two.** The cards that stand in for a Figma file, a
  GitHub repository or a YouTube video were being opened twice by one click, landing you
  with a duplicate tab every time.

### 🚧 Known limits

- **No merged or split cells.** Every row has the same number of cells. A table pasted
  from elsewhere that contains merged cells will render, but the actions in the menu are
  not written for it.
- **Resizing a column needs a mouse.** The drag is a mouse gesture and there is no touch
  equivalent, so on a phone a table is read by scrolling it rather than by reshaping it.
  Nothing is hidden that a finger could otherwise have used.
- **The header row stays first.** It cannot be moved down and no row can be moved above
  it, because a heading in the middle of the data describes nothing.
- **A word in a note's title ranks no higher than the same word buried in its body.**
  Search treats a note as one piece of text, so the note actually *called* "Budget" can
  sit below one that merely mentions budgets in passing. Folder and tag matches are
  nudged up the list; titles are not, yet.
- **Folder and tag names need two characters before they are matched.** A single letter
  would pull in most of your folders and drown the notes you were actually searching for.

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
- **Notes can point at each other.** Link one note to another and it shows up as a chip
  right in your sentence — its own icon and colour, the linked note's title, clickable —
  not a stray character with the connection hidden elsewhere. The note you linked to
  shows the connection back, so you can find your way in either direction.
- **Paste a link to a site Lockpad recognises** — YouTube, Figma, LinkedIn, Google Maps
  and others — **and it renders as a small styled card** with that provider's icon and
  label, instead of a bare URL. It's computed entirely from the link text itself; nothing
  is fetched from the site, so this costs nothing against the zero-outbound-request
  promise.
- **Reorder a note by dragging its pieces.** Paragraphs, headings, list items, checklist
  items, quotes and code blocks all pick up a drag handle on hover (a long-press on
  mobile), so rearranging a note no longer means cutting and pasting text by hand. It
  undoes like any other edit.
- **Strikethrough, inline code, and a horizontal rule now have a toolbar button or
  slash-command entry** — no more typing the exact markdown shortcut from memory to
  reach them.
- **A quick-note bar that lets you keep going.** Type at the bottom of any list and
  press Enter: the note is created and you stay where you are, ready for the next
  thought. `⌘Enter` creates it and opens it. `Shift+Enter` adds a line without saving.
- **Keyboard shortcuts** for search (`⌘K`), a new note (`⌘N`) and the sidebar (`⌘\`),
  with a dialog in the header that lists them rather than expecting you to memorise them.

### 📂 Organising

- **Folders, each with its own colour.** A note lives in one folder.
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
- **A note's folder now has its own icon** in the note list, so the folder chip reads as
  structurally different from a tag chip at a glance, not just by position.

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
- **Import from elsewhere.** CSV, Markdown, plain text, HTML, a Lockpad JSON export, and
  Google Keep's JSON — with a preview of what will be created before anything is written.
  Keep exports are the best-tested path; the other formats work but have had less mileage,
  so bring a small batch through first.
- **Undo survives leaving a note.** Type in one note, switch to another, come back — your
  undo (and redo) history for the first note is still exactly where you left it, for as
  long as the tab stays open.

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

### 🎨 Look and feel

- **A warmer colour palette.** Cream and terracotta in light mode, espresso surfaces in
  dark mode, including the status colours — warnings and success states feel like part of
  the same palette rather than bolted on.
- **The note panel's header sits visually apart from the page below it** — a frosted,
  translucent band that fades into the solid writing surface, with the title pinned in
  place as long notes scroll underneath it.
- **Settings is easier to scan.** The two irreversible cleanup actions live in their own
  clearly separated section at the bottom of the page, informational cards read
  differently from clickable ones, and every section explains itself in one line before
  the individual cards.

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
