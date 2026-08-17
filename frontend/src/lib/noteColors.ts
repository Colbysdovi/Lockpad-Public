// The fixed set of note-color keys, and nothing else.
//
// Order and spelling mirror the backend's `NOTE_COLOR_KEYS` (backend/src/schemas.ts),
// which is what the API validates a note's `color` against. This file exists so the
// frontend types can describe that field.
//
// It used to be bigger. It carried a display label per key and three helpers that
// turned a key into CSS custom properties (`--note-<key>-bg` / `-border`) for a
// swatch picker and a tinted card. None of that was reachable: Lockpad's card accent
// is DERIVED FROM THE NOTE'S FOLDER (lib/folderColor.ts) — colour means "which
// folder", not a freeform per-note choice — and that change replaced the per-note
// palette rather than supplementing it (see the folder-derived-note-color idea brief
// in docs/forge). The helpers, the labels and the CSS variables they read went with
// it.
//
// The `color` field itself is still carried end to end by the API and the database
// while nothing writes it. If that field is ever retired, this file goes with it.
export const NOTE_COLOR_KEYS = [
  "red",
  "orange",
  "amber",
  "green",
  "teal",
  "blue",
  "indigo",
  "purple",
  "pink",
  "slate",
] as const;

export type NoteColor = (typeof NOTE_COLOR_KEYS)[number];
