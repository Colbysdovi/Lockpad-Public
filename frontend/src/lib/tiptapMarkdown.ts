// TipTap/ProseMirror document → Markdown serializer.
//
// Hand-rolled (no runtime dependency, per the export PRD) because the app's node
// and mark set is small and fixed: StarterKit (paragraph, heading 1–3, bullet/
// ordered lists, blockquote, horizontalRule, hardBreak; marks bold/italic/strike/
// code, highlight) + TaskList/TaskItem + Link + the lowlight codeBlock. New block
// types added to the editor later just need a `case` here.
//
// Mirrors the document-walking style of `tiptap.ts` rather than pulling in a second
// ProseMirror stack.

import { providerById } from "./smartLinkProviders";
import { tOutsideReact } from "@/lib/i18n";

interface MdNode {
  type?: string;
  text?: string;
  content?: MdNode[];
  attrs?: Record<string, unknown>;
  marks?: { type: string; attrs?: Record<string, unknown> }[];
}

// Backslash-escape the Markdown metacharacters that trigger inline formatting
// *anywhere* in a line: backslash, backtick, emphasis markers, and link brackets.
// Block-level markers (#, -, +, >) are intentionally NOT escaped — they only matter
// at the very start of a line, and escaping them mid-text produces noisy output like
// "Self\-hosted". The rare paragraph that literally begins with "- " is an accepted
// trade-off for clean, readable files.
function escapeText(text: string): string {
  return text.replace(/([\\`*_[\]])/g, "\\$1");
}

// A text node with its marks applied. Code spans are literal (Markdown ignores any
// emphasis inside them), so `code` short-circuits the emphasis marks; a link always
// wraps outermost so its label can itself be emphasized.
function renderText(node: MdNode): string {
  const raw = node.text ?? "";
  const marks = node.marks ?? [];
  const has = (t: string) => marks.some((m) => m.type === t);

  let out: string;
  if (has("code")) {
    // Pad + widen the fence if the content itself contains backticks.
    const ticks = raw.includes("`") ? "``" : "`";
    const pad = raw.startsWith("`") || raw.endsWith("`") ? " " : "";
    out = `${ticks}${pad}${raw}${pad}${ticks}`;
  } else {
    out = escapeText(raw);
    if (has("bold")) out = `**${out}**`;
    if (has("italic")) out = `*${out}*`;
    if (has("strike")) out = `~~${out}~~`;
    // `==highlighted==` — the de-facto Markdown extension for a highlight, understood
    // by Obsidian, Bear and the CommonMark "mark" extension. The colour is NOT
    // written out: Markdown has no vocabulary for it, and inventing one would produce
    // a file that only Lockpad could read back. The emphasis survives; the shade does
    // not. That is the right trade for a format whose whole value is that everything
    // else can open it.
    if (has("highlight")) out = `==${out}==`;
  }

  const link = marks.find((m) => m.type === "link");
  const href = link?.attrs?.href;
  if (typeof href === "string" && href) out = `[${out}](${href})`;
  return out;
}

// Inline children (text + hardBreak) of a block, concatenated. A hard break becomes
// a Markdown hard line break (two trailing spaces).
function renderInline(nodes: MdNode[] | undefined): string {
  if (!nodes) return "";
  let out = "";
  for (const n of nodes) {
    if (n.type === "hardBreak") out += "  \n";
    else if (typeof n.text === "string") out += renderText(n);
  }
  return out;
}

const LIST_TYPES = new Set(["bulletList", "orderedList", "taskList"]);

// A list → an array of Markdown lines. Recurses for nested lists, indenting each
// level under its parent item's marker so tight, nested checklists survive.
function renderList(node: MdNode, depth: number): string[] {
  const lines: string[] = [];
  const ordered = node.type === "orderedList";
  const start = ordered && typeof node.attrs?.start === "number" ? (node.attrs!.start as number) : 1;
  const pad = "  ".repeat(depth);
  const items = node.content ?? [];

  items.forEach((item, i) => {
    const marker =
      node.type === "taskList"
        ? item.attrs?.checked === true
          ? "- [x] "
          : "- [ ] "
        : ordered
          ? `${start + i}. `
          : "- ";
    const contIndent = pad + " ".repeat(marker.length);
    const blocks = item.content ?? [];
    let firstDone = false;

    for (const block of blocks) {
      if (LIST_TYPES.has(block.type ?? "")) {
        lines.push(...renderList(block, depth + 1));
        continue;
      }
      const rendered = renderBlock(block);
      const blockLines = rendered.split("\n");
      blockLines.forEach((ln, idx) => {
        if (!firstDone && idx === 0) {
          lines.push(pad + marker + ln);
          firstDone = true;
        } else {
          lines.push(ln ? contIndent + ln : "");
        }
      });
    }
    // An empty item (e.g. a bare, unchecked checkbox) still deserves its marker.
    if (!firstDone) lines.push((pad + marker).replace(/\s+$/, ""));
  });

  return lines;
}

// A single block node → a Markdown string (may span multiple lines).
function renderBlock(node: MdNode): string {
  switch (node.type) {
    case "paragraph":
      return renderInline(node.content);
    case "heading": {
      const level = Math.min(Math.max(Number(node.attrs?.level ?? 1), 1), 6);
      return `${"#".repeat(level)} ${renderInline(node.content)}`;
    }
    case "codeBlock": {
      const lang = typeof node.attrs?.language === "string" ? node.attrs.language : "";
      // Code content is literal text (no marks); newlines are real newlines.
      const code = (node.content ?? []).map((c) => c.text ?? "").join("");
      return `\`\`\`${lang}\n${code}\n\`\`\``;
    }
    case "blockquote": {
      const inner = renderBlocks(node.content);
      return inner
        .split("\n")
        .map((ln) => (ln ? `> ${ln}` : ">"))
        .join("\n");
    }
    case "horizontalRule":
      return "---";
    case "image": {
      // `![description](src)`. By export time the src is usually already a data URI
      // (noteExport inlines them first) so the file stands alone; a src left as a
      // server path means that image could not be read, and the reference is kept
      // rather than dropped so nothing about the note goes silently missing.
      const src = typeof node.attrs?.src === "string" ? node.attrs.src : "";
      const alt = typeof node.attrs?.alt === "string" ? node.attrs.alt : "";
      return src ? `![${alt.replace(/[[\]]/g, "")}](${src})` : "";
    }
    case "smartLink": {
      // Export as an ordinary Markdown link — [Provider](url) — from the stored URL +
      // provider label (prd-note-export.md). No fetch, no special syntax.
      const url = typeof node.attrs?.url === "string" ? node.attrs.url : "";
      const provider = providerById(typeof node.attrs?.provider === "string" ? node.attrs.provider : "");
      return url ? `[${provider?.label ?? "Link"}](${url})` : "";
    }
    case "noteLink": {
      // A reference to another note, exported as its title in double brackets —
      // [[Title]]. There is no URL that would mean anything outside this library, so
      // the honest export is the thing a reader can act on: the note's name, in the
      // same syntax that creates the link in the first place. The stored snapshot is
      // all an exporter has; it never has a note to resolve against.
      const title = typeof node.attrs?.title === "string" ? node.attrs.title.trim() : "";
      return `[[${title || tOutsideReact("note.untitled")}]]`;
    }
    case "bulletList":
    case "orderedList":
    case "taskList":
      return renderList(node, 0).join("\n");
    default:
      // Unknown/future block: fall back to whatever inline text it carries so no
      // content is silently lost.
      return renderInline(node.content);
  }
}

// Top-level blocks joined by a blank line. Collapses runs of blank lines so stacked
// spacer paragraphs don't produce a wall of whitespace.
function renderBlocks(nodes: MdNode[] | undefined): string {
  if (!nodes) return "";
  return nodes
    .map(renderBlock)
    .join("\n\n")
    .replace(/\n{3,}/g, "\n\n");
}

/** Serialize a TipTap document (its top-level `doc` node, or its content array) to
 *  Markdown. Returns a trimmed string with a single trailing newline elsewhere added
 *  by the caller. */
export function tiptapToMarkdown(doc: unknown): string {
  const root = doc as MdNode | undefined;
  if (!root || typeof root !== "object") return "";
  const content = Array.isArray(root.content) ? root.content : Array.isArray(root) ? (root as MdNode[]) : undefined;
  return renderBlocks(content).trim();
}
