import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { mkdir, rm } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";

const outdir = "tmp/plan-limit-test";

async function loadModule() {
  await rm(outdir, { recursive: true, force: true });
  await mkdir(outdir, { recursive: true });
  await build({
    entryPoints: ["src/lib/planLimit.ts"],
    outfile: `${outdir}/planLimit.mjs`,
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node20",
  });
  return import(`${pathToFileURL(`${process.cwd()}/${outdir}/planLimit.mjs`).href}?t=${Date.now()}`);
}

const mod = await loadModule();

// The exact string assertListQuota throws (convex/lists.ts).
const REAL = "PLAN_LIMIT: You've reached the free plan limit of 5 lists. Upgrade at /pricing to create unlimited lists.";

test("recognises the quota error the server actually throws", () => {
  assert.equal(mod.isPlanLimitError(new Error(REAL)), true);
  // Convex wraps mutation errors, so the marker is rarely at position 0.
  assert.equal(
    mod.isPlanLimitError(new Error(`[CONVEX M(lists:createList)] Uncaught Error: ${REAL}`)),
    true
  );
});

test("does not mistake other failures for the quota", () => {
  assert.equal(mod.isPlanLimitError(new Error("List name cannot be empty")), false);
  assert.equal(mod.isPlanLimitError(new Error("Network request failed")), false);
  assert.equal(mod.isPlanLimitError("not an error"), false);
  assert.equal(mod.isPlanLimitError(null), false);
});

test("tells the user what to do, never 'try again'", () => {
  const msg = mod.listCreationErrorMessage(new Error(REAL));
  assert.match(msg, /limit of 5 lists/);
  // "Please try again" is advice that can never work at the cap.
  assert.doesNotMatch(msg, /try again/i);
});

test("unexpected failures still get the generic retry message", () => {
  const msg = mod.listCreationErrorMessage(new Error("boom"));
  assert.match(msg, /try again/i);
  assert.equal(mod.listCreationErrorMessage(new Error("boom"), "Custom"), "Custom");
});

// The bug was not the helper — it was that only ONE of five creation paths
// recognised the quota at all, so a capped user got "please try again" or, on
// the Templates page, no message whatsoever.
test("every list-creation path handles the quota", async () => {
  const paths = [
    "src/components/CreateListModal.tsx",
    "src/components/TemplatePickerModal.tsx",
    "src/pages/Templates.tsx",
    "src/components/OnboardingFlow.tsx",
  ];
  for (const p of paths) {
    const src = await readFile(p, "utf8");
    assert.ok(
      /isPlanLimitError|listCreationErrorMessage/.test(src),
      `${p} creates lists but does not recognise the plan limit`
    );
    // A generic fallback is fine for real failures; what must not happen is the
    // quota reaching the user as one. CreateListModal branches on the quota
    // first, so its fallback is only for genuinely unexpected errors.
    const genericInCatch = /catch \([^)]*\) \{[^}]*Please try again[^}]*\}/s.test(src);
    if (genericInCatch) {
      assert.ok(
        /isPlanLimitError\(/.test(src),
        `${p} shows a retry message without first checking for the quota`
      );
    }
  }
});
