import { useCallback, useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { api } from "./api";
import { patchNoteInLists } from "./notesCache";
import { makePreview } from "./tiptap";
import type { Note, NoteCard } from "./types";

export type SaveState = "idle" | "unsaved" | "saving" | "saved" | "error";

// Debounced auto-save for a note (spec §3.4). Coalesces rapid edits (~700ms),
// flushes immediately on blur/unmount, and supersedes in-flight saves so a newer
// edit always wins (no out-of-order writes) via a monotonically increasing seq.
//
// It also keeps the note-list cache in sync so the card behind the editor updates
// live: an optimistic in-place patch on every keystroke, then an authoritative
// reconcile from the server's save response (which carries the real preview).
export function useAutoSave(noteId: string | undefined, debounceMs = 700) {
  const qc = useQueryClient();
  const [state, setState] = useState<SaveState>("idle");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pending = useRef<Record<string, unknown> | null>(null);
  const seq = useRef(0); // increments per edit; only the latest applied result "wins"
  const inFlight = useRef(0);

  const flush = useCallback(async () => {
    if (!noteId || !pending.current) return;
    if (timer.current) clearTimeout(timer.current);
    const payload = pending.current;
    pending.current = null;
    const mySeq = ++seq.current;
    inFlight.current = mySeq;
    setState("saving");
    try {
      const updated = await api.patch<Note>(`/notes/${noteId}`, payload);
      // Only reflect success (and reconcile caches) if no newer edit/save has
      // superseded this one — avoids an older response stomping newer edits.
      if (inFlight.current === mySeq && !pending.current) {
        setState("saved");
        qc.setQueryData(["note", noteId], updated);
        patchNoteInLists(qc, noteId, updated);
      }
    } catch {
      if (inFlight.current === mySeq) setState("error");
    }
  }, [noteId, qc]);

  const queue = useCallback(
    (patch: Record<string, unknown>) => {
      pending.current = { ...pending.current, ...patch };
      setState("unsaved");
      // Optimistically refresh the list card as the user types (title + a
      // client-derived preview + a fresh timestamp). The save response corrects
      // any drift; position isn't changed here (see patchNoteInLists).
      if (noteId) {
        const optimistic: Partial<NoteCard> = { updatedAt: new Date().toISOString() };
        if (typeof patch.title === "string") optimistic.title = patch.title;
        if (patch.content !== undefined) optimistic.preview = makePreview(patch.content);
        patchNoteInLists(qc, noteId, optimistic);
      }
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(flush, debounceMs);
    },
    [flush, debounceMs, noteId, qc]
  );

  // Safety net: flush on unmount (navigation away).
  useEffect(() => {
    return () => {
      if (pending.current) void flush();
    };
  }, [flush]);

  // Flush before the tab closes/reloads. `keepalive` lets the PATCH complete even
  // as the page unloads (sendBeacon can't PATCH).
  useEffect(() => {
    const onBeforeUnload = () => {
      if (pending.current && noteId) {
        const base = import.meta.env.VITE_API_BASE_URL ?? "/api";
        fetch(`${base}/notes/${noteId}`, {
          method: "PATCH",
          keepalive: true,
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(pending.current),
        }).catch(() => {});
      }
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [noteId]);

  return { state, queue, flush };
}
