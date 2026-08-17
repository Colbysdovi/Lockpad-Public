import { useCallback } from "react";
import { useSearchParams } from "react-router-dom";
import { setNoteSwapDirection } from "@/lib/motion";

// Transient origin rect for the open animation (Keep-style expand-from-card). It
// is deliberately NOT part of the URL/route state — it only feeds the one-shot
// grow-from-card motion, set synchronously right before the note opens and read
// once when the modal mounts. A module-level slot is the simplest shared channel
// between the card that was clicked and the sheet that renders.
export type OpenOrigin = { x: number; y: number; w: number; h: number };
let openOrigin: OpenOrigin | null = null;
export function getOpenOrigin(): OpenOrigin | null {
  return openOrigin;
}

// Intent flag (same one-shot channel style as openOrigin): true only when the note
// was just opened from the quick-composer, so the editor drops the caret at the END
// of the text the user already typed rather than leaving focus on the title. It is
// (re)set on every openNote call — passed via its options — so a plain card open
// clears it; reads are pure (no clearing on read) so they stay StrictMode-safe.
let focusBodyOnOpen = false;
export function getFocusBodyOnOpen(): boolean {
  return focusBodyOnOpen;
}

// Notes open in a sheet layered over the current list route via a `?note=<id>`
// search param, so the underlying list stays mounted. `openNote` optionally takes
// the clicked element's rect so the desktop modal can expand from it.
export function useNoteSheet() {
  const [params, setParams] = useSearchParams();
  const noteId = params.get("note");

  const openNote = useCallback(
    (id: string, origin?: OpenOrigin, opts?: { focusBody?: boolean; back?: boolean }) => {
      openOrigin = origin ?? null;
      focusBodyOnOpen = !!opts?.focusBody;
      // Which way the panel animates if a note is ALREADY open. `back: true` is for
      // the links that RETURN you somewhere — a backlink chip is the only one today —
      // and reverses the swap so the note you came from slides back in from the side
      // it left by. Everything else is a step further in. See setNoteSwapDirection.
      setNoteSwapDirection(opts?.back ? -1 : 1);
      setParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          next.set("note", id);
          return next;
        },
        { replace: false }
      );
    },
    [setParams]
  );

  const closeNote = useCallback(() => {
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.delete("note");
        return next;
      },
      { replace: false }
    );
  }, [setParams]);

  return { noteId, openNote, closeNote };
}
