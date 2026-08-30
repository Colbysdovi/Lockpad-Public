import { useEffect, useRef, useState } from "react";
import { useMatch } from "react-router-dom";
import { motion, useReducedMotion } from "framer-motion";
import { CornerDownLeft } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { FolderSelect, TagMultiSelect } from "./selectors";
import { useCreateNote } from "@/lib/hooks";
import { useNoteSheet } from "@/lib/useNoteSheet";
import { useIsMobile } from "@/lib/useIsMobile";
import { useToast } from "@/lib/useToast";
import { describeShortcut, keyLabel, IS_MAC } from "@/lib/shortcuts";
import { waitForVisibleCard } from "@/lib/quietCreate";
import { highlightNote } from "@/lib/noteFx";
import { EASE_FOLLOW, EASE_FOLLOW_REVERSED, BAR_SWAP_OUT_MS, BAR_SWAP_IN_MS, BAR_SWAP_TRAIL_MS, BAR_SWAP_OFFSCREEN } from "@/lib/motion";
import { useT, withSlot, SLOT } from "@/lib/i18n";

// Floating quick-create bar near the bottom of list views (replaces the old FAB).
// Folder/tag selectors are pre-filled from the current page context (spec §3.8).
//
// `onFocusChange` lets the parent list mirror the composer's focused state so the
// bottom-of-list fade can deepen alongside the bar's own lift. The state stays
// OWNED here rather than being lifted into a controlled prop: this component is the
// only thing that knows all the ways focus really ends (blur with an empty body,
// a click outside, Escape, submitting, being pushed off screen by an opening note).
// Splitting that decision across two components is exactly how the fade and the bar
// would drift out of sync. The parent only listens.

