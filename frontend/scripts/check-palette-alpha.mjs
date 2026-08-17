#!/usr/bin/env node
// Guard against a bug that shipped silently for a long time and cost nothing to miss.
//
// Every colour in Lockpad's palette is a CSS custom property holding a FINISHED hex
// string (`--primary: #A34B3C`), and tailwind.config.js maps each one straight through
// as `var(--primary)`. Tailwind can only apply an opacity modifier to a colour it can
// take apart into channels, so given a hex-in-a-var it does not warn, does not emit a
// broken rule, and does not fall back: `bg-primary/90` produces NO CSS AT ALL.
//
// The failure is therefore invisible in review and invisible at runtime. A tint just
// isn't there; text that asked to be dimmed renders at full strength. Twenty-five of
// these accumulated across twelve files before an audit caught them.
//
// Write `bg-[color-mix(in_srgb,var(--primary)_90%,transparent)]` instead — same maths,
// and the form the --surface-* tokens already use.
//
// Run: npm run lint:palette   (from frontend/)
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { pathToFileURL } from "node:url";

const ROOT = new URL("..", import.meta.url).pathname;
const SRC = join(ROOT, "src");

// Tokens are derived by IMPORTING the config, not by pattern-matching its text. The
// first attempt at this scraped the file with a regex and silently derived only 9 of the
// 14 colours — `primary` among the misses, which is the single highest-traffic token in
// the app. A guard that quietly covers two thirds of the surface is worse than none,
// because it reports "clean" and is believed. Reading the real object cannot drift from
// what Tailwind itself sees.
const cfgPath = pathToFileURL(join(ROOT, "tailwind.config.js")).href;
const cfg = (await import(cfgPath)).default;

const tokens = new Set();
(function collect(node, prefix) {
  for (const [key, value] of Object.entries(node ?? {})) {
    const name = key === "DEFAULT" ? prefix : prefix ? `${prefix}-${key}` : key;
    if (typeof value === "string") {
      // Only var()-backed colours are vulnerable. A literal hex or rgb() slices fine.
      if (value.includes("var(--")) tokens.add(name);
    } else if (value && typeof value === "object") {
      collect(value, name);
    }
  }
})(cfg?.theme?.extend?.colors, "");

if (tokens.size === 0) {
  console.error("check-palette-alpha: derived zero palette tokens — refusing to pass vacuously.");
  process.exit(2);
}

// Strip comments first. The explanations of THIS bug quote the broken spellings on
// purpose, and flagging prose would train people to ignore the guard.
function stripComments(code) {
  return code
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "))
    .replace(/(^|[^:])\/\/[^\n]*/g, (m, p1) => p1 + " ".repeat(m.length - p1.length));
}

const PREFIXES = "bg|text|border|ring|ring-offset|from|via|to|divide|outline|decoration|fill|stroke|placeholder|caret|shadow|accent";
// Longest token first, so `muted-foreground` wins over `muted` and the reported
// utility name is the real one.
const names = [...tokens].sort((a, b) => b.length - a.length).join("|");
const pattern = new RegExp(`\\b(${PREFIXES})-(${names})\\/(\\d+)\\b`, "g");

const files = [];
(function walk(dir) {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) walk(p);
    else if (/\.(tsx?|css)$/.test(p)) files.push(p);
  }
})(SRC);

const hits = [];
for (const file of files) {
  const code = stripComments(readFileSync(file, "utf8"));
  code.split("\n").forEach((line, i) => {
    for (const m of line.matchAll(pattern)) {
      hits.push({ file: relative(ROOT, file), line: i + 1, util: m[0] });
    }
  });
}

if (hits.length) {
  console.error(`\ncheck-palette-alpha: ${hits.length} opacity modifier(s) on a var()-backed palette colour.`);
  console.error("These generate NO CSS. Use color-mix(in srgb, var(--token) N%, transparent) instead.\n");
  for (const h of hits) console.error(`  ${h.file}:${h.line}  ${h.util}`);
  console.error("");
  process.exit(1);
}
console.log(`check-palette-alpha: clean (${files.length} files, ${tokens.size} palette tokens derived from config).`);
