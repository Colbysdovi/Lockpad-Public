// The two name folds, and the fact that they are two.
//
// normalizeName answers "are these the same name?" and guards renaming. foldForSearch
// answers "should typing this show me that?" and guards search. They fold differently
// on purpose, and the test that matters most here is the one asserting they still
// disagree about accents — if that ever starts passing the other way, renaming quietly
// became stricter and nobody asked for it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeName, collidesWith, foldForSearch } from "../src/lib/names.js";

test("foldForSearch strips accents so a French name is findable without them", () => {
  assert.equal(foldForSearch("Café"), "cafe");
  assert.equal(foldForSearch("cafe"), "cafe");
  assert.equal(foldForSearch("CAFÉ "), "cafe");
  // Every accented letter French actually uses, plus the cedilla — which is worth
  // asserting separately because "ç" only decomposes into "c" + a combining mark
  // under NFD, and would survive a fold that only lowercased.
  assert.equal(foldForSearch("Élève déjà où français Noël"), "eleve deja ou francais noel");
});

test("foldForSearch keeps normalizeName's case and whitespace folding", () => {
  assert.equal(foldForSearch("  Q1   Drafts  "), "q1 drafts");
  // Internal whitespace is COLLAPSED, not removed: "ca fé" is not "cafe". A fold that
  // deleted spaces would make "Note Book" match a search for "notebook", which is a
  // different and much noisier promise than the one being made here.
  assert.equal(foldForSearch("ca fé"), "ca fe");
  assert.notEqual(foldForSearch("ca fé"), foldForSearch("café"));
});

test("normalizeName is unchanged: accents still make two different names", () => {
  assert.notEqual(normalizeName("Café"), normalizeName("Cafe"));
  assert.equal(collidesWith("Cafe", ["Café"]), false);
  // And it still folds what it always folded.
  assert.equal(normalizeName("  Engineering "), "engineering");
  assert.equal(collidesWith("engineering", ["Engineering"]), true);
});
