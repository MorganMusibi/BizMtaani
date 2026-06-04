/**
 * Generates all PWA icon PNGs from the BizMtaani favicon SVG.
 * Run: node scripts/src/generate-icons.mjs
 */
import { Resvg } from "@resvg/resvg-js";
import { readFileSync, writeFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "../..");
const publicDir = join(root, "artifacts/bizmtaani/public");

// ── Base icon SVG (standard — no safe-zone padding) ──────────────────────────
const iconSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" fill="none">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#047857"/>
      <stop offset="100%" stop-color="#022C22"/>
    </linearGradient>
    <linearGradient id="aw" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#FB923C"/>
      <stop offset="100%" stop-color="#EA580C"/>
    </linearGradient>
  </defs>
  <rect width="100" height="100" rx="22" fill="url(#bg)"/>
  <path d="M14 40 L50 24 L86 40 L82 49 L18 49 Z" fill="url(#aw)"/>
  <rect x="18" y="47" width="64" height="34" rx="3" fill="white" opacity="0.97"/>
  <rect x="23" y="53" width="15" height="11" rx="2.5" fill="#D1FAE5"/>
  <rect x="43" y="55" width="14" height="26" rx="2" fill="#065F46"/>
  <rect x="62" y="53" width="15" height="11" rx="2.5" fill="#D1FAE5"/>
  <rect x="12" y="79" width="76" height="4" rx="2" fill="#F97316" opacity="0.45"/>
</svg>`;

// ── Maskable icon SVG (safe zone = 40% → icon shrunk to 60% centered) ────────
// For maskable icons, the icon must fit inside the "safe zone" (centre 80% circle)
// We embed the full logo at 60% scale centered on a full-bleed green background.
const maskableSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" fill="none">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#047857"/>
      <stop offset="100%" stop-color="#022C22"/>
    </linearGradient>
    <linearGradient id="aw" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#FB923C"/>
      <stop offset="100%" stop-color="#EA580C"/>
    </linearGradient>
  </defs>
  <!-- Full bleed background (no rounded corners for maskable) -->
  <rect width="100" height="100" fill="url(#bg)"/>
  <!-- Icon elements scaled to 62% and centered (safe-zone compliant) -->
  <g transform="translate(19 19) scale(0.62)">
    <path d="M14 40 L50 24 L86 40 L82 49 L18 49 Z" fill="url(#aw)"/>
    <rect x="18" y="47" width="64" height="34" rx="3" fill="white" opacity="0.97"/>
    <rect x="23" y="53" width="15" height="11" rx="2.5" fill="#D1FAE5"/>
    <rect x="43" y="55" width="14" height="26" rx="2" fill="#065F46"/>
    <rect x="62" y="53" width="15" height="11" rx="2.5" fill="#D1FAE5"/>
    <rect x="12" y="79" width="76" height="4" rx="2" fill="#F97316" opacity="0.45"/>
  </g>
</svg>`;

function renderPng(svg, size) {
  const resvg = new Resvg(svg, {
    fitTo: { mode: "width", value: size },
  });
  return resvg.render().asPng();
}

const icons = [
  { file: "icon-192.png",          svg: iconSvg,     size: 192 },
  { file: "icon-512.png",          svg: iconSvg,     size: 512 },
  { file: "icon-maskable-192.png", svg: maskableSvg, size: 192 },
  { file: "icon-maskable-512.png", svg: maskableSvg, size: 512 },
];

for (const { file, svg, size } of icons) {
  const png = renderPng(svg, size);
  writeFileSync(join(publicDir, file), png);
  console.log(`✓ ${file} (${size}×${size})`);
}

console.log("\nAll icons generated ✓");
