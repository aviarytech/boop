// Runs the check `npx convex deploy` makes on every function: the args validator
// must be an object (or any). A top-level v.union passes tsc and every handler
// test but fails the production push.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { readdirSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const entries = ['convex', 'convex/migrations'].flatMap(dir => readdirSync(dir)
  .filter(name => name.endsWith('.ts') && !name.endsWith('.d.ts') && name !== 'schema.ts')
  .map(name => `${dir}/${name}`));
const outdir = 'tmp/convex-function-args';
await build({ entryPoints: entries, outdir, outbase: 'convex', bundle: true, platform: 'node', format: 'esm',
  packages: 'external', outExtension: { '.js': '.mjs' }, logLevel: 'silent' });

test('every Convex function has an object or any args validator', async () => {
  const invalid = [];
  let checked = 0;
  for (const entry of entries) {
    const module = await import(pathToFileURL(`${process.cwd()}/${outdir}/${entry.slice('convex/'.length).replace(/\.ts$/, '.mjs')}`));
    for (const [name, fn] of Object.entries(module)) {
      if (typeof fn?.exportArgs !== 'function') continue;
      checked++;
      const { type } = JSON.parse(fn.exportArgs());
      if (type !== 'object' && type !== 'any') invalid.push(`${entry}:${name} (${type})`);
    }
  }
  assert.ok(checked > 100, `expected to find the Convex functions, found ${checked}`);
  assert.deepEqual(invalid, []);
});
