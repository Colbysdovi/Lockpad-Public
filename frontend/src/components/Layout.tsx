import { useEffect, useState, useCallback } from "react";
import { useOutlet, useLocation } from "react-router-dom";
import { motion, AnimatePresence, useReducedMotion } from "framer-motion";
import { Search, Plus, Sun, Moon, Menu, PanelLeftClose, LogOut, MoreVertical, Keyboard } from "@/components/icons";
import { Sidebar } from "./Sidebar";
import { SearchPalette } from "./SearchPalette";
import { ShortcutsDialog } from "./ShortcutsDialog";
import { formatShortcut } from "@/lib/shortcuts";
import { NotePrintHost } from "./NotePrintHost";
import { NoteFxLayer } from "@/lib/noteFx";
import { Logo } from "./Logo";
import { DesktopNoteSheet, MobileNoteSheet } from "./NoteSheet";
import { Button } from "@/components/ui/button";
import { Tooltip } from "@/components/ui/tooltip";
import { ResponsiveMenu, ResponsiveMenuItem } from "@/components/ui/responsive-menu";
import { useNewNote } from "@/lib/useNewNote";
import { useTheme } from "@/lib/useTheme";
import { useNoteSheet } from "@/lib/useNoteSheet";
import { useIsMobile } from "@/lib/useIsMobile";
import { useKeyboardInset } from "@/lib/useKeyboardInset";
import { useAuth } from "@/lib/auth";
import { cn } from "@/lib/utils";
import { EASE_FOLLOW, SIDEBAR_MS } from "@/lib/motion";
import { useT } from "@/lib/i18n";

const SIDEBAR_KEY = "lockpad.sidebar.open";

const tap = { whileHover: { scale: 1.06 }, whileTap: { scale: 0.94 } };

// Page-to-page transition. The routed page is keyed by pathname inside an
// AnimatePresence in `mode="wait"`, so the outgoing page fully plays out before
// the incoming one animates in (the deliberate out-then-in sequence). `useOutlet`
// (rather than <Outlet/>) hands us the page element so the *exiting* copy keeps
// its own previously-rendered content while it leaves — AnimatePresence holds that
// old keyed subtree, and the note cards inside it run their own staggered exit
// (see NoteList). The page wrapper itself just cross-fades; the per-card slide is
// what gives the "notes fall away one by one" texture.
function AnimatedOutlet() {
  const location = useLocation();
  const outlet = useOutlet();
  const reduceMotion = useReducedMotion();
  return (
    <AnimatePresence mode="wait" initial={false}>
      <motion.div
        key={location.pathname}
        className="h-full"
        initial={reduceMotion ? { opacity: 0 } : { opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0, transition: { duration: 0.26, ease: EASE_FOLLOW } }}
        exit={
          reduceMotion
            ? { opacity: 0, transition: { duration: 0.16 } }
            : { opacity: 0, transition: { duration: 0.28, ease: EASE_FOLLOW, delay: 0.08 } }
        }
      >
        {outlet}
      </motion.div>
    </AnimatePresence>
  );
}

