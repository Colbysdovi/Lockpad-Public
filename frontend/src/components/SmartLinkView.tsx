import { NodeViewWrapper, type NodeViewProps } from "@tiptap/react";
import { X, Link2 } from "@/components/icons";
import { providerById, parseUrl } from "@/lib/smartLinkProviders";
import { BRAND_ICONS } from "@/lib/smartLinkIconData";
import { Tooltip } from "@/components/ui/tooltip";

// Compact, readable form of the URL for the card's secondary line: drop the scheme,
// a leading www., and any trailing slash; long paths are ellipsised by CSS.
function displayUrl(raw: string): string {
  return raw.replace(/^[a-z][a-z0-9+.-]*:\/\//i, "").replace(/^www\./i, "").replace(/\/$/, "");
}

// The clickable target: whatever was pasted, guaranteed a scheme so window.open works.
function openHref(raw: string): string {
  return /^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`;
}

/**
 * How a smart link looks inside the editor: a bordered card with the service's
 * brand icon, its name, and a tidied-up URL — rather than a raw string of
 * characters.
 *
 * Nothing is fetched to build this. The provider is recognised by matching the URL
 * against local patterns (lib/smartLinkProviders.ts) and the icon comes from a
 * bundled set, so no request ever leaves the browser to Figma, GitHub or anyone
 * else. That matters: a link preview that phones out would tell a third party which
 * links are in your private notes, which is exactly the thing this app promises not
 * to do.
 *
 * Rendered as a TipTap NodeView, so it behaves as a single block in the document —
 * selectable, deletable, draggable — instead of a run of styled text.
 */
export function SmartLinkView({ node, editor, deleteNode }: NodeViewProps) {
  const url = String(node.attrs.url ?? "");
  const provider = providerById(String(node.attrs.provider ?? ""));
  const brand = provider?.icon ? BRAND_ICONS[provider.icon] : undefined;
  const label = provider?.label ?? "Link";
  const href = openHref(url);
  const valid = !!parseUrl(url);

  return (
    <NodeViewWrapper className="smart-link" contentEditable={false} draggable={false}>
      <div className="smart-link-card">
        <a
          href={valid ? href : undefined}
          target="_blank"
          rel="noopener noreferrer nofollow"
          className="smart-link-main"
          // Open explicitly so the click can't drop the caret into the atom; the
          // editor's own handleClick would also open it, this just makes it robust.
          onClick={(e) => {
            if (!valid) return;
            e.preventDefault();
            e.stopPropagation();
            window.open(href, "_blank", "noopener,noreferrer");
          }}
        >
          <span className="smart-link-icon" aria-hidden>
            {brand ? (
              <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor" role="img" aria-label={`${label} icon`}>
                <path d={brand.path} />
              </svg>
            ) : (
              <Link2 className="h-5 w-5" />
            )}
          </span>
          <span className="smart-link-text">
            <span className="smart-link-label">{label}</span>
            <span className="smart-link-url">{displayUrl(url)}</span>
          </span>
        </a>
        {editor.isEditable && (
          // Remove affordance — keeps a converted block from ever being "stuck": editing
          // a link = remove it and paste the new one (re-evaluated against the patterns).
          <Tooltip label="Remove this link block">
            <button
              type="button"
              className="smart-link-remove"
              aria-label="Remove this link block"
              onClick={(e) => { e.preventDefault(); e.stopPropagation(); deleteNode(); }}
            >
              <X className="h-4 w-4" />
            </button>
          </Tooltip>
        )}
      </div>
    </NodeViewWrapper>
  );
}
