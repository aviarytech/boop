import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

// Read a 16-bit big-endian integer from a PNG IHDR chunk to get width/height.
// PNG layout: 8-byte signature, then IHDR chunk where width is bytes 16–19,
// height is bytes 20–23 (both big-endian uint32).
function pngDimensions(path) {
  const buf = readFileSync(path);
  const width = buf.readUInt32BE(16);
  const height = buf.readUInt32BE(20);
  return { width, height };
}

test('generator produces icon.png at 1024×1024', () => {
  execSync('node scripts/generate-icons.mjs', { cwd: ROOT, stdio: 'inherit' });
  const p = join(ROOT, 'resources/icon.png');
  assert.ok(existsSync(p), 'icon.png should exist');
  assert.ok(statSync(p).size > 1000, 'icon.png should not be empty');
  const { width, height } = pngDimensions(p);
  assert.equal(width, 1024);
  assert.equal(height, 1024);
});

test('generator produces splash.png at 2732×2732', () => {
  const p = join(ROOT, 'resources/splash.png');
  assert.ok(existsSync(p), 'splash.png should exist');
  const { width, height } = pngDimensions(p);
  assert.equal(width, 2732);
  assert.equal(height, 2732);
});

test('generator produces splash-dark.png at 2732×2732', () => {
  const p = join(ROOT, 'resources/splash-dark.png');
  assert.ok(existsSync(p), 'splash-dark.png should exist');
  const { width, height } = pngDimensions(p);
  assert.equal(width, 2732);
  assert.equal(height, 2732);
});
