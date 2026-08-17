// Turning other apps' files into Lockpad notes.
//
// Four formats, each with its own idea of what a note is:
//   CSV   — a table, one note per row. Column names are matched loosely, since
//           every exporter names them differently.
//   JSON  — a Lockpad export, round-tripping folders, tags and dates exactly.
//   HTML  — a Google Keep or Evernote dump, where the structure has to be
//           recovered from the markup.
//   MD/TXT— one note per file, the filename becoming the title.
//
// Everything here is PURE: text in, ParsedNote out. No database, no network, no
// filesystem. That is what lets these be unit-tested directly, and it is what makes
// the preview trustworthy — the preview runs this exact code, so what it shows is
// what the commit will produce, not an approximation of it.
//
// Nothing is fetched. A note that references an image or a link is imported with
// that reference as text; the server never follows it.
import { parse as parseCsv } from "csv-parse/sync";
import { marked, type Tokens } from "marked";
import { parse as parseHtml, type HTMLElement, type Node as HtmlNode } from "node-html-parser";
import { docFromPlainText, emptyDoc, type TipTapNode } from "./tiptap.js";

export interface ParsedNote {
  title: string;
  content: TipTapNode;
  tags: string[];
  folderPath: string | null;
  // When known (e.g. a date in an imported title), the note's creation date.
  createdAt?: Date;
}

// Recover a note's real date from its title.
//
// Exports from other apps routinely lose the original creation date and bake it
// into the filename or heading instead ("Shopping list 28/06/2020"). Without this
// every imported note would arrive dated today, and a decade of notes would land in
// one undifferentiated heap at the top of the list.
//
// Read as DAY-FIRST (28/06/2020), matching the source locale, and only re-read as
// month-first when the numbers make day-first impossible (a first number above 12).
// Genuinely ambiguous dates like 05/06 stay day-first — a guess has to be made, and
// consistency is worth more than being right half the time by accident.
export function extractTitleDate(title: string): { title: string; date: Date } | null {
  const m = title.match(/(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2,4})/);
  if (!m) return null;
  let day = parseInt(m[1], 10);
  let month = parseInt(m[2], 10);
  let year = parseInt(m[3], 10);
  if (m[3].length === 2) year += 2000;
  if (month > 12 && day <= 12) [day, month] = [month, day]; // was M/D
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const date = new Date(Date.UTC(year, month - 1, day));
  if (Number.isNaN(date.getTime())) return null;

  // Remove the date and any trailing separators/whitespace left behind.
  const cleaned = title
    .replace(m[0], "")
    .replace(/\s{2,}/g, " ")
    .replace(/[\s:–—-]+$/u, "")
    .trim();
  return { title: cleaned, date };
}

/** Convert a Markdown string into a TipTap document JSON. */
export function markdownToTipTap(md: string): TipTapNode {
  const tokens = marked.lexer(md);
  const content: TipTapNode[] = [];

  const inline = (text: string): TipTapNode[] => {
    // Parse inline marks (bold/italic/links/code) from a token's raw text.
    const nodes: TipTapNode[] = [];
    const inlineTokens = marked.lexer(text)[0];
    const walk = (toks: Tokens.Generic[]) => {
      for (const t of toks) {
        if (t.type === "text" || t.type === "escape") {
          nodes.push({ type: "text", text: (t as Tokens.Text).text });
        } else if (t.type === "strong") {
          nodes.push({ type: "text", marks: [{ type: "bold" }], text: (t as Tokens.Strong).text });
        } else if (t.type === "em") {
          nodes.push({ type: "text", marks: [{ type: "italic" }], text: (t as Tokens.Em).text });
        } else if (t.type === "codespan") {
          nodes.push({ type: "text", marks: [{ type: "code" }], text: (t as Tokens.Codespan).text });
        } else if (t.type === "link") {
          const lt = t as Tokens.Link;
          nodes.push({ type: "text", marks: [{ type: "link", attrs: { href: lt.href } }], text: lt.text });
        } else if ("tokens" in t && Array.isArray((t as Tokens.Generic).tokens)) {
          walk((t as Tokens.Generic).tokens as Tokens.Generic[]);
        } else if ("text" in t) {
          nodes.push({ type: "text", text: (t as Tokens.Text).text });
        }
      }
    };
    if (inlineTokens && "tokens" in inlineTokens && inlineTokens.tokens) {
      walk(inlineTokens.tokens as Tokens.Generic[]);
    } else {
      nodes.push({ type: "text", text });
    }
    return nodes.length ? nodes : [{ type: "text", text }];
  };

  for (const token of tokens) {
    if (token.type === "heading") {
      const h = token as Tokens.Heading;
      content.push({ type: "heading", attrs: { level: Math.min(h.depth, 3) }, content: inline(h.text) });
    } else if (token.type === "paragraph") {
      content.push({ type: "paragraph", content: inline((token as Tokens.Paragraph).text) });
    } else if (token.type === "list") {
      const list = token as Tokens.List;
      content.push({
        type: list.ordered ? "orderedList" : "bulletList",
        content: list.items.map((item) => ({
          type: "listItem",
          content: [{ type: "paragraph", content: inline(item.text) }],
        })),
      });
    } else if (token.type === "blockquote") {
      content.push({ type: "blockquote", content: [{ type: "paragraph", content: inline((token as Tokens.Blockquote).text) }] });
    } else if (token.type === "code") {
      content.push({ type: "codeBlock", content: [{ type: "text", text: (token as Tokens.Code).text }] });
    }
  }

  return { type: "doc", content: content.length ? content : [{ type: "paragraph" }] };
}

