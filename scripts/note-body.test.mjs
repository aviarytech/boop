import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdir, rm } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";

const outdir = "tmp/note-body-test";

async function loadModule() {
  await rm(outdir, { recursive: true, force: true });
  await mkdir(outdir, { recursive: true });
  await build({
    entryPoints: ["convex/lib/noteBody.ts"],
    outfile: `${outdir}/noteBody.mjs`,
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node20",
  });
  return import(
    `${pathToFileURL(`${process.cwd()}/${outdir}/noteBody.mjs`).href}?t=${Date.now()}`
  );
}

const m = await loadModule();

test("MAX_NOTE_LENGTH is 50000", () => {
  assert.equal(m.MAX_NOTE_LENGTH, 50000);
});

test("isNote only for kind note", () => {
  assert.equal(m.isNote({ kind: "note" }), true);
  assert.equal(m.isNote({}), false);
});

test("wordCount is 0 for blank bodies", () => {
  assert.equal(m.wordCount(""), 0);
  assert.equal(m.wordCount("  \n\t "), 0);
});

test("wordCount splits on runs of spaces and newlines", () => {
  assert.equal(m.wordCount("one  two\n\nthree\tfour "), 4);
});

test("excerpt is empty for a blank body", () => {
  assert.equal(m.excerpt(""), "");
  assert.equal(m.excerpt("   \n "), "");
});

test("excerpt strips headings, emphasis, code and links", () => {
  assert.equal(
    m.excerpt("# Title\n\nSome **bold** and _soft_ `code` with a [link](https://x.y)."),
    "Title Some bold and soft code with a link.",
  );
});

test("excerpt strips blockquotes and list markers", () => {
  assert.equal(m.excerpt("> quoted\n- one\n- two\n1. three"), "quoted one two three");
});

test("excerpt keeps snake_case words intact", () => {
  assert.equal(m.excerpt("use snake_case_names"), "use snake_case_names");
});

test("excerpt collapses whitespace", () => {
  assert.equal(m.excerpt("a   b\n\n\nc"), "a b c");
});

test("excerpt truncates long bodies with an ellipsis", () => {
  const out = m.excerpt("word ".repeat(100), 20);
  assert.ok(out.length <= 20, `got ${out.length}`);
  assert.ok(out.endsWith("…"));
  assert.equal(m.excerpt("short", 20), "short");
});

// A generous budget catches multi-second backtracking while allowing slow CI.
test("maximum-size malformed markdown has bounded excerpt cost", () => {
  for (const body of ["\n".repeat(50000), "[".repeat(50000), " ".repeat(50000)]) {
    const start = performance.now();
    const result = m.excerpt(body);
    assert.ok(performance.now() - start < 1000, "excerpt took over a second");
    assert.ok(result.length <= 160);
  }
});

test("markers do not consume adjacent blank lines", () => {
  assert.equal(m.excerpt("first\n\n  > second\n\n  - [x] third"), "first second third");
});
