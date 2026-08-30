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