/** Parse a single .md/.txt file into a ParsedNote. */
export function parseTextFile(filename: string, contents: string): ParsedNote {
  const base = filename.replace(/\.[^.]+$/, "");
  const isMarkdown = /\.md$/i.test(filename) || /\.markdown$/i.test(filename);
  return {
    title: base || "Untitled",
    content: isMarkdown ? markdownToTipTap(contents) : docFromPlainText(contents),
    tags: [],
    folderPath: null,
  };
}

/** Parse a CSV buffer with columns: title, content, tags, folder. */
export function parseCsvFile(buffer: string): ParsedNote[] {
  const records = parseCsv(buffer, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
  }) as Record<string, string>[];

  return records.map((row) => {
    const title = (row.title ?? "").trim() || "Untitled";
    const rawContent = row.content ?? "";
    const tags = (row.tags ?? "")
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean);
    const folderPath = (row.folder ?? "").trim() || null;
    return {
      title,
      // CSV content is treated as Markdown so headings/lists survive if present.
      content: markdownToTipTap(rawContent),
      tags,
      folderPath,
    };
  });
}

// ── HTML import ───────────────────────────────────────────────────────────────
// Convert HTML into TipTap JSON by walking a whitelist of tags. Because we only
// emit known TipTap nodes/marks (never raw HTML), nothing executes and no unsafe
// markup is stored — script/style content is dropped outright.

const INLINE_MARK: Record<string, { type: string; attrs?: (el: HTMLElement) => Record<string, unknown> }> = {
  strong: { type: "bold" },
  b: { type: "bold" },
  em: { type: "italic" },
  i: { type: "italic" },
  code: { type: "code" },
  a: { type: "link", attrs: (el) => ({ href: el.getAttribute("href") ?? "" }) },
};

function isElement(node: HtmlNode): node is HTMLElement {
  return (node as HTMLElement).tagName !== undefined && (node as HTMLElement).tagName !== null;
}

// Collect inline text nodes with their accumulated marks.
function inlineFromHtml(node: HtmlNode, marks: unknown[] = []): TipTapNode[] {
  const out: TipTapNode[] = [];
  const children = (node as HTMLElement).childNodes ?? [];
  for (const child of children) {
    if (!isElement(child)) {
      const text = (child.rawText ?? "").replace(/\s+/g, " ");
      if (text) out.push(marks.length ? { type: "text", marks: [...marks], text } : { type: "text", text });
      continue;
    }
    const tag = child.tagName.toLowerCase();
    if (tag === "br") { out.push({ type: "text", text: "\n" }); continue; }
    if (tag === "script" || tag === "style") continue;
    const mark = INLINE_MARK[tag];
    const nextMarks = mark ? [...marks, mark.attrs ? { type: mark.type, attrs: mark.attrs(child) } : { type: mark.type }] : marks;
    out.push(...inlineFromHtml(child, nextMarks));
  }
  return out;
}

