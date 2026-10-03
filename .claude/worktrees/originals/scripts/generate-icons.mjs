#!/usr/bin/env node
// Renders the three source images the @capacitor/assets CLI consumes.
//
// The pipeline is:
//   1. This script writes resources/icon.png, resources/splash.png,
//      resources/splash-dark.png using @napi-rs/canvas + Nunito-Black.
//   2. The `generate:assets` npm script then calls `capacitor-assets generate`
//      which consumes these three files and installs the full iOS + Android
//      size matrix into the native projects.

import { createCanvas } from '@napi-rs/canvas';
import { writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const RES = join(ROOT, 'resources');

// Brand tokens (mirror src/pages/Landing.css and index.html theme-color).
const VIOLET = '#6b3cff';
const CREAM = '#fafaf7';
const INK = '#0c0b10';

// The mark: a filled dot with a soft ripple ring, proportions locked to the
// identity pack — dot r = 0.218·s, ring r = 0.373·s, stroke = max(1.5, 0.0136·s).
function drawMark(ctx, cx, cy, s, { dotColor, ringColor, ringOpacity = 0.25 }) {
  const dotR = s * 0.218;
  const ringR = s * 0.373;
  const strokeW = Math.max(1.5, s * 0.0136);

  ctx.save();
  ctx.globalAlpha = ringOpacity;
  ctx.strokeStyle = ringColor;
  ctx.lineWidth = strokeW;
  ctx.beginPath();
  ctx.arc(cx, cy, ringR, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();

  ctx.fillStyle = dotColor;
  ctx.beginPath();
  ctx.arc(cx, cy, dotR, 0, Math.PI * 2);
  ctx.fill();
}

function renderIcon() {
  const size = 1024;
  const c = createCanvas(size, size);
  const ctx = c.getContext('2d');

  // Violet tile — no gradient, no rounded corners (iOS/Android mask it).
  ctx.fillStyle = VIOLET;
  ctx.fillRect(0, 0, size, size);

  // Cream dot + ripple — the "iOS rounded" artboard from the identity pack.
  // Ring opacity bumps to 0.4 so the cream stroke holds against violet.
  drawMark(ctx, size / 2, size / 2, size, {
    dotColor: CREAM,
    ringColor: CREAM,
    ringOpacity: 0.4,
  });

  return c.toBuffer('image/png');
}

function renderSplash({ bg, fg }) {
  const size = 2732;
  const c = createCanvas(size, size);
  const ctx = c.getContext('2d');

  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, size, size);

  // Dot ~18% diameter (r ≈ 0.09·size) — keep that by sizing the mark so its
  // dot resolves to the same radius: markSize = (0.09 / 0.218)·size.
  drawMark(ctx, size / 2, size / 2, size * 0.413, {
    dotColor: fg,
    ringColor: fg,
    ringOpacity: 0.25,
  });

  return c.toBuffer('image/png');
}

writeFileSync(join(RES, 'icon.png'), renderIcon());
writeFileSync(join(RES, 'splash.png'), renderSplash({ bg: CREAM, fg: VIOLET }));
writeFileSync(join(RES, 'splash-dark.png'), renderSplash({ bg: INK, fg: VIOLET }));

console.log('✓ Wrote resources/icon.png (1024×1024)');
console.log('✓ Wrote resources/splash.png (2732×2732)');
console.log('✓ Wrote resources/splash-dark.png (2732×2732)');
console.log('Next: run `bun run generate:assets` to install into native projects.');
