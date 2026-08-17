// TipTap/ProseMirror document → self-contained, escaped HTML for the PDF print view.
//
// Hand-rolled (like the Markdown serializer) so print output is SYNCHRONOUS and
// deterministic — no live editor to wait on, no async font/render races before
// window.print(). Every text value is HTML-escaped, so note content can never inject
// markup into the print portal. The emitted structure carries the class hooks the
// `.note-print` print stylesheet targets (task lists, code blocks, etc.).

import { providerById } from "./smartLinkProviders";

interface HtmlNode {
  type?: string;
  text?: string;
  content?: HtmlNode[];
  attrs?: Record<string, unknown>;
  marks?: { type: string; attrs?: Record<string, unknown> }[];
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// Only allow benign link schemes in the printed anchor; anything else (javascript:,
// data:, …) drops the href and renders as plain text so nothing executable lands in
// the live print portal.
function safeHref(href: string): string | null {
  const trimmed = href.trim();
  if (/^(https?:|mailto:|tel:|\/|#)/i.test(trimmed)) return trimmed;
  return null;
}

function renderText(node: HtmlNode): string {
  const marks = node.marks ?? [];
  const has = (t: string) => marks.some((m) => m.type === t);
  let out = escapeHtml(node.text ?? "");

  if (has("code")) out = `<code>${out}</code>`;
  else {
    if (has("bold")) out = `<strong>${out}</strong>`;
    if (has("italic")) out = `<em>${out}</em>`;
    if (has("strike")) out = `<s>${out}</s>`;
  }
  // The highlight's colour rides along as a data attribute, matching what the editor
  // renders, so the print stylesheet can tint it. The value is taken from a fixed
  // allowlist rather than interpolated from the document, so note content can never
  // inject an attribute value into the live print portal.
  const hl = marks.find((m) => m.type === "highlight");
  if (hl) {
    const raw = typeof hl.attrs?.color === "string" ? hl.attrs.color : "";
    const color = ["amber", "green", "blue", "pink", "purple"].includes(raw) ? raw : "amber";
    out = `<mark data-color="${color}">${out}</mark>`;
  }
  const link = marks.find((m) => m.type === "link");
  const href = typeof link?.attrs?.href === "string" ? safeHref(link.attrs.href) : null;
  if (href) out = `<a href="${escapeHtml(href)}">${out}</a>`;
  return out;
}

function renderInline(nodes: HtmlNode[] | undefined): string {
  if (!nodes) return "";
  return nodes
    .map((n) => (n.type === "hardBreak" ? "<br>" : typeof n.text === "string" ? renderText(n) : ""))
    .join("");
}

function renderListItems(node: HtmlNode): string {
  return (node.content ?? [])
    .map((item) => {
      if (node.type === "taskList") {
        const checked = item.attrs?.checked === true;
        return `<li data-checked="${checked}"><span class="task-box" aria-hidden="true"></span><div>${renderBlocks(item.content)}</div></li>`;
      }
      return `<li>${renderBlocks(item.content)}</li>`;
    })
    .join("");
}

function renderBlock(node: HtmlNode): string {
  switch (node.type) {
    case "paragraph": {
      const inner = renderInline(node.content);
      return `<p>${inner || "<br>"}</p>`;
    }
    case "heading": {
      const level = Math.min(Math.max(Number(node.attrs?.level ?? 1), 1), 6);
      return `<h${level}>${renderInline(node.content)}</h${level}>`;
    }
    case "codeBlock": {
      const code = escapeHtml((node.content ?? []).map((c) => c.text ?? "").join(""));
      return `<pre><code>${code}</code></pre>`;
    }
    case "blockquote":
      return `<blockquote>${renderBlocks(node.content)}</blockquote>`;
    case "horizontalRule":
      return "<hr>";
    case "image": {
      // Same-origin only (the src pattern is enforced when the node is created), so
      // printing never reaches out to another host. The description carries through
      // as the alt text; both values are escaped before they touch the portal.
      const src = typeof node.attrs?.src === "string" ? node.attrs.src : "";
      const alt = typeof node.attrs?.alt === "string" ? node.attrs.alt : "";
      if (!src || !/^(\/api\/images\/|data:image\/)/i.test(src)) return "";
      const img = `<img src="${escapeHtml(src)}" alt="${escapeHtml(alt)}">`;
      // Printed as a captioned figure, matching what the editor shows. Without a
      // description it stays a bare image rather than gaining an empty caption line.
      return alt
        ? `<figure class="note-image-figure">${img}<figcaption>${escapeHtml(alt)}</figcaption></figure>`
        : img;
    }
    case "smartLink": {
      // Printed as an ordinary link (label → stored URL). Nothing fetched.
      const raw = typeof node.attrs?.url === "string" ? node.attrs.url : "";
      const url = /^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`;
      const provider = providerById(typeof node.attrs?.provider === "string" ? node.attrs.provider : "");
      const label = escapeHtml(provider?.label ?? "Link");
      const href = raw ? safeHref(url) : null;
      return href ? `<p><a href="${escapeHtml(href)}">${label}</a></p>` : `<p>${label}</p>`;
    }
    case "noteLink": {
      // Printed (and exported to HTML) as the referenced note's name in double
      // brackets, matching the Markdown export. NOT as a link: the only URL that
      // would resolve is one on this private, self-hosted instance, and a printed
      // page carrying a hyperlink nobody else can follow is worse than plain text.
      const title = typeof node.attrs?.title === "string" ? node.attrs.title.trim() : "";
      return `<span class="note-link-print">[[${escapeHtml(title || "Untitled")}]]</span>`;
    }
    case "bulletList":
      return `<ul>${renderListItems(node)}</ul>`;
    case "orderedList": {
      const start = typeof node.attrs?.start === "number" ? node.attrs.start : 1;
      return `<ol${start !== 1 ? ` start="${start}"` : ""}>${renderListItems(node)}</ol>`;
    }
    case "taskList":
      return `<ul class="task-list" data-type="taskList">${renderListItems(node)}</ul>`;
    default:
      // Unknown/future block: emit whatever inline text it carries so nothing is lost.
      return node.content ? `<p>${renderInline(node.content)}</p>` : "";
  }
}

function renderBlocks(nodes: HtmlNode[] | undefined): string {
  if (!nodes) return "";
  return nodes.map(renderBlock).join("");
}

/** Serialize a TipTap document to escaped, print-ready HTML. */
export function tiptapToHtml(doc: unknown): string {
  const root = doc as HtmlNode | undefined;
  if (!root || typeof root !== "object") return "";
  const content = Array.isArray(root.content) ? root.content : Array.isArray(root) ? (root as HtmlNode[]) : undefined;
  return renderBlocks(content);
}
