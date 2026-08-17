import { Node, mergeAttributes } from "@tiptap/core";
import type { DOMOutputSpec } from "@tiptap/pm/model";
import { ReactNodeViewRenderer } from "@tiptap/react";
import { SmartLinkView } from "./SmartLinkView";
import { providerById } from "@/lib/smartLinkProviders";
import { BRAND_ICONS } from "@/lib/smartLinkIconData";

// Compact form of the URL for the card's secondary line (mirrors SmartLinkView):
// drop the scheme, a leading www., and a trailing slash.
function displayUrl(raw: string): string {
  return raw.replace(/^[a-z][a-z0-9+.-]*:\/\//i, "").replace(/^www\./i, "").replace(/\/$/, "");
}

// Neutral link glyph (lucide "link-2"), used when a provider has no bundled brand mark.
const FALLBACK_ICON: DOMOutputSpec = [
  "svg",
  { viewBox: "0 0 24 24", width: "20", height: "20", fill: "none", stroke: "currentColor", "stroke-width": "2", "stroke-linecap": "round", "stroke-linejoin": "round", "aria-hidden": "true" },
  ["path", { d: "M9 17H7A5 5 0 0 1 7 7h2" }],
  ["path", { d: "M15 7h2a5 5 0 1 1 0 10h-2" }],
  ["line", { x1: "8", x2: "16", y1: "12", y2: "12" }],
];

// Smart-link block (prd-smart-link-blocks.md): a URL matching a recognized provider
// renders as a styled card (icon + label + URL) instead of a plain link. It's a plain
// atom BLOCK node, so it participates in existing block behaviours for free — the app's
// gutter drag-handle drags it, JSON export stores its attrs verbatim, and locked-note
// encryption covers it like any content. Everything shown is derived from the stored
// URL string; nothing is ever fetched.
//
// parseHTML/renderHTML give it a graceful <a href> representation for clipboard HTML and
// any HTML round-trip; the app's own Markdown/HTML exporters have dedicated cases.

export const SmartLink = Node.create({
  name: "smartLink",
  group: "block",
  atom: true,
  selectable: true,
  draggable: true,

  addAttributes() {
    return {
      url: { default: "" },
      provider: { default: "" }, // provider id (see smartLinkProviders); "" → generic
    };
  },

  parseHTML() {
    return [
      {
        tag: "a[data-smart-link]",
        getAttrs: (el) => ({
          url: (el as HTMLElement).getAttribute("href") || (el as HTMLElement).getAttribute("data-url") || "",
          provider: (el as HTMLElement).getAttribute("data-provider") || "",
        }),
      },
    ];
  },

  // Static card markup — used for clipboard HTML and for the note-list preview
  // (NotePreview runs the doc through this via generateHTML, since ReactNodeView
  // renderers only apply inside a live editor). Structure + classes mirror
  // SmartLinkView so the same CSS styles both; nothing here is fetched — the icon
  // is a bundled path and the text is the stored URL string.
  renderHTML({ HTMLAttributes }) {
    const url = String(HTMLAttributes.url ?? "");
    const providerId = String(HTMLAttributes.provider ?? "");
    const provider = providerById(providerId);
    const brand = provider?.icon ? BRAND_ICONS[provider.icon] : undefined;
    const label = provider?.label ?? "Link";
    const icon: DOMOutputSpec = brand
      ? ["svg", { viewBox: "0 0 24 24", width: "20", height: "20", fill: "currentColor", "aria-hidden": "true" }, ["path", { d: brand.path }]]
      : FALLBACK_ICON;
    return [
      "a",
      mergeAttributes({
        "data-smart-link": "",
        "data-provider": providerId,
        href: url,
        target: "_blank",
        rel: "noopener noreferrer nofollow",
        class: "smart-link-card smart-link-static",
      }),
      ["span", { class: "smart-link-icon", "aria-hidden": "true" }, icon],
      ["span", { class: "smart-link-text" }, ["span", { class: "smart-link-label" }, label], ["span", { class: "smart-link-url" }, displayUrl(url)]],
    ];
  },

  addNodeView() {
    return ReactNodeViewRenderer(SmartLinkView);
  },
});
