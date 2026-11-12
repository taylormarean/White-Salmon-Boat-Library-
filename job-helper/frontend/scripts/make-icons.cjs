#!/usr/bin/env node
/*
 * Regenerates the app icons in public/icons/ (used for "Add to Home Screen").
 *
 *   node scripts/make-icons.cjs
 *
 * Draws a white sprout on the brand green, writes icon.svg, then renders PNGs
 * with Playwright's headless Chromium (`npm i -D playwright` if it's missing).
 */
const fs = require('fs');
const path = require('path');

const GREEN = '#2f6f62';
const OUT = path.join(__dirname, '..', 'public', 'icons');

// The sprout, drawn on a 512x512 canvas, roughly centered.
const SPROUT = `
  <g fill="#ffffff">
    <path d="M256 250 C 268 172 328 126 404 132 C 404 214 342 262 256 250 Z"/>
    <path d="M248 292 C 234 226 184 192 112 198 C 116 266 174 304 248 292 Z"/>
  </g>
  <path d="M256 404 V 268" fill="none" stroke="#ffffff" stroke-width="30" stroke-linecap="round"/>
  <path d="M176 404 H 336" fill="none" stroke="#ffffff" stroke-width="22" stroke-linecap="round" opacity=".55"/>`;

/**
 * rounded: rounded-square badge on transparent (favicon / regular icons).
 * scale:   shrink the sprout so it stays inside the maskable "safe zone".
 */
function svg({ rounded, scale = 1 }) {
  const bg = rounded
    ? `<rect width="512" height="512" rx="112" fill="${GREEN}"/>`
    : `<rect width="512" height="512" fill="${GREEN}"/>`;
  const t = scale === 1 ? '' : ` transform="translate(256 268) scale(${scale}) translate(-256 -268)"`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">${bg}<g${t}>${SPROUT}</g></svg>`;
}

const ICONS = [
  // file,                    size, svg options
  ['icon-192.png',            192, { rounded: true }],
  ['icon-512.png',            512, { rounded: true }],
  ['icon-maskable-512.png',   512, { rounded: false, scale: 0.72 }], // OS crops to its own shape
  ['apple-touch-icon.png',    180, { rounded: false, scale: 0.86 }], // iOS rounds corners itself; must be opaque
];

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, 'icon.svg'), svg({ rounded: true }) + '\n');
  console.log('wrote icons/icon.svg');

  const { chromium } = require('playwright');
  const browser = await chromium.launch();
  try {
    for (const [file, size, opts] of ICONS) {
      const page = await browser.newPage({ viewport: { width: size, height: size } });
      const markup = svg(opts).replace('width="512" height="512"', `width="${size}" height="${size}"`);
      await page.setContent(
        `<!doctype html><html><body style="margin:0;background:transparent">${markup}</body></html>`,
      );
      await page.screenshot({
        path: path.join(OUT, file),
        omitBackground: true,
        clip: { x: 0, y: 0, width: size, height: size },
      });
      await page.close();
      console.log(`wrote icons/${file} (${size}x${size})`);
    }
  } finally {
    await browser.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
