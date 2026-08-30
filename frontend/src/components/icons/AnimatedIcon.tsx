import { forwardRef, useEffect, useRef, useState, type SVGProps } from "react";
import { useReducedMotion } from "framer-motion";
import { NODES, KEBAB, type IconName } from "./nodes";
import "./icons.css";

// Self-hosted animated icon system — a native React port of the animation designs
// from @jis3r/icons (which is Svelte-only) / pqoqubbw/icons. The SVG geometry is
// lucide's own node data (nodes.ts); every animation lives in icons.css, keyed by
// the icon's `ai-<kebab>` class + per-node `ai-p{i}` classes and toggled by the
// `animate` class. Icons animate on hover, or continuously when `animate` is set.
//
// Drop-in for lucide-react: same component names + props (className, size,
// strokeWidth). Sizing via Tailwind `h-4 w-4` still wins over the width/height
// attributes, exactly like lucide.
//
// Hover trigger: the animation plays when the cursor is over the icon OR the
// interactive control that contains it (button / link / label / [role=button]).
// We bind mouseenter/leave to that host (found via closest()), not to the <svg>,
// so hovering anywhere on a button animates its icon — icons rarely fill their
// button, and a glyph-only hit target felt broken. Falls back to the svg itself
// when the icon is standalone (no interactive ancestor).

export interface AnimatedIconProps extends Omit<SVGProps<SVGSVGElement>, "ref"> {
  size?: number;
  strokeWidth?: number;
  /** Force the animation on (e.g. spinners); otherwise it plays on hover. */
  animate?: boolean;
}

// Interactive ancestors whose hover should drive the icon. `.ai-hover-host` is an
// opt-in escape hatch for containers that aren't semantically a control.
const HOST_SELECTOR = "button, a, label, [role='button'], [role='menuitem'], .ai-hover-host";

function IconBase(
  name: IconName,
  { size = 24, strokeWidth = 2, animate = false, className, ...rest }: AnimatedIconProps,
  ref: React.Ref<SVGSVGElement>,
) {
  const [hovered, setHovered] = useState(false);
  const reduce = useReducedMotion();
  const on = !reduce && (animate || hovered);
  const svgRef = useRef<SVGSVGElement | null>(null);

  // Drive the hover state from the nearest interactive ancestor (or the svg
  // itself as a fallback). mouseenter/leave don't bubble, so a single host emits
  // exactly one enter/leave per pointer transit regardless of nested elements.
  useEffect(() => {
    if (animate) return; // forced-on: no hover wiring needed
    const svg = svgRef.current;
    if (!svg) return;
    const host = (svg.closest(HOST_SELECTOR) as HTMLElement | null) ?? svg;
    const enter = () => setHovered(true);
    const leave = () => setHovered(false);
    host.addEventListener("mouseenter", enter);
    host.addEventListener("mouseleave", leave);
    return () => {
      host.removeEventListener("mouseenter", enter);
      host.removeEventListener("mouseleave", leave);
    };
  }, [animate]);

  const cls = ["lucide-anim", `ai-${KEBAB[name]}`, on && "animate", className].filter(Boolean).join(" ");

  return (
    <svg
      ref={(node) => {
        svgRef.current = node;
        if (typeof ref === "function") ref(node);
        else if (ref) (ref as React.MutableRefObject<SVGSVGElement | null>).current = node;
      }}
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={cls}
      aria-hidden={rest["aria-label"] ? undefined : true}
      {...rest}
    >
      {NODES[name].map(([tag, attrs], i) => {
        const Tag = tag as keyof JSX.IntrinsicElements;
        return <Tag key={i} className={`ai-p${i}`} {...attrs} />;
      })}
    </svg>
  );
}

function makeIcon(name: IconName) {
  const Comp = forwardRef<SVGSVGElement, AnimatedIconProps>((props, ref) => IconBase(name, props, ref));
  Comp.displayName = name;
  return Comp;
}

// One drop-in component per lucide icon used across the app.
export const Archive = makeIcon("Archive");
export const ArchiveRestore = makeIcon("ArchiveRestore");
export const ArrowUp = makeIcon("ArrowUp");
export const Ban = makeIcon("Ban");
export const Bold = makeIcon("Bold");
export const Check = makeIcon("Check");
export const ChevronDown = makeIcon("ChevronDown");
export const ChevronRight = makeIcon("ChevronRight");
export const ChevronsUpDown = makeIcon("ChevronsUpDown");
export const Code = makeIcon("Code");
export const Copy = makeIcon("Copy");
export const CornerDownLeft = makeIcon("CornerDownLeft");
export const Download = makeIcon("Download");
export const ExternalLink = makeIcon("ExternalLink");
export const Eye = makeIcon("Eye");
export const FileText = makeIcon("FileText");
export const Folder = makeIcon("Folder");
export const FolderInput = makeIcon("FolderInput");
export const FolderMinus = makeIcon("FolderMinus");
export const FolderPlus = makeIcon("FolderPlus");
export const Hash = makeIcon("Hash");
export const Highlighter = makeIcon("Highlighter");
export const Heading1 = makeIcon("Heading1");
export const Heading2 = makeIcon("Heading2");
export const Heading3 = makeIcon("Heading3");
export const Home = makeIcon("Home");
export const AppWindow = makeIcon("AppWindow");
export const HardDrive = makeIcon("HardDrive");
export const Image = makeIcon("Image");
export const Info = makeIcon("Info");
export const Italic = makeIcon("Italic");
export const Languages = makeIcon("Languages");
export const Link2 = makeIcon("Link2");
export const List = makeIcon("List");
export const ListChecks = makeIcon("ListChecks");
export const ListOrdered = makeIcon("ListOrdered");
export const Loader2 = makeIcon("Loader2");
export const Lock = makeIcon("Lock");
export const LockOpen = makeIcon("LockOpen");
export const LogOut = makeIcon("LogOut");
export const ShieldAlert = makeIcon("ShieldAlert");
export const TriangleAlert = makeIcon("TriangleAlert");
export const Menu = makeIcon("Menu");
export const Minus = makeIcon("Minus");
export const Moon = makeIcon("Moon");
export const MoreVertical = makeIcon("MoreVertical");
export const NotebookPen = makeIcon("NotebookPen");
export const PanelLeftClose = makeIcon("PanelLeftClose");
export const Pencil = makeIcon("Pencil");
export const Pin = makeIcon("Pin");
export const Printer = makeIcon("Printer");
export const Plus = makeIcon("Plus");
export const Quote = makeIcon("Quote");
export const Redo2 = makeIcon("Redo2");
export const RotateCcw = makeIcon("RotateCcw");
export const Search = makeIcon("Search");
export const Settings2 = makeIcon("Settings2");
export const SquareCode = makeIcon("SquareCode");
export const Strikethrough = makeIcon("Strikethrough");
export const Sun = makeIcon("Sun");
export const Tag = makeIcon("Tag");
export const Trash2 = makeIcon("Trash2");
export const Undo2 = makeIcon("Undo2");
export const Keyboard = makeIcon("Keyboard");
export const Upload = makeIcon("Upload");
export const X = makeIcon("X");
export const XCircle = makeIcon("XCircle");
