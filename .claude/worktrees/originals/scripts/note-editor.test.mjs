import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdir, rm } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";

const outdir = "tmp/note-editor-test";

async function loadModule() {
  await rm(outdir, { recursive: true, force: true });
  await mkdir(outdir, { recursive: true });
  await build({
    entryPoints: ["src/lib/noteEditor.ts"],
    outfile: `${outdir}/noteEditor.mjs`,
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node20",
  });
  return import(
    `${pathToFileURL(`${process.cwd()}/${outdir}/noteEditor.mjs`).href}?t=${Date.now()}`
  );
}

const m = await loadModule();

test("MAX_NOTE_LENGTH is 50000", () => {
  assert.equal(m.MAX_NOTE_LENGTH, 50000);
});

test("clampNote leaves short text unchanged", () => {
  assert.equal(m.clampNote("hello"), "hello");
});

test("clampNote truncates text over the limit", () => {
  const long = "x".repeat(50001);
  assert.equal(m.clampNote(long).length, 50000);
});

test("shouldPersist true when editable and changed", () => {
  assert.equal(m.shouldPersist({ draft: "b", saved: "a", canEdit: true }), true);
});

test("shouldPersist false when unchanged", () => {
  assert.equal(m.shouldPersist({ draft: "a", saved: "a", canEdit: true }), false);
});

test("shouldPersist false when not editable", () => {
  assert.equal(m.shouldPersist({ draft: "b", saved: "a", canEdit: false }), false);
});
