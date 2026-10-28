// The list wrapper's genesis and verification (src/lib/originals.ts) under
// Originals 5, with real keys: see scripts/helpers/originals-v5-fixture.ts.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdir, rm } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";

const outdir = "tmp/originals-test";

async function loadFixture() {
  await rm(outdir, { recursive: true, force: true });
  await mkdir(outdir, { recursive: true });
  await build({
    entryPoints: ["scripts/helpers/originals-v5-fixture.ts"],
    outfile: `${outdir}/fixture.mjs`,
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node20",
    banner: { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" },
    logLevel: "silent",
  });
  return import(pathToFileURL(`${process.cwd()}/${outdir}/fixture.mjs`).href);
}

const { originals, judgeSubmission, makeAuthor, makeHost } = await loadFixture();

async function minted(content, name = "Groceries") {
  const owner = await makeAuthor();
  const host = makeHost({ ownerDid: owner.did, authorLog: owner.log, judgeSubmission });
  originals.setListAuthorSource(async () => owner.listAuthor);
  const did = await originals.mintList(host.client, { listId: host.listId, ownerDid: owner.did, name, content });
  originals.setListAuthorSource(async () => null);
  return { owner, host, did };
}

/** The host's answers with `edit` applied to the served log — a host that lies. */
function lyingClient(host, edit) {
  return {
    action: host.client.action,
    async query(ref, args) {
      const served = await host.client.query(ref, args);
      return served && { ...served, log: edit(served.log) };
    },
  };
}

test("each list mints its own did:vh Original, named by its genesis", async () => {
  const a = await minted({ kind: "list", snapshot: originals.buildListSnapshot("Groceries", []) });
  const b = await minted({ kind: "list", snapshot: originals.buildListSnapshot("Groceries", []) });
  assert.match(a.did, /^did:vh:/, "genesis must produce a did:vh, not a CEL DID");
  assert.notEqual(a.did, b.did, "each list gets its own DID");

  const [genesis] = a.host.logLines();
  const entry = JSON.parse(genesis);
  assert.equal(entry.state.id, a.did);
  assert.equal(entry.state.asset.name, "Groceries");
  assert.equal(entry.state.author.did, a.owner.did, "the owner's DID is the author fixed at genesis");
  assert.deepEqual(entry.state.asset.metadata, { app: "boop", kind: "list" });
});

test("a note's genesis commits to its markdown body, not list metadata", async () => {
  const { host } = await minted({ kind: "note", body: "" }, "Why boop signs");
  const entry = JSON.parse(host.logLines()[0]);
  assert.deepEqual(entry.state.asset.resources.map((r) => [r.id, r.mediaType]), [["note-body", "text/markdown"]]);
  assert.deepEqual(entry.state.asset.metadata, { app: "boop", kind: "note" });

  const ok = await originals.verifyList(host.client, host.listId);
  assert.equal(ok.verified, true, `note should verify, got: ${ok.error ?? ok.reasons.join(", ")}`);
});

test("verifyList round-trips and fails closed on a changed history", async () => {
  const { host, did } = await minted({ kind: "list", snapshot: originals.buildListSnapshot("Chores", []) }, "Chores");

  const ok = await originals.verifyList(host.client, host.listId);
  assert.equal(ok.verified, true, `should verify, got: ${ok.error ?? ok.reasons.join(", ")}`);
  assert.equal(ok.did, did);
  assert.equal(ok.content, "available");

  // A host serving an edited entry must not verify, and must not throw at the call site.
  const forged = await originals.verifyList(lyingClient(host, (log) => log.replace('"Chores"', '"Forged"')), host.listId);
  assert.equal(forged.verified, false, "a changed name in signed history must not verify");
  assert.ok(forged.error, "a failed verification reports why");

  const garbage = await originals.verifyList(lyingClient(host, () => "not json\n"), host.listId);
  assert.equal(garbage.verified, false);
  assert.ok(garbage.error, "malformed logs report an error, not throw");
});

test("a list with no Original yet has nothing to verify", async () => {
  const owner = await makeAuthor();
  const host = makeHost({ ownerDid: owner.did, authorLog: owner.log, judgeSubmission });
  assert.equal(await originals.verifyList(host.client, host.listId), null);
});
