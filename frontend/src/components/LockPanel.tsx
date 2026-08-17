import { useLayoutEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Lock, Eye, LockOpen } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { Tooltip } from "@/components/ui/tooltip";
import { ResponsiveMenuItem } from "@/components/ui/responsive-menu";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { api } from "@/lib/api";
import { encryptNote, decryptNote, keyStore, type CryptoMeta } from "@/lib/crypto";
import { inlineNoteImages, ImageError } from "@/lib/noteImages";
import { beginLockFx } from "@/lib/noteFx";
import { dropSessionEditor } from "@/lib/editorSession";
import { LOCK_BLUR_MS } from "@/lib/motion";
import type { Note, NoteCard } from "@/lib/types";

export type LockMode = "lock" | "unlock" | "remove" | null;

// Lock / unlock UI (spec §3.9). Split into TRIGGERS (inline buttons on desktop,
// menu items on mobile) and the passphrase DIALOG, which is controlled by a shared
// `mode` owned by NoteView. The split matters: a dropdown menu item can't own the
// dialog, because selecting it unmounts the menu (and anything inside it) before the
// dialog could open — so the dialog lives at the NoteView top level, always mounted.

// Inline icon-button triggers (desktop note header).
export function LockButtons({ note, sessionUnlocked, onOpen }: { note: NoteCard; sessionUnlocked: boolean; onOpen: (m: LockMode) => void }) {
  if (!note.isLocked) {
    return (
      <Tooltip label="Lock note" side="bottom">
        <Button variant="ghost" size="icon" onClick={() => onOpen("lock")} aria-label="Lock note" className="h-11 w-11 shrink-0 sm:h-9 sm:w-9">
          <Lock className="h-5 w-5 sm:h-4 sm:w-4" />
        </Button>
      </Tooltip>
    );
  }
  return (
    <div className="flex shrink-0 items-center gap-2">
      {!sessionUnlocked && (
        <Tooltip label="View content" side="bottom">
          <Button variant="ghost" size="icon" onClick={() => onOpen("unlock")} aria-label="View content" className="h-11 w-11 shrink-0 sm:h-9 sm:w-9">
            <Eye className="h-5 w-5 sm:h-4 sm:w-4" />
          </Button>
        </Tooltip>
      )}
      <Tooltip label="Remove lock" side="bottom">
        <Button variant="ghost" size="icon" onClick={() => onOpen("remove")} aria-label="Remove lock" className="h-11 w-11 shrink-0 sm:h-9 sm:w-9">
          <LockOpen className="h-5 w-5 sm:h-4 sm:w-4" />
        </Button>
      </Tooltip>
    </div>
  );
}

// Menu-item triggers (mobile "More options" dropdown) — same actions as LockButtons.
export function LockMenuItems({ note, sessionUnlocked, onOpen }: { note: NoteCard; sessionUnlocked: boolean; onOpen: (m: LockMode) => void }) {
  if (!note.isLocked) {
    return <ResponsiveMenuItem onSelect={() => onOpen("lock")}><Lock className="mr-2 h-4 w-4" />Lock this note</ResponsiveMenuItem>;
  }
  return (
    <>
      {!sessionUnlocked && <ResponsiveMenuItem onSelect={() => onOpen("unlock")}><Eye className="mr-2 h-4 w-4" />View content</ResponsiveMenuItem>}
      <ResponsiveMenuItem onSelect={() => onOpen("remove")}><LockOpen className="mr-2 h-4 w-4" />Remove lock</ResponsiveMenuItem>
    </>
  );
}

