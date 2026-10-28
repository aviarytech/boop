// Recording a published version (src/lib/originals.ts recordPublishedVersion)
// appends a signed entry to the list's Original through the shared host. Real
// keys and the host's own judging code: scripts/helpers/originals-v5-fixture.ts.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdir, rm } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";
import { api } from "../convex/_generated/api.js";

const outdir = "tmp/published-version-test";

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

const SNAPSHOT = {
  name: "Camping",
  items: [
    { name: "Tent", checked: false },
    { name: "Stove", checked: true },
  ],
};

/** A minted list this device can sign for. */
async function camping() {
  const owner = await makeAuthor();
  const host = makeHost({ ownerDid: owner.did, authorLog: owner.log, judgeSubmission });
  originals.setListAuthorSource(async () => owner.listAuthor);
  const did = await originals.mintList(host.client, {
    listId: host.listId, ownerDid: owner.did, name: "Camping",
    content: { kind: "list", snapshot: originals.buildListSnapshot("Camping", []) },
  });
  return { owner, host, list: { listId: host.listId, ownerDid: owner.did, did } };
}

/** The bytes the head entry commits to for list-metadata, from what the host serves. */
async function publishedSnapshot(host) {
  const head = JSON.parse(host.logLines().at(-1));
  const digest = head.state.asset.resources.find((r) => r.id === "list-metadata").digest;
  const accepted = await host.client.query(api.originalsHost.getAccepted, { listId: host.listId });
  const bytes = accepted.resources.find((r) => r.digest === digest).bytes;
  return JSON.parse(new TextDecoder().decode(bytes));
}

test("records a published version the log still verifies", async () => {
  const { host, list } = await camping();
  const recorded = await originals.recordPublishedVersion(host.client, list, SNAPSHOT);

  assert.equal(recorded.appended, true);
  // Genesis is version 1, so the first published snapshot is 2.
  assert.equal(recorded.version, 2);
  assert.match(recorded.checkpoint, /^2-/);
  assert.deepEqual(host.logLines().map((l) => JSON.parse(l).state.operation), ["create", "update"]);

  // An unverifiable log would be worse than no log at all.
  originals.setListAuthorSource(async () => null);
  const check = await originals.verifyList(host.client, host.listId);
  assert.equal(check.verified, true, `must still verify, got: ${check.error ?? check.reasons.join(", ")}`);
  assert.equal(check.checkpoint, recorded.checkpoint);
});

test("the snapshot commits to what was published", async () => {
  const { host, list } = await camping();
  await originals.recordPublishedVersion(host.client, list, SNAPSHOT);
  assert.deepEqual(await publishedSnapshot(host), SNAPSHOT);
});

test("re-publishing unchanged content is a no-op, not a failure", async () => {
  const { host, list } = await camping();
  const first = await originals.recordPublishedVersion(host.client, list, SNAPSHOT);
  const again = await originals.recordPublishedVersion(host.client, list, SNAPSHOT);

  assert.equal(again.appended, false, "an unchanged re-publish must not append");
  assert.equal(again.checkpoint, first.checkpoint);
  assert.equal(host.logLines().length, 2, "the log must not grow when nothing changed");
});

test("a changed list appends a further version", async () => {
  const { host, list } = await camping();
  await originals.recordPublishedVersion(host.client, list, SNAPSHOT);
  const changed = originals.buildListSnapshot("Camping", [
    { name: "Tent", checked: true },
    { name: "Stove", checked: true },
  ]);
  const second = await originals.recordPublishedVersion(host.client, list, changed);

  assert.equal(second.appended, true);
  assert.equal(second.version, 3);
  assert.equal(host.logLines().length, 3);
  assert.deepEqual(await publishedSnapshot(host), changed);

  originals.setListAuthorSource(async () => null);
  const check = await originals.verifyList(host.client, host.listId);
  assert.equal(check.verified, true);
});

test("a device that can't sign reports it rather than throwing a raw SDK error", async () => {
  const { host, list } = await camping();

  // No key on this device, or a key for someone else's DID: same answer.
  for (const source of [async () => null, async () => (await makeAuthor()).listAuthor]) {
    originals.setListAuthorSource(source);
    await assert.rejects(
      () => originals.recordPublishedVersion(host.client, list, SNAPSHOT),
      (err) => {
        assert.equal(err.name, "ListNotAuthorableError");
        assert.match(err.message, /can't sign/i);
        return true;
      }
    );
  }
  assert.equal(host.logLines().length, 1, "nothing is appended for a device that can't sign");
});

test("buildListSnapshot keeps only what a version should commit to", () => {
  const snapshot = originals.buildListSnapshot("Camping", [
    { name: "Tent", checked: false, _id: "I1", assigneeDid: "did:webvh:someone" },
  ]);
  // Ids and assignees are local bookkeeping, not published content — including
  // them would churn the digest on changes nobody published.
  assert.deepEqual(snapshot, { name: "Camping", items: [{ name: "Tent", checked: false }] });
});
