// Lists signed with the owner's Turnkey assertion key (#286 PR b) and saved
// through the Convex host (PR e). Turnkey is mocked with local keys.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";

const outdir = "tmp/originals-turnkey-lists-test";
await mkdir(outdir, { recursive: true });
await build({
  entryPoints: ["scripts/helpers/originals-turnkey-fixture.ts"],
  outfile: `${outdir}/fixture.mjs`,
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node20",
  banner: { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" },
  logLevel: "silent",
});
const { mockTurnkey, mintAuthor, shared, originals, makeHost, judgeSubmission } =
  await import(`${pathToFileURL(`${process.cwd()}/${outdir}/fixture.mjs`).href}?t=${Date.now()}`);

async function ownerWithList(name) {
  const turnkey = await mockTurnkey([shared.AUTHOR_KEY_PATH, shared.ASSERTION_KEY_PATH]);
  const owner = await mintAuthor(turnkey);
  const host = makeHost({ ownerDid: owner.did, authorLog: owner.jsonl, judgeSubmission });
  originals.setListAuthorSource(async () => owner.listAuthor);
  const did = await originals.mintList(host.client, {
    listId: host.listId, ownerDid: owner.did, name,
    content: { kind: "list", snapshot: originals.buildListSnapshot(name, [{ name: "Milk", checked: false }]) },
  });
  return { turnkey, owner, host, did };
}

test("a list minted with the Turnkey assertion key is accepted by the host and verifies", async () => {
  const { owner, host, did } = await ownerWithList("Groceries");
  assert.match(did, /^did:vh:/);
  assert.equal(host.assetDid(), did);
  assert.equal(owner.listAuthor.author.verificationMethod.startsWith(owner.did), true);

  originals.setListAuthorSource(async () => null);
  const verified = await originals.verifyList(host.client, host.listId);
  assert.equal(verified.verified, true, verified.error ?? verified.reasons.join(", "));
});

test("Originals entries are signed by the assertion key, never the DID's update key", async () => {
  const { turnkey, owner, host, did } = await ownerWithList("Trip");
  const signed = turnkey.calls.filter((c) => c.op === "sign");
  turnkey.calls.length = 0;
  await originals.recordPublishedVersion(host.client, { listId: host.listId, ownerDid: owner.did, did },
    originals.buildListSnapshot("Trip", [{ name: "Passport", checked: true }]));
  const entrySigns = turnkey.calls.filter((c) => c.op === "sign");
  assert.ok(entrySigns.length >= 1);
  for (const call of entrySigns) assert.equal(call.address, owner.keys.assertion.address);
  // Minting the author DID itself was signed by the update key only.
  assert.ok(signed.some((c) => c.address === owner.keys.author.address));
});

test("a published version signed through Turnkey verifies as version 2", async () => {
  const { owner, host, did } = await ownerWithList("Shared");
  const recorded = await originals.recordPublishedVersion(host.client, { listId: host.listId, ownerDid: owner.did, did },
    originals.buildListSnapshot("Shared", [{ name: "Bread", checked: false }]));
  assert.equal(recorded.appended, true);
  assert.equal(recorded.version, 2);
  originals.setListAuthorSource(async () => null);
  const verified = await originals.verifyList(host.client, host.listId);
  assert.equal(verified.verified, true, verified.error ?? verified.reasons.join(", "));
  assert.match(verified.checkpoint, /^2-/);
});
