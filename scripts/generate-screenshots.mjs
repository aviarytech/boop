#!/usr/bin/env node
// Generate sharing and install artwork from the same boop identity as generate-icons.mjs.
import { createCanvas } from '@napi-rs/canvas';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const publicDir = join(root, 'public');
const screenshotsDir = join(publicDir, 'screenshots');
mkdirSync(screenshotsDir, { recursive: true });

function renderBrand(width, height) {
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fafaf7';
  ctx.fillRect(0, 0, width, height);

  const scale = Math.min(width / 1200, height / 630);
  ctx.translate(width / 2, height / 2);
  ctx.scale(scale, scale);
  // Dot and ripple proportions match the app icon.
  ctx.strokeStyle = '#6b3cff';
  ctx.lineWidth = 4;
  ctx.globalAlpha = 0.25;
  ctx.beginPath();
  ctx.arc(-200, -65, 48, 0, Math.PI * 2);
  ctx.stroke();
  ctx.globalAlpha = 1;
  ctx.fillStyle = '#6b3cff';
  ctx.beginPath();
  ctx.arc(-200, -65, 28, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = '#111014';
  ctx.font = 'bold 128px system-ui, -apple-system, sans-serif';
  ctx.textBaseline = 'middle';
  ctx.fillText('boop', -120, -65);
  ctx.textAlign = 'center';
  ctx.font = '36px system-ui, -apple-system, sans-serif';
  ctx.fillStyle = '#6b6a74';
  ctx.fillText('A calm little place for the', 0, 75);
  ctx.fillText('things you need to do.', 0, 125);
  return canvas.toBuffer('image/png');
}

const shareImage = renderBrand(1200, 630);
// Keep the old URL branded too, for clients still using cached HTML.
writeFileSync(join(publicDir, 'og-image.png'), shareImage);
writeFileSync(join(publicDir, 'og-image-boop.png'), shareImage);

for (const [name, width, height] of [
  ['home.png', 1280, 720],
  ['mobile.png', 750, 1334],
]) {
  const image = renderBrand(width, height);
  writeFileSync(join(screenshotsDir, name), image);
  for (const nativeDir of ['ios/App/App/public', 'android/app/src/main/assets/public']) {
    writeFileSync(join(root, nativeDir, 'screenshots', name), image);
  }
}
console.log('Generated boop sharing and install artwork.');