/** Convert an HTML string into a TipTap document JSON. */
export function htmlToTipTap(html: string): TipTapNode {
  const root = parseHtml(html, { blockTextElements: { script: false, style: false, noscript: false } });
  const content: TipTapNode[] = [];

  const pushBlocks = (parent: HTMLElement) => {
    for (const node of parent.childNodes) {
      if (!isElement(node)) {
        const text = (node.rawText ?? "").trim();
        if (text) content.push({ type: "paragraph", content: [{ type: "text", text }] });
        continue;
      }
      const tag = node.tagName.toLowerCase();
      switch (tag) {
        case "h1": case "h2": case "h3": case "h4": case "h5": case "h6": {
          const level = Math.min(Number(tag[1]), 3);
          content.push({ type: "heading", attrs: { level }, content: inlineFromHtml(node) });
          break;
        }
        case "p":
          content.push({ type: "paragraph", content: inlineFromHtml(node) });
          break;
        case "ul": case "ol":
          content.push({
            type: tag === "ol" ? "orderedList" : "bulletList",
            content: node.querySelectorAll("li").map((li) => ({
              type: "listItem",
              content: [{ type: "paragraph", content: inlineFromHtml(li) }],
            })),
          });
          break;
        case "blockquote":
          content.push({ type: "blockquote", content: [{ type: "paragraph", content: inlineFromHtml(node) }] });
          break;
        case "pre": case "code":
          content.push({ type: "codeBlock", content: [{ type: "text", text: node.text }] });
          break;
        case "script": case "style": case "noscript":
        case "head": case "title": case "meta": case "link": case "base":
          // Non-content / metadata: skip entirely.
          break;
        case "html": case "body": case "div": case "section": case "article": case "main": case "header": case "footer":
          // Structural wrappers: recurse into them.
          pushBlocks(node);
          break;
        default: {
          // Fallback: any other element with text becomes a paragraph.
          const inline = inlineFromHtml(node);
          if (inline.some((n) => (n.text ?? "").trim())) content.push({ type: "paragraph", content: inline });
        }
      }
    }
  };

  pushBlocks(root);
  return { type: "doc", content: content.length ? content : [{ type: "paragraph" }] };
}

/** Parse a single .html/.htm file into a ParsedNote (title from <title> or filename). */
export function parseHtmlFile(filename: string, contents: string): ParsedNote {
  const root = parseHtml(contents);
  const titleTag = root.querySelector("title")?.text?.trim();
  const h1 = root.querySelector("h1")?.text?.trim();
  const base = filename.replace(/\.[^.]+$/, "");
  return {
    title: titleTag || h1 || base || "Untitled",
    content: htmlToTipTap(contents),
    tags: [],
    folderPath: null,
  };
}

// ── JSON import ───────────────────────────────────────────────────────────────
// Flexible JSON import. Accepts:
//   • an array of note objects: [{ title, content, tags, folder }, …]
//   • a wrapper object: { notes: [ … ] }
//   • a single note object: { title, content, tags, folder }
//   • a raw TipTap document: { type: "doc", content: [ … ] }
// `content` may be a string (treated as Markdown) or a TipTap document object.
// Google Keep exports are supported: `textContent`/`textContentHtml` for text
// notes and `listContent` (`[{ text, isChecked }]`) for checklist notes.

function looksLikeTipTapDoc(v: unknown): v is TipTapNode {
  return !!v && typeof v === "object" && (v as TipTapNode).type === "doc" && Array.isArray((v as TipTapNode).content);
}

// Collect tags from `tags` (array or comma string) and Google Keep `labels`
// (`[{ name }]`), de-duplicated.
function collectTags(item: Record<string, unknown>): string[] {
  const tags: string[] = [];
  const rawTags = item.tags;
  if (Array.isArray(rawTags)) tags.push(...rawTags.map((t) => String(t).trim()));
  else if (typeof rawTags === "string") tags.push(...rawTags.split(",").map((t) => t.trim()));

  if (Array.isArray(item.labels)) {
    for (const l of item.labels) {
      const name = typeof l === "string" ? l : l && typeof l === "object" ? (l as { name?: unknown }).name : undefined;
      if (typeof name === "string" && name.trim()) tags.push(name.trim());
    }
  }
  return [...new Set(tags.filter(Boolean))];
}

