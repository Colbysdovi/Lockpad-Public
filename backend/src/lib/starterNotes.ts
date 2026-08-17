// The three notes a brand-new library starts with.
//
// They exist to solve the blank-page problem: the worst possible first minute in a
// notes app is an empty list and a cursor, because the app has just asked you to be
// interesting before it has shown you anything. So Lockpad puts something there
// first, and the wizard's second step points at one of these rather than describing
// folders and tags in the abstract.
//
// Written to be genuinely readable, not filler. The bar is that a new user should
// want to keep at least one of them, and should not be able to tell they were
// generated. Filler reads as filler immediately, and an app that greets you with
// three lorem-ipsum notes has told you what it thinks of your attention.
//
// Three genres on purpose, so the list has visible variety on first paint — the
// short/long/checklist mix is what makes a note list look inhabited rather than
// demoed. One of them carries a folder AND tags, which is the one the wizard shows.
//
// None of them is a reminder. That is a product decision, not a style one: Lockpad
// has no due dates, no alerts and no notion of a task coming round again, so a
// starter library full of "call the dentist" would be advertising a feature that
// does not exist and inviting people to keep the one kind of note this app is worst
// at holding. What ships instead is the kind of thing worth writing down BECAUSE
// nothing will remind you of it — a thought, a question, a piece of reasoning you
// would otherwise have to have twice.
//
// Never locked. Lockpad's encryption has no passphrase recovery by design, so a
// starter note locked with any system-chosen passphrase would be permanently
// unreadable — a brand-new library containing something the owner can never open is
// the worst first impression this app could manufacture.

type J = Record<string, unknown>;

const text = (t: string): J => ({ type: "text", text: t });
const bold = (t: string): J => ({ type: "text", text: t, marks: [{ type: "bold" }] });
const p = (...c: (J | string)[]): J =>
  c.length
    ? { type: "paragraph", content: c.map((x) => (typeof x === "string" ? text(x) : x)) }
    : { type: "paragraph" };
const heading = (level: number, t: string): J => ({ type: "heading", attrs: { level }, content: [text(t)] });
const task = (checked: boolean, t: string): J => ({
  type: "taskItem",
  attrs: { checked },
  content: [p(t)],
});
const taskList = (...items: J[]): J => ({ type: "taskList", content: items });
const bullet = (...items: string[]): J => ({
  type: "bulletList",
  content: items.map((t) => ({ type: "listItem", content: [p(t)] })),
});
const doc = (...content: J[]): J => ({ type: "doc", content });

export interface StarterNote {
  title: string;
  content: J;
  /** Folder name, which must appear in STARTER_FOLDERS. Omitted means loose. */
  folder?: string;
  /** Tag names to apply. Created if they don't exist. */
  tags?: string[];
}

/** The folders created alongside the notes, so the wizard can point at a real
 *  organised example instead of explaining the idea abstractly.
 *
 *  Named for what is in them rather than "Getting started", because a folder outlives
 *  the tour. A first-run label sitting in the sidebar six months later is a small
 *  permanent reminder that these notes were handed to you, which is the opposite of
 *  what the starter library is for.
 *
 *  TWO of them, not one, and the second is load-bearing rather than decorative. A
 *  library with a single folder cannot demonstrate choosing between folders, which is
 *  what the wizard's last step shows somebody doing; with only "Writing" available it
 *  filed a design idea under Writing, because that was the only answer in the box.
 *  Two folders also make step 2's sentence about folders grouping related notes true
 *  of the library the reader is looking at, rather than merely stated over it. */
export const STARTER_FOLDERS: { name: string; color: string }[] = [
  { name: "Writing", color: "#fcd34d" },
  { name: "Ideas", color: "#93c5fd" },
];

export const STARTER_NOTES: StarterNote[] = [
  // The organised one — folder AND tags. This is what the wizard's step 2 renders, so
  // it has to look good small: a title that survives truncation and a first line that
  // says something on its own, because a card preview only ever shows the top.
  //
  // A checklist, because task lists are worth showing on first paint, but a checklist
  // of QUESTIONS rather than errands. It keeps the genre without pretending the app
  // is somewhere to park chores.
  {
    title: "Questions that unstick a bad draft",
    folder: "Writing",
    tags: ["writing", "editing"],
    content: doc(
      p(
        "Collected over about two years. When something isn't working and I can't say why, one of these usually finds it.",
      ),
      taskList(
        task(true, "What's the one sentence I'd keep if I had to throw the rest away?"),
        task(true, "Who am I actually arguing with here?"),
        task(false, "Where does this stop being true?"),
        task(false, "What am I protecting by leaving it vague?"),
      ),
      p("The last one catches more than the other three together."),
    ),
  },

  // The short one. Deliberately a fragment — most real notes are, and a library where
  // every note is a tidy essay looks staged.
  {
    title: "Idea: reading list that admits defeat",
    // Filed, and filed as what it is. This note is a product idea, so it carries the
    // folder and the tags a product idea gets — which is also what lets the wizard's
    // last step show a design idea being filed without inventing anywhere to put it.
    folder: "Ideas",
    tags: ["design", "idea"],
    content: doc(
      p(
        "A reading list where a book can be marked ",
        bold("abandoned"),
        " without guilt, and the app asks one question: what made you stop?",
      ),
      p("Over a year that's a better map of taste than the finished pile."),
    ),
  },

  // The long one — proves the app handles real writing, and gives the list a card
  // with enough body to show truncation working properly.
  {
    title: "What I actually want from a notes app",
    content: doc(
      p(
        "Written after migrating for the third time, mostly so I stop re-deciding this every eighteen months.",
      ),
      heading(3, "The non-negotiable"),
      p(
        "It has to still open in ten years. That rules out anything where the notes live somewhere I can't reach without permission, which, it turns out, is most of them.",
      ),
      heading(3, "What I thought I wanted, but didn't"),
      bullet(
        "Backlinks everywhere. Used them for a month, built a beautiful graph, never opened it again.",
        "Perfect tagging. Six tags do the work; the other forty were procrastination wearing a productivity hat.",
        "Sync to everything. I write on two devices. Two.",
      ),
      heading(3, "What I did want"),
      p(
        "Fast search, because the filing system I'll actually maintain is no filing system. Somewhere private for the handful of notes that genuinely are. And a list that looks like mine after a week, not a demo.",
      ),
      p("Everything else was shopping."),
    ),
  },
];