export function Layout() {
  const [sidebarOpen, setSidebarOpen] = useState(() => localStorage.getItem(SIDEBAR_KEY) !== "false");
  const [searchOpen, setSearchOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  // Search query is kept here so it survives closing the palette — reopening
  // restores the same text + result list.
  const [searchQuery, setSearchQuery] = useState("");
  const { createNote } = useNewNote();
  const { theme, toggle: toggleTheme } = useTheme();
  const t = useT();
  const { noteId, closeNote } = useNoteSheet();
  const { status, logout } = useAuth();
  const isMobile = useIsMobile();
  const location = useLocation();
  // Track the software keyboard so bottom-anchored UI (composer, bulk bar, note
  // sheet, toasts) lifts above it on mobile instead of hiding behind it.
  useKeyboardInset();

  const toggleSidebar = useCallback(() => {
    setSidebarOpen((o) => {
      // Only the desktop collapse preference is persisted; the mobile drawer is
      // always closed on load.
      localStorage.setItem(SIDEBAR_KEY, String(!o));
      return !o;
    });
  }, []);

  // On mobile the sidebar is a drawer: closed by default, and it closes after
  // navigating to a folder/tag/section.
  useEffect(() => {
    if (isMobile) setSidebarOpen(false);
  }, [isMobile]);
  useEffect(() => {
    if (isMobile) setSidebarOpen(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.pathname]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setSearchOpen(true);
      } else if (mod && e.key.toLowerCase() === "n") {
        e.preventDefault();
        createNote();
      } else if (mod && e.key === "\\") {
        e.preventDefault();
        toggleSidebar();
      } else if (e.key === "Escape" && noteId) {
        closeNote();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [createNote, toggleSidebar, noteId, closeNote]);

  // Shared style for header icon buttons — one size/hover/press system so theme,
  // sign-out, import, search and the overflow menu read as a single coherent set.
  // The primary action (New note) stays a filled Button to remain distinct.
  const headerIcon =
    "h-11 w-11 items-center justify-center rounded-md text-muted-foreground transition-colors hover-scrim hover:text-foreground sm:h-9 sm:w-9";

  return (
    <div className="app-shell flex flex-col">
      {/* Floating top bar — a rounded, bordered, softly-elevated card like every
          other surface (matches the sidebar's material), taller than before so the
          inline search box can be bigger. */}
      {/* The header is a FLOATING rounded card (mx-3), so the status-bar safe-area
          inset belongs in its top MARGIN — dropping the whole card below the status
          bar — not its padding (which would just inflate the card to a tall bar whose
          content sits under the status bar in standalone PWA). On desktop the inset is
          0, so mt collapses to the usual 0.75rem. */}
      <header className="raised-top relative z-30 mx-3 mb-0 mt-[calc(env(safe-area-inset-top)_+_0.75rem)] flex items-center gap-2 rounded-2xl border bg-card px-4 pb-1.5 pt-1.5 shadow-sm sm:pb-4 sm:pt-4">
        {/* One toggle: shows the collapse icon when the sidebar is open and the
            hamburger when it's hidden — the two are just states of each other.

            One name for the panel, in both directions: "sidebar". It used to be
            called a menu when closed and a sidebar when open, which asked the
            reader to work out that the two tooltips were the same control. The
            keyboard-shortcut reference already said "Show or hide the sidebar",
            so this is now the only name it has anywhere. "Menu" lost despite the
            hamburger icon, because this app has several actual menus — the ⋮
            overflow, the block handle, the slash commands — and reusing the word
            for the navigation column would collide with all of them.

            Show/Hide rather than Open/Collapse: it is the pairing macOS itself
            uses for the same control, and "collapse" describes what the
            animation does rather than what the reader gets. */}
        <Tooltip label={sidebarOpen ? t("header.sidebar.hide") : t("header.sidebar.show")} side="bottom">
          <motion.button
            {...tap}
            onClick={toggleSidebar}
            aria-label={sidebarOpen ? t("header.sidebar.hide") : t("header.sidebar.show")}
            className="inline-flex h-11 w-11 items-center justify-center rounded-md text-muted-foreground hover-scrim hover:text-foreground sm:h-9 sm:w-9"
          >
            {sidebarOpen ? <PanelLeftClose className="h-5 w-5 sm:h-4 sm:w-4" /> : <Menu className="h-5 w-5 sm:h-4 sm:w-4" />}
          </motion.button>
        </Tooltip>
        {/* The wordmark earns its place on desktop; on phones the header is tight
            and the user already knows where they are — so the logo is dropped to
            give the actions room. */}
        <Logo className="hidden sm:flex" />
        <button
          onClick={() => setSearchOpen(true)}
          className="absolute left-1/2 top-1/2 hidden h-11 w-80 -translate-x-1/2 -translate-y-1/2 items-center gap-2.5 rounded-xl border px-4 text-sm text-muted-foreground transition-colors hover-scrim sm:flex"
        >
          <Search className="h-4 w-4" /> {t("header.searchPlaceholder")}
          {/* Was hardcoded to "⌘K", which was simply wrong on Windows and Linux —
              the handler above has always accepted Ctrl as well, so the hint
              disagreed with the app for every non-Mac user. It now comes from the
              same helper the shortcuts reference uses, so the two surfaces cannot
              drift apart or contradict each other again. */}
          <kbd className="ml-auto font-sans text-xs">{formatShortcut(["Mod", "K"])}</kbd>
        </button>
        <div className="ml-auto flex items-center gap-1.5">
          {/* Search — icon on phones, part of the inline box on desktop. */}
          <motion.button {...tap} onClick={() => setSearchOpen(true)} aria-label={t("header.search")} className={cn(headerIcon, "inline-flex sm:hidden")}>
            <Search className="h-5 w-5" />
          </motion.button>
          {/* Desktop-only inline actions; on phones these move into the ⋮ menu. */}
          {/* Keyboard shortcuts. Unlike its neighbours this one has NO phone
              counterpart in the ⋮ menu, and that is the point rather than an
              omission: a phone has no modifier keys, so the reference would
              document hardware the reader does not have. `hidden sm:inline-flex`
              is the whole of the mobile treatment. */}
          <Tooltip label={t("header.shortcuts")} side="bottom">
            <motion.button
              {...tap}
              onClick={() => setShortcutsOpen(true)}
              aria-label={t("header.shortcuts")}
              className={cn(headerIcon, "hidden sm:inline-flex")}
            >
              <Keyboard className="h-4 w-4" />
            </motion.button>
          </Tooltip>
          <Tooltip label={theme === "dark" ? t("header.theme.toLight") : t("header.theme.toDark")} side="bottom">
            <motion.button
              {...tap}
              onClick={toggleTheme}
              aria-label={theme === "dark" ? t("header.theme.toLight") : t("header.theme.toDark")}
              className={cn(headerIcon, "hidden sm:inline-flex")}
            >
              {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
            </motion.button>
          </Tooltip>
          {status === "authed" && (
            <Tooltip label={t("header.signOut")} side="bottom">
              <motion.button {...tap} onClick={() => logout()} aria-label={t("header.signOut")} className={cn(headerIcon, "hidden sm:inline-flex")}>
                <LogOut className="h-4 w-4" />
              </motion.button>
            </Tooltip>
          )}
          {/* New note — the one filled, primary action. A compact 36px square on
              phones (a filled block reads heavier than the ghost icons beside it, so
              it stays prominent without matching their 44px footprint); grows to an
              icon+label pill on desktop. Still the sole creator on pages that have no
              composer (Archive / Trash / Settings). */}
          <Button size="sm" onClick={createNote} aria-label={t("header.newNote")} className="ml-0.5 h-9 w-9 gap-1.5 p-0 sm:w-auto sm:px-3">
            <Plus className="h-[18px] w-[18px] sm:h-4 sm:w-4" /> <span className="hidden sm:inline">{t("header.newNote")}</span>
          </Button>
          {/* Overflow (phones only): theme, import, sign out. */}
          <ResponsiveMenu
            title={t("header.more")}
            contentClassName="w-52"
            trigger={
              <button
                type="button"
                aria-label={t("header.more")}
                className={cn(headerIcon, "icon-press inline-flex sm:hidden")}
              >
                <MoreVertical className="h-5 w-5" />
              </button>
            }
          >
            <ResponsiveMenuItem onSelect={toggleTheme}>
              {theme === "dark" ? <Sun className="mr-2 h-4 w-4" /> : <Moon className="mr-2 h-4 w-4" />}
              {theme === "dark" ? t("header.theme.light") : t("header.theme.dark")}
            </ResponsiveMenuItem>
            {status === "authed" && (
              <ResponsiveMenuItem onSelect={() => logout()}>
                <LogOut className="mr-2 h-4 w-4" /> {t("header.signOut")}
              </ResponsiveMenuItem>
            )}
          </ResponsiveMenu>
        </div>
      </header>

      <div className="relative flex flex-1 overflow-hidden">
        {/* Desktop: inline collapsible sidebar column. Two animations run together
            and they do different jobs.

            The OUTER column animates its width between 16rem and 0. Because it is
            a flex sibling of <main>, that is what moves the page content across —
            the content is pushed aside by the sidebar rather than resized by some
            separate rule.

            The INNER wrapper keeps a fixed 16rem width so the sidebar's contents
            never reflow mid-animation, and slides by its own full width. This is
            the part that was missing. With the width animating alone, the panel
            stayed parked at the left edge and the narrowing column simply clipped
            it from the right — so the sidebar looked permanently present, with the
            page content sliding over and off it like a lid. Nothing appeared to
            arrive or leave.

            Translating the inner wrapper by exactly the width the column loses
            keeps the panel's right edge pinned to the content's left edge for
            every frame, so the two move as one: the sidebar walks off the left of
            the viewport and the content follows it in, which is what a reader
            expects a drawer to do. The 12px gap between them is the sidebar card's
            own m-3 and is preserved throughout, since both edges travel together.

            The duration and easing MUST stay identical on both. If they drift, the
            panel and the content separate mid-flight and a gap opens or the card
            overshoots into the content. */}
        {!isMobile && (
          <div
            style={{ transitionDuration: `${SIDEBAR_MS}ms` }}
            className={cn(
              "shrink-0 overflow-hidden transition-[width] ease-[var(--ease-follow)]",
              sidebarOpen ? "w-64" : "w-0"
            )}
          >
            <div
              style={{ transitionDuration: `${SIDEBAR_MS}ms` }}
              className={cn(
                "h-full w-64 transition-transform ease-[var(--ease-follow)]",
                sidebarOpen ? "translate-x-0" : "-translate-x-full"
              )}
            >
              <Sidebar floating />
            </div>
          </div>
        )}
        <main className="relative flex-1 overflow-hidden">
          <AnimatedOutlet />
        </main>

        {/* Mobile: sidebar as a slide-in drawer, positioned below the header so
            the header's toggle button stays visible and closes it. */}
        {isMobile && (
          <AnimatePresence>
            {sidebarOpen && (
              <>
                {/* Invisible click-catcher: closes the drawer on an outside tap
                    but casts NO dim over the content — the floating panel reads as
                    a lightweight overlay on top of the still-visible list. */}
                <div
                  key="drawer-backdrop"
                  className="absolute inset-0 z-40"
                  onClick={toggleSidebar}
                />
                <motion.div
                  key="drawer"
                  initial={{ x: "-100%" }}
                  animate={{ x: 0 }}
                  exit={{ x: "-100%" }}
                  // Same constant as the desktop column: one control, one speed.
                  transition={{ duration: SIDEBAR_MS / 1000, ease: EASE_FOLLOW }}
                  // A floating rounded panel that slides in from the left, instead of
                  // a flush full-height slab butting against the header. The WRAPPER
                  // itself is the card — rounded, bordered, raised-top highlight,
                  // elevated shadow, inset by 12px so it floats clear of the header
                  // and screen edges (its left/top line up with the header's mx-3/mt-3)
                  // — and the plain Sidebar fills it. rounded overflow clips the nav's
                  // own scroll.
                  className="raised-top absolute bottom-3 left-3 top-3 z-40 w-[19rem] max-w-[80vw] overflow-hidden rounded-2xl border bg-card shadow-xl"
                >
                  <Sidebar onNavigate={() => setSidebarOpen(false)} />
                </motion.div>
              </>
            )}
          </AnimatePresence>
        )}
      </div>

      {/* Floating note panel + full-viewport dim scrim. Rendered at the app-shell
          level (not inside <main>) so the scrim covers ALL background chrome —
          top bar and sidebar included — while the panel floats over it. */}
      {!isMobile && <DesktopNoteSheet noteId={noteId} onClose={closeNote} />}

      {isMobile && <MobileNoteSheet noteId={noteId} onClose={closeNote} />}

      <SearchPalette open={searchOpen} onOpenChange={setSearchOpen} query={searchQuery} onQueryChange={setSearchQuery} />
      <ShortcutsDialog open={shortcutsOpen} onOpenChange={setShortcutsOpen} />
      {/* Print-to-PDF host (renders the note into a print-only portal on demand). */}
      <NotePrintHost />
      {/* Draws in-flight card clones (pin travel, duplicate stack) above everything. */}
      <NoteFxLayer />
    </div>
  );
}
