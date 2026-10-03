#!/usr/bin/env node
import { createCanvas } from '@napi-rs/canvas';
import { writeFileSync, mkdirSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const publicDir = join(__dirname, '..', 'public');
const screenshotsDir = join(publicDir, 'screenshots');

// Ensure screenshots directory exists
mkdirSync(screenshotsDir, { recursive: true });

// Screenshot specs from manifest
const screenshots = [
  { name: 'home.png', width: 1280, height: 720 },
  { name: 'mobile.png', width: 750, height: 1334 }
];

for (const { name, width, height } of screenshots) {
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');
  
  // Background gradient
  const gradient = ctx.createLinearGradient(0, 0, width, height);
  gradient.addColorStop(0, '#FFFBEB'); // amber-50
  gradient.addColorStop(1, '#FEF3C7'); // amber-100
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, width, height);
  
  // App name
  ctx.fillStyle = '#78350F'; // amber-900
  const fontSize = Math.floor(Math.min(width, height) * 0.08);
  ctx.font = `bold ${fontSize}px system-ui, -apple-system, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('boop', width / 2, height / 2 - fontSize);
  
  // Tagline
  const taglineSize = Math.floor(fontSize * 0.5);
  ctx.font = `${taglineSize}px system-ui, -apple-system, sans-serif`;
  ctx.fillStyle = '#92400E'; // amber-800
  ctx.fillText('Organize your life while you poop', width / 2, height / 2 + taglineSize);
  
  writeFileSync(join(screenshotsDir, name), canvas.toBuffer('image/png'));
  console.log(`Generated: ${name}`);
}

console.log('\n✅ Screenshots generated!');