// Google Keep checklist notes store their body as `listContent` — an array of
// `{ text, isChecked }` items — and carry no `textContent`. Convert it to a
// TipTap taskList so both the items and their checked state survive the import.
// Returns null when there's nothing usable, so the caller can fall through.
function keepListToTaskList(list: unknown): TipTapNode | null {
  if (!Array.isArray(list)) return null;
  const items: TipTapNode[] = list
    .filter((it): it is Record<string, unknown> => !!it && typeof it === "object")
    .map((it) => {
      const text = typeof it.text === "string" ? it.text : "";
      return {
        type: "taskItem",
        attrs: { checked: it.isChecked === true },
        content: [text ? { type: "paragraph", content: [{ type: "text", text }] } : { type: "paragraph" }],
      };
    });
  if (!items.length) return null;
  return { type: "doc", content: [{ type: "taskList", content: items }] };
}

function jsonItemToNote(item: Record<string, unknown>, fallbackTitle: string): ParsedNote {
  // Body detection, in priority order:
  //   1. `content`/`body`/`text` as a TipTap doc or a Markdown/plain string
  //   2. Google Keep `textContent` (plain text, \n-separated) — used as-is so the
  //      "." spacer lines aren't reinterpreted as Markdown
  //   3. Google Keep `textContentHtml` (rich)
  //   4. Google Keep `listContent` (checklist notes have no textContent) → taskList
  const rawContent = item.content ?? item.body ?? item.text;
  const keepList = keepListToTaskList(item.listContent);
  let content: TipTapNode;
  if (looksLikeTipTapDoc(rawContent)) content = rawContent;
  else if (typeof rawContent === "string") content = markdownToTipTap(rawContent);
  else if (typeof item.textContent === "string" && item.textContent.trim()) content = docFromPlainText(item.textContent);
  else if (typeof item.textContentHtml === "string" && item.textContentHtml.trim()) content = htmlToTipTap(item.textContentHtml);
  else if (keepList) content = keepList;
  else content = emptyDoc();

  const folderRaw = item.folder ?? item.folderPath;
  const folderPath = typeof folderRaw === "string" && folderRaw.trim() ? folderRaw.trim() : null;

  // Title + creation date: a date embedded in the title is stripped out and used
  // as the note's creation date; otherwise fall back to Google Keep's
  // `createdTimestampUsec` (microseconds since epoch) when present.
  const rawTitle = (typeof item.title === "string" && item.title.trim()) || fallbackTitle;
  const fromTitle = extractTitleDate(rawTitle);
  let createdAt: Date | undefined = fromTitle?.date;
  if (!createdAt && typeof item.createdTimestampUsec === "number") {
    const d = new Date(Math.round(item.createdTimestampUsec / 1000));
    if (!Number.isNaN(d.getTime())) createdAt = d;
  }

  return {
    title: (fromTitle?.title || rawTitle) || fallbackTitle,
    content,
    tags: collectTags(item),
    folderPath,
    createdAt,
  };
}

/** Parse a .json file into one or more ParsedNotes. */
export function parseJsonFile(filename: string, contents: string): ParsedNote[] {
  const base = filename.replace(/\.[^.]+$/, "") || "Untitled";
  let data: unknown;
  try {
    data = JSON.parse(contents);
  } catch {
    throw new Error(`Invalid JSON in ${filename}`);
  }

  // A raw TipTap document → a single note titled from the filename.
  if (looksLikeTipTapDoc(data)) {
    return [{ title: base, content: data, tags: [], folderPath: null }];
  }
  // A wrapper { notes: [...] }.
  if (data && typeof data === "object" && Array.isArray((data as { notes?: unknown[] }).notes)) {
    data = (data as { notes: unknown[] }).notes;
  }
  if (Array.isArray(data)) {
    return data.map((item, i) =>
      item && typeof item === "object"
        ? jsonItemToNote(item as Record<string, unknown>, `${base} ${i + 1}`)
        : { title: `${base} ${i + 1}`, content: docFromPlainText(String(item)), tags: [], folderPath: null }
    );
  }
  if (data && typeof data === "object") {
    return [jsonItemToNote(data as Record<string, unknown>, base)];
  }
  // Primitive JSON (string/number) → one note with that as the body.
  return [{ title: base, content: docFromPlainText(String(data)), tags: [], folderPath: null }];
}
