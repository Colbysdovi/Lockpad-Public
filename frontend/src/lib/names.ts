// When are two tag names, or two folder names, "the same name"?
//
// Not "when the strings match". A name that differs only in capitalisation or in
// spacing is a name you cannot tell apart in a list — "Engineering" beside
// "engineering ", or "Q1 drafts" beside "Q1  drafts" — and letting those coexist
// produces exactly the confusion the rename validation exists to prevent. So the
// comparison folds all three: surrounding whitespace, runs of internal whitespace,
// and letter case.
//
// ── This function is deliberately duplicated on the server ─────────────────
//
// Its twin lives at `backend/src/lib/names.ts` and MUST fold the same way. This copy
// warns you as you type; that one refuses the save. If they disagree, the failure is
// the worst kind: the form says a name is free, the request is rejected anyway, and
// you are told the opposite of what you were just shown. There is no shared package
// between the two halves of this app, so the honest fix is two copies that name each
// other rather than one clever import across a boundary that does not exist.
// Change one, change the other.
export function normalizeName(name: string): string {
  return name.trim().replace(/\s+/g, " ").toLowerCase();
}

/** The name already taken by something else, or null if this one is free.
 *
 *  Returns the EXISTING name rather than a boolean so the message can quote what is
 *  already there as its owner spelled it — being told "already used by Engineering"
 *  when you typed "engineering" is what explains why a name that looks free is not.
 *
 *  `existing` must already have the thing being renamed removed from it: renaming
 *  something to the name it already has is not a collision, and leaving that filter
 *  to the caller keeps this function from needing to know which entity it is
 *  looking at. */
export function findNameCollision(name: string, existing: string[]): string | null {
  const target = normalizeName(name);
  if (!target) return null;
  return existing.find((other) => normalizeName(other) === target) ?? null;
}
