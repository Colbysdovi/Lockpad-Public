// When are two tag names, or two folder names, "the same name"?
//
// Not "when the strings match". A name that differs only in capitalisation or in
// spacing is a name the user cannot tell apart in a list — "Engineering" beside
// "engineering ", or "Q1 drafts" beside "Q1  drafts" — and letting those coexist
// produces exactly the confusion the rename validation exists to prevent. So the
// comparison folds all three: surrounding whitespace, runs of internal whitespace,
// and letter case.
//
// ── This function is deliberately duplicated in the frontend ────────────────
//
// Its twin lives at `frontend/src/lib/names.ts` and MUST fold the same way. The
// client uses it to warn as you type; the server uses it to refuse the save. If they
// disagree, the failure is the worst kind: the form says a name is free, the request
// is rejected anyway, and the user is told the opposite of what they were just shown.
// There is no shared package between the two halves of this app, so the honest fix is
// two copies that name each other rather than one clever import across a boundary
// that does not exist. Change one, change the other.
//
// Postgres cannot express this comparison for us. `mode: "insensitive"` handles case
// but nothing handles the whitespace folding, which is why the uniqueness checks read
// the candidate set and compare in JS rather than pushing the predicate into a query.
// Both sets are small — a single user's tags and folders — so this is a few dozen
// short strings, not a scan.
export function normalizeName(name: string): string {
  return name.trim().replace(/\s+/g, " ").toLowerCase();
}

/** True when `name` collides with any of `existing` under the folding above.
 *
 *  `existing` is the set to compare against with the item being renamed ALREADY
 *  REMOVED — renaming something to the name it already has is not a collision, and
 *  making the caller do that filtering keeps this function from needing to know
 *  which entity it is looking at. */
export function collidesWith(name: string, existing: string[]): boolean {
  const target = normalizeName(name);
  return existing.some((other) => normalizeName(other) === target);
}

// ── A second, harder fold — for SEARCH, not for renaming ──────────────────────
//
// Search has to find a folder called "Café" when you type "cafe". The interface is
// available in French, so accented folder and tag names are ordinary here, not an
// edge case — and nobody types the accents when they are hunting for something.
//
// This is deliberately NOT a change to normalizeName above, and the distinction is
// the whole point of having two functions:
//
//   • normalizeName decides whether two names are THE SAME NAME. Widening it to fold
//     accents would make "Café" and "Cafe" collide, so the second one could no longer
//     be created — a real restriction on what you are allowed to call things, which
//     in French is not obviously right, since the accent is part of the word.
//   • foldForSearch decides whether a name is worth SHOWING YOU. Folding accents there
//     costs nothing: the worst case is one extra result you can see is not the one you
//     meant.
//
// And normalizeName cannot be widened quietly in any case — its twin in the frontend
// must fold identically (see the note above), so any change here is a change to what
// the rename form warns about, on both sides of the wire. Search does not need that,
// so search does not ask for it.
//
// The fold itself: whatever normalizeName already does, then NFD to split an accented
// letter into its base letter plus a combining mark, then drop the marks. "é" is one
// character until NFD makes it two, at which point the accent is a separate thing that
// can be removed without touching the "e". No dependency, no Postgres `unaccent`
// extension — which this app does not install and, for a few dozen short strings
// compared in application code, does not need.
export function foldForSearch(name: string): string {
  return normalizeName(name).normalize("NFD").replace(/\p{M}/gu, "");
}