// The passphrase dialog, fully controlled by `mode`. All crypto happens client-side;
// only ciphertext leaves the browser. Session unlock decrypts for viewing without
// changing the at-rest ciphertext; "Remove lock" restores plaintext server-side.
export function LockDialog({ note, mode, onModeChange, onSessionUnlock }: { note: NoteCard; mode: LockMode; onModeChange: (m: LockMode) => void; onSessionUnlock: (doc: unknown) => void }) {
  const qc = useQueryClient();
  const [passphrase, setPassphrase] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // `mode` drops to null the moment the dialog starts closing, but the dialog stays
  // mounted through its close animation — so the mode-dependent copy must NOT read
  // `mode` directly or it would flip to the fallback wording mid-fade. `displayMode`
  // latches the last real mode so the text stays put while the modal animates out.
  const [displayMode, setDisplayMode] = useState<Exclude<LockMode, null>>("lock");
  useLayoutEffect(() => { if (mode) setDisplayMode(mode); }, [mode]);

  // Locking/unlocking encrypt in the browser via WebCrypto (crypto.subtle), which
  // browsers only expose in a secure context — HTTPS or localhost. Detect that up
  // front and explain, instead of failing with a confusing "Failed to lock note."
  const canEncrypt =
    typeof window !== "undefined" && window.isSecureContext && !!window.crypto?.subtle;

  const close = () => { onModeChange(null); setPassphrase(""); setError(null); };

  const submit = async () => {
    if (!passphrase) return;
    setBusy(true);
    setError(null);
    try {
      if (mode === "lock") {
        // The open note view has the document in cache; a note CARD does not carry
        // one at all (NoteCard has no `content`), so when the lock is fired from the
        // list it has to be fetched first. Encrypting whatever `content` happened to
        // be on the object would silently encrypt `undefined` — i.e. destroy the note.
        const cached = qc.getQueryData<Note>(["note", note.id])?.content;
        const current = cached !== undefined ? cached : (await api.get<Note>(`/notes/${note.id}`)).content;
        // Pull the note's pictures INTO the document before encrypting it. A note's
        // images are ordinary files on the server until this moment; folding them
        // into the document is what puts them behind the same passphrase as the
        // words, with no second ciphertext and no second key. The server deletes the
        // now-redundant image rows when the ciphertext lands (routes/lock.ts).
        // Deliberately not tolerant of failure: an image that could not be read is
        // an image that would be left readable, so the lock is refused instead.
        const withImages = await inlineNoteImages(current);
        const { ciphertext, cryptoMeta } = await encryptNote(withImages, passphrase);
        await api.post(`/notes/${note.id}/lock`, { ciphertext, cryptoMeta });
        // Close, then play the seal — and only refresh once it has played. The
        // refresh is what redacts the note, so doing it now would leave the
        // animation with nothing to blur (see useLockFx).
        close();
        // A parked editor holds the plaintext AND the steps to reconstruct it —
        // exactly what locking is supposed to put away. Drop it with the lock.
        dropSessionEditor(note.id);
        beginLockFx(note.id);
        window.setTimeout(() => {
          qc.invalidateQueries({ queryKey: ["note", note.id] });
          qc.invalidateQueries({ queryKey: ["notes"] });
        }, LOCK_BLUR_MS);
        return;
      }

      // Fetch ciphertext + decrypt client-side.
      const { ciphertext, cryptoMeta } = await api.get<{ ciphertext: string; cryptoMeta: CryptoMeta }>(`/notes/${note.id}/ciphertext`);
      const doc = await decryptNote(ciphertext, passphrase, cryptoMeta);
      if (mode === "unlock") {
        // Session-only: keep decrypted doc in memory, note stays encrypted at rest.
        keyStore.set(note.id, doc);
        onSessionUnlock(doc);
      } else if (mode === "remove") {
        // Permanently remove the lock: send decrypted content back.
        await api.post(`/notes/${note.id}/unlock`, { content: doc });
        keyStore.clear(note.id);
        qc.invalidateQueries({ queryKey: ["note", note.id] });
        qc.invalidateQueries({ queryKey: ["notes"] });
      }
      close();
    } catch (error) {
      // An image that could not be folded in explains itself; anything else in the
      // lock path is opaque enough that the generic message is the honest one.
      setError(
        mode === "lock"
          ? error instanceof ImageError
            ? `${error.message} The note was not locked.`
            : "Failed to lock note."
          : "Wrong passphrase, or decryption failed."
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={mode !== null} onOpenChange={(o) => !o && close()}>
      <DialogContent mobileSheet>
        {!canEncrypt ? (
          <>
            <DialogHeader>
              <DialogTitle>Locking needs a secure connection</DialogTitle>
              <DialogDescription>
                Locking and unlocking encrypt notes right in your browser, which needs a
                secure (HTTPS) connection. You’ve opened Lockpad over plain HTTP, so the
                browser has disabled encryption — that’s why it failed, not your passphrase.
              </DialogDescription>
            </DialogHeader>
            <p className="text-sm text-muted-foreground">
              Open Lockpad via its HTTPS address (your Tailscale <code>…ts.net</code> URL)
              to lock or unlock notes.
            </p>
            <div className="flex justify-end">
              <Button variant="ghost" onClick={close}>Close</Button>
            </div>
          </>
        ) : (
          <>
            <DialogHeader>
              {/* The two decryption modes look identical from the inside — same
                  passphrase, same crypto — but one is a look and the other is a
                  one-way change to how the note is stored. The copy is where that
                  difference has to land, so each mode says plainly what it leaves
                  behind. */}
              <DialogTitle>
                {displayMode === "lock"
                  ? "Lock this note"
                  : displayMode === "unlock"
                    ? "View this note for now"
                    : "Remove the lock permanently"}
              </DialogTitle>
              <DialogDescription>
                {displayMode === "lock"
                  ? "Choose a passphrase. The note is encrypted in your browser — the server never sees your passphrase or the plaintext. If you forget it, the note cannot be recovered."
                  : displayMode === "unlock"
                    ? "Enter the passphrase to read this note for the rest of this session. It stays locked and encrypted — nothing about it changes, you won’t be able to edit it, and it closes back up as soon as you reload or close the tab."
                    : "Enter the passphrase to take the lock off for good. The note goes back to being stored as ordinary text and becomes editable again — so anyone who can open Lockpad can read it. Locking it again afterwards is the only way back."}
              </DialogDescription>
            </DialogHeader>
            <Input
              type="password"
              autoFocus
              placeholder="Passphrase"
              value={passphrase}
              onChange={(e) => setPassphrase(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") submit(); }}
              className="h-11 px-3.5 sm:h-10"
            />
            {error && <p className="text-sm text-destructive">{error}</p>}
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={close} disabled={busy} className="h-11 px-5 sm:h-10">Cancel</Button>
              <Button onClick={submit} disabled={busy || !passphrase} className="h-11 px-6 sm:h-10">
                {busy ? "Working…" : displayMode === "lock" ? "Lock" : displayMode === "unlock" ? "View content" : "Remove lock"}
              </Button>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