export function NoteBar({
  onFocusChange,
  yielded = false,
}: {
  onFocusChange?: (focused: boolean) => void;
  /** True while the bulk-action bar has taken over this slot (two or more notes
   *  ticked). The composer stays mounted and slides out of the viewport rather than
   *  unmounting — the same thing it already does when a note opens over the list,
   *  and it means a half-typed thought survives ticking a couple of cards. */
  yielded?: boolean;
}) {
  const t = useT();
  const folderMatch = useMatch("/folders/:id");
  const tagMatch = useMatch("/tags/:id");
  const create = useCreateNote();
  const { openNote, noteId } = useNoteSheet();
  const isMobile = useIsMobile();
  const reduceMotion = useReducedMotion();

  const toast = useToast();

  const [body, setBody] = useState("");
  // What the live region says. A note created silently gives a sighted user two
  // visible signals — the card sliding in and its highlight ring — and a screen
  // reader user neither, so the arrival is spoken here instead. Only the silent
  // path uses it: on the other two an editor opens onto the note, which announces
  // itself, and saying both would be telling someone twice.
  const [announcement, setAnnouncement] = useState("");
  const [folderId, setFolderId] = useState<string | null>(folderMatch?.params.id ?? null);
  const [tagIds, setTagIds] = useState<string[]>(tagMatch?.params.id ? [tagMatch.params.id] : []);
  const [focused, setFocused] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  // The draft again, as a ref, and this is the copy `submit` reads.
  //
  // `body` state is what RENDERS — it sizes the textarea, expands the bar on mobile,
  // enables the Create button. But state does not change until React re-renders, and
  // the keydown handler bound to the DOM right now closes over the value from the
  // render it was created in. So two Enter presses in the same tick both saw the same
  // un-cleared draft and filed the same thought twice — pressing Enter twice out of
  // habit after one quick note, which is not an exotic thing to do, and on a silent
  // path there is no opening editor to make the duplicate obvious.
  //
  // Clearing a ref takes effect on the very next line, so the second press reads an
  // empty draft and does nothing. Two copies of one value is a cost worth naming, but
  // the alternative is a submit path that cannot be made correct.
  const draftRef = useRef("");

  // On phones the bar collapses to a single line when idle; the Create button and
  // folder/tag row only appear once you focus it or start typing, reclaiming
  // vertical space. On desktop it's always fully expanded.
  const expanded = !isMobile || focused || body.trim().length > 0;

  useEffect(() => {
    setFolderId(folderMatch?.params.id ?? null);
  }, [folderMatch?.params.id]);
  useEffect(() => {
    setTagIds(tagMatch?.params.id ? [tagMatch.params.id] : []);
  }, [tagMatch?.params.id]);

  // Grow the textarea with its content so a long idea is fully visible before
  // creating it (caps at ~40vh, then scrolls).
  const autoGrow = () => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, Math.round(window.innerHeight * 0.4))}px`;
  };
  useEffect(autoGrow, [body]);

  // Re-measure on resize as well as on typing. autoGrow writes an EXPLICIT height,
  // and the right height depends on the viewport twice over: the min-height drops
  // from 44px to 36px at the sm: breakpoint, and a narrower bar wraps the text into
  // more lines. Without this, a height worked out on a phone survives a rotate or a
  // window resize — a 44px box on desktop, where the CSS asks for 36, which pushes
  // the single line of text 4px above the Create button it is supposed to sit level
  // with. Same class of bug as the padding above, arriving by a different route.
  useEffect(() => {
    window.addEventListener("resize", autoGrow);
    return () => window.removeEventListener("resize", autoGrow);
  }, []);

  // Collapse when focus leaves the whole bar and nothing has been typed. The
  // relatedTarget check keeps it open while tapping the Create button or the
  // folder/tag triggers (which live inside the card).
  const handleBlur = (e: React.FocusEvent<HTMLDivElement>) => {
    if (body.trim()) return;
    const next = e.relatedTarget as Node | null;
    if (next && cardRef.current?.contains(next)) return;
    setFocused(false);
  };

  // Report focus upward so the list's bottom fade can follow it. One-way: the
  // parent never sets it back.
  useEffect(() => {
    onFocusChange?.(focused);
  }, [focused, onFocusChange]);

  // ...and always report "not focused" on unmount. The composer is REPLACED by the
  // bulk-action bar the moment a second note is selected, so without this the fade
  // would stay deepened with no composer left on screen to justify it.
  useEffect(() => () => onFocusChange?.(false), [onFocusChange]);

  // Two explicit ways out of the focused state, beyond simply tabbing away.
  //
  // Clicking anywhere else, or pressing Escape, returns the composer to idle. Both
  // deliberately ignore the "has unsent text" rule that `handleBlur` observes: that
  // rule exists so the bar doesn't collapse under you while you're still writing,
  // but once you've clicked away or pressed Escape you have said you're done
  // looking at it, and a composer left lifted and glowing over a dimmed list while
  // your attention is elsewhere is the stuck state this whole behaviour is meant to
  // avoid. Nothing is lost either way — the draft text stays exactly where it is,
  // and on mobile the bar stays expanded while it holds any, so nothing jumps.
  useEffect(() => {
    if (!focused) return;
    const toIdle = () => {
      setFocused(false);
      textareaRef.current?.blur();
    };
    const onPointerDown = (e: PointerEvent) => {
      const target = e.target;
      if (!(target instanceof Element)) return;
      if (cardRef.current?.contains(target)) return;
      // The folder and tag pickers open in a Radix portal, which is OUTSIDE the
      // card in the DOM even though it belongs to it on screen. Without this,
      // choosing a folder for the note you're composing would read as clicking away.
      if (target.closest("[data-radix-popper-content-wrapper], [role='dialog']")) return;
      toIdle();
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") toIdle();
    };
    // Capture phase, so a card that stops propagation on its own pointerdown can't
    // leave the composer stranded in the focused state.
    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [focused]);

  // Everything a silently created note is owed, once the server has confirmed it.
  //
  // Nothing opened, so the note has to announce itself. Three channels, because the
  // one that reaches a given person depends on how they are using the app:
  //
  //   the card sliding in    already handled by the list (markComposing → .card-arrive)
  //   the highlight ring     fired here
  //   spoken confirmation    the live region, fired here
  //
  // The ring is not decoration on top of the animation, it is the channel that
  // survives without it: `.card-arrive` is switched off entirely under
  // prefers-reduced-motion (index.css), while the ring is plain border and outline
  // utilities with no keyframes, so it renders identically either way. Without it a
  // reduced-motion user would get no visual confirmation at all. It also means the
  // signal is not carried by colour alone — the ring changes the card's border
  // WIDTH as well as its hue, and the spoken announcement carries it in words.
  const confirmQuietly = (noteId: string) => {
    // Cleared first, then set again a tick later. A live region only announces when
    // its contents CHANGE, so re-setting the same string after a second quick create
    // is silence — which is precisely the case that matters, since firing several
    // captures in a row is what this whole path is for. A timer rather than a frame
    // callback, for the reason spelled out in quietCreate.ts: frames stop being
    // served to a backgrounded tab, and an announcement that never fires is worse
    // than one that fires late.
    setAnnouncement("");
    window.setTimeout(() => setAnnouncement(t("composer.created")), 0);

    void waitForVisibleCard(noteId).then((seen) => {
      // Same 60ms beat NoteCard uses before its own highlights: the card mounts on a
      // React commit, and the effect that registers its highlight listener is
      // flushed after that commit rather than during it. Firing into the gap would
      // hit a card that exists but is not listening yet.
      window.setTimeout(() => highlightNote(noteId), 60);
      if (seen) return;
      // The card is not on screen — scrolled past, or filed into a folder this page
      // does not show. The arrival signal cannot be assumed seen, so say it in
      // words instead. Deliberately NOT shown on every quick create: a toast for
      // something the user just watched land is exactly the interruption this
      // feature exists to remove.
      toast(t("composer.created"), {
        kind: "success",
        action: { label: "Open", onClick: () => openNote(noteId) },
      });
    });
  };

  // Submitting the composer has TWO outcomes, and which one you get is the whole
  // point of this component now.
  //
  //   open: false  — create the note and stay exactly where you are. The quick jot.
  //   open: true   — create it and open the editor on it. What every submit used
  //                  to do, and what the Create button still does.
  //
  // Plain Enter takes the first, Mod+Enter the second (see the keydown handler).
  // The asymmetry is deliberate: capturing a thought is the common case and should
  // cost the least, while continuing to write is the deliberate one and is worth a
  // modifier. There are two ways to reach "create and open" (the button, Mod+Enter)
  // and one way to reach "create and stay", which reads as intentional because the
  // button is the mouse's only route and cannot be the silent one — a silent click
  // with the pointer already over the composer gives no feedback at all.
  const submit = async (open: boolean) => {
    // An empty draft creates nothing, on either path. The Create button has always
    // been disabled on an empty draft; the Enter key never checked, so pressing it
    // on an empty composer used to make a blank "Untitled" note and open it. That
    // was survivable while submitting always opened an editor — you could see what
    // you had made. On the silent path it would file an invisible empty note with
    // no feedback whatsoever, which is not a thing this composer should be able to
    // do by accident. Cmd+N is still the way to ask for a deliberately blank note.
    const text = draftRef.current.trim();
    if (!text) return;

    // The typed text becomes the note BODY (people think of the idea before the
    // title). Each line becomes a paragraph. Title stays "Untitled".
    const content = {
      type: "doc",
      content: text.split("\n").map((line) =>
        line.trim()
          ? { type: "paragraph", content: [{ type: "text", text: line }] }
          : { type: "paragraph" }
      ),
    };

    // Clear the draft BEFORE the request, not after it. Two things depend on this.
    //
    // The composer has to be ready for the next thought immediately, because the
    // whole value of a silent create is that you can fire several in a row — making
    // readiness wait on a network round trip would make quick capture slower than
    // the create-and-open path it replaces, not faster.
    //
    // And clearing late is a duplicate-note bug. `submit` reads `body` from the
    // render it was created in, so a second Enter arriving while the first request
    // was still in flight used to read the same un-cleared draft and create the
    // same note twice. Opening an editor happened to mask that; nothing masks it on
    // a silent path.
    //
    // The folder and tag selections deliberately do NOT clear: the next thought is
    // usually filed the same way as this one, and re-picking a folder for every
    // note in a run would undo the speed this is for.
    draftRef.current = "";
    setBody("");
    // Silent creates keep focus so the next note can be typed straight away. The
    // opening path drops it, as it always has — the editor is about to take focus
    // anyway, and a composer left glowing under an open note is the stale-focus
    // state the rest of this component works to avoid.
    if (open) setFocused(false);

    try {
      const note = await create.mutateAsync({
        content,
        folderId: folderId ?? undefined,
        tagIds: tagIds.length ? tagIds : undefined,
      });
      if (open) {
        // Land the caret at the end of the text we just seeded into the note body.
        openNote(note.id, undefined, { focusBody: true });
      } else {
        confirmQuietly(note.id);
      }
    } catch {
      // Put the draft back. Clearing early is what makes the composer instantly
      // reusable, and it is also what would quietly destroy someone's text if the
      // request failed — so the failure path owes them the text back, in the field,
      // with focus, ready to retry on one keypress. Folder and tags were never
      // cleared, so they are already intact.
      //
      // Restored rather than merged: nothing else can have typed into the field in
      // the meantime except the user, and if they HAVE started a new thought,
      // overwriting it would be worse than losing the failed one. So only restore
      // when the field is still empty.
      if (!draftRef.current) {
        draftRef.current = text;
        setBody(text);
      }
      textareaRef.current?.focus();
      // A silent failure stacked on top of an already-silent success path is the
      // one outcome this feature must not have. Said out loud, every time, on all
      // three routes — a create that failed after opening an editor onto a note
      // that does not exist is worse than the silent case, not better.
      toast(t("composer.createFailed"), { kind: "error" });
    }
  };

  // On desktop the floating note panel slides in over the list, so the composer
  // gets pushed straight down out of the viewport while a note is open (it slides
  // back up on close). It stays mounted so the motion can play both ways. On mobile
  // the bottom sheet covers it, so no push is needed. Mobile's `noteId` open still
  // renders the composer underneath the sheet unchanged.
  // Two things can take this slot away from the composer, and it leaves the same
  // way for both.
  //
  // A note opening over the list is the desktop-only one: on mobile the sheet covers
  // the composer outright, so there is nothing to get out of the way of. The bulk
  // bar is NOT desktop-only — it stands in this exact slot on every size, so the
  // composer has to clear it everywhere.
  const pushedDown = (!isMobile && !!noteId) || yielded;

  // Opening a note slides the composer straight down out of the viewport. A bar
  // that is no longer on screen has no business still counting as focused — the
  // list's fade would stay deepened for a composer nobody can see.
  useEffect(() => {
    if (pushedDown) setFocused(false);
  }, [pushedDown]);

  // Was the composer away because the BULK BAR took the slot, rather than because a
  // note was open? It changes how it comes back.
  //
  // Coming back from an open note, the composer rises in step with the note panel
  // collapsing into its card — it has the slot to itself the whole way, so it starts
  // immediately. Coming back from the bulk bar, the bulk bar is still on its way
  // DOWN through the same few hundred pixels, and starting immediately would send
  // the two past each other. So this return waits out the trail.
  //
  // Read during render rather than from an effect because the transition is chosen
  // during render: the ref still holds the PREVIOUS value on exactly the render
  // where `yielded` flips false, which is the one render whose transition matters.
  const wasYielded = useRef(yielded);
  const returningFromBulk = wasYielded.current && !yielded;
  useEffect(() => {
    wasYielded.current = yielded;
  }, [yielded]);

  return (
    <motion.div
      aria-hidden={pushedDown}
      initial={reduceMotion ? { opacity: 0 } : { y: 40, opacity: 0 }}
      animate={
        pushedDown
          ? reduceMotion
            ? { y: 0, opacity: 0 }
            : { y: BAR_SWAP_OFFSCREEN, opacity: 1 }
          : { y: 0, opacity: 1 }
      }
      // Matched to the note sheet's own motion so the two move as one: pushing DOWN
      // uses the note's OPEN curve (ease-out); sliding back UP uses the note's CLOSE
      // curve (ease-in — the same EASE_IN the panel shrinks with), so the composer
      // returns exactly as the note collapses into its card rather than snapping
      // back early. The bulk bar leaves and arrives on these same two curves, which
      // is what makes handing the slot between them read as one movement.
      transition={
        pushedDown
          ? { type: "tween", duration: BAR_SWAP_OUT_MS / 1000, ease: EASE_FOLLOW }
          : {
              type: "tween",
              duration: BAR_SWAP_IN_MS / 1000,
              ease: EASE_FOLLOW_REVERSED,
              // Only when the bulk bar is the thing clearing out of the way; see
              // `returningFromBulk` above.
              delay: returningFromBulk ? BAR_SWAP_TRAIL_MS / 1000 : 0,
            }
      }
      // `bottom` rides the keyboard inset (--kb, published by useKeyboardInset) so
      // an open software keyboard lifts the composer above it instead of burying it.
      // --kb is 0 on desktop / when closed, so this is a no-op there.
      style={{ bottom: "var(--kb, 0px)" }}
      className="pointer-events-none absolute inset-x-0 bottom-0 z-30 flex justify-center px-4 pt-2 pb-[calc(env(safe-area-inset-bottom)_+_1rem)]"
    >
      <div
        ref={cardRef}
        onBlur={handleBlur}
        className={`surface-elevated composer-bar flex w-full max-w-2xl flex-col gap-2 p-2.5${pushedDown ? " pointer-events-none" : " pointer-events-auto"}${focused ? " is-focused" : ""}`}
      >
        <div className="flex items-center gap-2">
          <textarea
            ref={textareaRef}
            value={body}
            onChange={(e) => {
              // Both copies move together. The ref is the submit path's truth (see
              // its declaration); the state is what renders.
              draftRef.current = e.target.value;
              setBody(e.target.value);
            }}
            onFocus={() => setFocused(true)}
            onKeyDown={(e) => {
              if (e.key !== "Enter") return;
              // Shift+Enter inserts a newline, and always has. This guard is the
              // reason the "create and open" binding is Mod+Enter rather than the
              // Shift+Enter originally proposed: this field is a plain textarea, so
              // Shift+Enter is how a multi-line quick note gets written at all, and
              // taking it would have silently removed that.
              if (e.shiftKey) return;
              // An IME confirming a candidate sends Enter too. Creating a note the
              // moment somebody picks a Japanese or Chinese word out of the
              // candidate list would be wrong on either path and invisible on the
              // silent one, so composition Enters are left to the IME.
              if (e.nativeEvent.isComposing) return;
              e.preventDefault();
              // Mod — Command on a Mac, Control everywhere else. Read directly off
              // the event rather than through a platform branch of our own, which
              // is the same portable "Mod" convention lib/shortcuts.ts prints for
              // every other binding in the app.
              submit(e.metaKey || e.ctrlKey);
            }}
            rows={1}
            placeholder={t("composer.placeholder")}
            // The vertical padding is derived from the min-height, not picked: a
            // textarea lays its first line out at the TOP of its box, so with
            // min-h-11 (44px) and py-1.5 (6px) a single line of 20px text sat 6px
            // from the top and 18px from the bottom — visibly high against the
            // Create button, which the row's `items-center` centres properly.
            // (44 − 20) / 2 = 12px = py-3 on phones, and (36 − 20) / 2 = 8px = py-2
            // at sm:, where the min-height drops to 36. autoGrow sizes from
            // scrollHeight, so it picks the new padding up on its own and multi-line
            // growth is unaffected.
            className="max-h-[40vh] min-h-11 flex-1 resize-none bg-transparent px-1 py-3 text-sm outline-none placeholder:text-muted-foreground sm:min-h-9 sm:py-2"
          />
          {expanded && (
            /* The button is unconditionally "create and open", whatever modifier
               happens to be held while it is clicked. Someone reaching for the
               mouse has already left the keyboard; making the pointer's only route
               change meaning based on a key they are not looking at would be a trap,
               and it is the one route that cannot afford to be the silent one — a
               click that gives no feedback, with the pointer sitting on the button,
               reads as a button that did not work.

               ── Why the label says both verbs, and why the keycap is gone ────────

               "Create" alone was fine while Enter and this button did the same
               thing. They no longer do, and a button that says only "Create" sitting
               above a composer where Enter also creates reads as the same action by
               another route — which is now the one thing it is not. The label names
               the whole outcome instead, so the difference is legible without having
               learnt a key.

               It keeps its ⌘↵ keycaps alongside the words. The label says WHAT
               happens and the caps say WHICH KEYS do it, and those are two different
               questions — the hint below the divider teaches the pair of bindings in
               prose, while these sit on the control itself, where somebody reaching
               for the mouse learns the shortcut without having read anything. Both
               are drawn from the same keyLabel table the shortcuts reference prints
               from, so none of the three can drift apart.

               No aria-label. The caps are aria-hidden, so the visible words ARE the
               accessible name — the outcome WCAG 2.5.3 wants, and one fewer string
               to keep in step with what is drawn. The key combination still reaches
               assistive tech through the hint below and through the shortcuts
               reference, both of which spell it out in words rather than symbols. */
            <Button
              size="sm"
              onClick={() => submit(true)}
              disabled={create.isPending || !body.trim()}
              className="h-9 gap-1.5 px-4 sm:h-8 sm:px-3"
            >
              {t("composer.createAndOpen")}
              {/* Hidden on phones, for the same reason the hint below is: a soft
                  keyboard has no ⌘ or Ctrl to press, so the caps would be naming
                  hardware the reader does not have. The button itself stays, which
                  is what keeps create-and-open reachable on every platform. */}
              <span aria-hidden="true" className="hidden items-center gap-0.5 sm:inline-flex">
                <span className="text-xs">{keyLabel("Mod")}</span>
                <CornerDownLeft className="h-3.5 w-3.5" />
              </span>
            </Button>
          )}
        </div>
        {/* Spoken confirmation for a note created without opening it. Inside the
            composer rather than in some global tray because it is the composer's own
            action being confirmed, and a region that lives beside the control that
            triggered it is announced in the right order relative to it. */}
        <span className="sr-only" aria-live="polite" aria-atomic="true">{announcement}</span>
        {expanded && (
          <div className="flex flex-wrap items-center gap-2 border-t pt-2">
            {/* `sm:h-9 sm:text-sm` rather than `sm:h-8 sm:text-xs`, so the folder trigger is
                the same height as the tag chips and the Tags button beside it — those are
                h-9/text-sm, and FolderSelect's own default already is too. The old override
                made it 32px next to their 36px, which read as one control sitting slightly
                low in a row of three. Mobile keeps its taller h-10: a bigger touch target is
                worth more than pixel symmetry on a bar you thumb at. */}
            <FolderSelect value={folderId} onChange={setFolderId} className="h-10 text-sm sm:h-9 sm:text-sm" />
            <TagMultiSelect value={tagIds} onChange={setTagIds} />

            {/* The two Enter keys, named. This is the only place in the app that
                teaches the split without the reader having gone looking for it.
                Plain Enter is now the composer's default and it does something
                invisible — the note is filed and nothing opens — so a first
                encounter with no explanation is indistinguishable from the app
                having ignored the keypress. One quiet line removes that.

                Both bindings, not just the new one. A hint that named only ⌘Enter
                would leave a reader who already knows this composer assuming Enter
                still opens the note, which is the exact misreading worth spending a
                line to prevent.

                Right-aligned via ml-auto and left as the row's last child, so the
                two things you might reach for stay together on the left and the
                thing you only ever read sits apart from them. `flex-wrap` on the row
                gives it its own line when the bar is too narrow rather than
                squeezing the folder and tag controls.

                Not a Tooltip and not an info icon: a hint that has to be hovered to
                be found is not a hint, it is a secret, and the whole reason this
                exists is that the behaviour it describes leaves no trace on screen.

                Hidden below `sm:`, which is a real decision rather than a space
                saving. A soft keyboard has no ⌘ or Ctrl to hold, so half this line
                would name a combination that cannot be pressed where it is being
                read — worse than saying nothing. The gate is CSS rather than
                `isMobile` only because it is purely presentational; the two flip at
                exactly the same width by design (see useIsMobile). Nothing is lost
                on a phone: the button says what it does, and plain Enter behaves the
                same there. */}
            {/* 85% of --muted-foreground, which is BELOW WCAG AA, on purpose.
                Recorded here so nobody "fixes" it back.
                
                This text sits on a translucent surface floating over both the canvas
                and the note cards, in two themes, so it has four backdrops. At full
                strength the worst of them (dark, over a card) computes 4.82:1; the
                last mix that clears AA's 4.5:1 everywhere is 96%, which is a 4%
                change nobody can see. So "quieter" and "still AA" were not both
                available, the tradeoff was put to Colbys with the measurements, and
                he chose quieter — three times, each with the measurements in
                front of him, the last time after seeing all five levels rendered
                side by side at true size. Measured at 60%: light 2.43 over the
                canvas and 2.46 over a card, dark 2.74 and 2.67.
                
                That is below BOTH lines: under the 4.5:1 AA asks of 12px text, and
                under the 3:1 floor AA sets for large text and UI components. Said
                plainly because it should not be discovered by surprise — at this
                strength the line is not reliably readable by everyone, and on a
                bright screen or at an angle it may not be readable at all.
                
                ── Why the numbers moved so much further than the appearance ──────
                
                Worth recording, because it is the part that is easy to get wrong
                twice. The contrast RATIO has a lot of range here and the perceived
                dimness has very little: --muted-foreground is a warm brown on a warm
                cream surface, so mixing it toward transparent slides it toward the
                background's own hue — the value drops, the colour stays in family,
                and at 12px the eye reads "quiet text" across most of the range. The
                first two steps (96%, then 85%) measured as large changes and looked
                like none. Do not reach for another alpha step expecting a visible
                result; if this ever needs to recede further, size, letter-spacing,
                or showing it only while the composer has focus all buy more
                apparent quiet per unit of legibility lost.
                
                What makes that defensible rather than careless: this line is the
                only thing on screen that is PURE redundancy. Both bindings it names
                are also in the shortcuts reference, spelled out in words, at full
                contrast; the button beside it states its own action in full-strength
                text; and neither key stops working if the hint is never read. It
                teaches once and then wants to disappear. Nothing else in this app
                sits below AA, and nothing else should — see the GroupLabel comment
                in Sidebar.tsx, where the same shortcut was measured and rejected
                because that label is not redundant. */}
            <p className="ml-auto hidden text-xs text-[color-mix(in_srgb,var(--muted-foreground)_60%,transparent)] sm:block">
              {/* Sighted readers get the platform's own symbol; a screen reader gets
                  the keys in words, via the same describeShortcut every other
                  shortcut in the app is announced with. `role="img"` is what makes
                  the label replace the glyphs rather than being read after them. */}
              {/* The keycap is a NODE, not a word, so the sentence cannot simply be
                  translated around it — it has to be split at the placeholder and the
                  node dropped in. Doing it this way rather than concatenating "Enter"
                  onto a translated tail keeps the placeholder's POSITION the
                  language's business: English and French both happen to put the key
                  first, and a language that did not would still come out right. */}
              {withSlot(t("composer.hint.save", { key: SLOT }), (
                <span role="img" aria-label={describeShortcut(["Enter"])}>Enter</span>
              ))}
              {" · "}
              {withSlot(t("composer.hint.open", { key: SLOT }), (
                <span role="img" aria-label={describeShortcut(["Mod", "Enter"])}>
                  {/* ⌘Enter on a Mac, Ctrl+Enter everywhere else. Mac runs its
                      modifiers straight into the key with nothing between them, which
                      is the platform's own habit; spelled-out modifiers need the plus
                      or "CtrlEnter" reads as one word. */}
                  {keyLabel("Mod")}{IS_MAC ? "" : "+"}Enter
                </span>
              ))}
            </p>
          </div>
        )}
      </div>
    </motion.div>
  );
}
