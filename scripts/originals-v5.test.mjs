// Lists as Originals 5, end to end with real keys: a did:webvh author minted
// the way boop mints them (didwebvh-ts), a device key in its assertionMethod,
// and the client wrapper (src/lib/originals.ts) talking to the same judging
// code the Convex host runs (convex/lib/originalsSubmission.ts).
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";

const outdir = "tmp/originals-v5-test";

async function load(entry, name) {
  await mkdir(outdir, { recursive: true });
  await build({
    entryPoints: [entry],
    outfile: `${outdir}/${name}.mjs`,
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node20",
    banner: { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" },
    logLevel: "silent",
  });
  return import(`${pathToFileURL(`${process.cwd()}/${outdir}/${name}.mjs`).href}?t=${Date.now()}`);
}

const fixture = await load("scripts/helpers/originals-v5-fixture.ts", "fixture");
const { originals, judgeSubmission, makeAuthor, makeHost } = fixture;

test("a list mints as a did:vh Original the host accepts and a reader verifies", async () => {
  const owner = await makeAuthor();
  const host = makeHost({ ownerDid: owner.did, authorLog: owner.log, judgeSubmission });
  originals.setListAuthorSource(async () => owner.listAuthor);

  const did = await originals.mintList(host.client, {
    listId: host.listId, ownerDid: owner.did, name: "Groceries",
    content: { kind: "list", snapshot: originals.buildListSnapshot("Groceries", [{ name: "Milk", checked: false }]) },
  });
  assert.match(did, /^did:vh:/);
  assert.equal(host.assetDid(), did, "genesis names the list by its Original");

  // A reader holds no key: everything is checked from what the host serves.
  originals.setListAuthorSource(async () => null);
  const verified = await originals.verifyList(host.client, host.listId);
  assert.equal(verified.verified, true, verified.error ?? verified.reasons.join(", "));
  assert.equal(verified.did, did);
  assert.ok(verified.reasons.includes("not-anchored"), "an unanchored Original is never current");
});

test("publishing appends a signed version, and an unchanged snapshot appends nothing", async () => {
  const owner = await makeAuthor();
  const host = makeHost({ ownerDid: owner.did, authorLog: owner.log, judgeSubmission });
  originals.setListAuthorSource(async () => owner.listAuthor);
  const did = await originals.mintList(host.client, {
    listId: host.listId, ownerDid: owner.did, name: "Trip",
    content: { kind: "list", snapshot: originals.buildListSnapshot("Trip", []) },
  });

  const snapshot = originals.buildListSnapshot("Trip", [{ name: "Passport", checked: true }]);
  const list = { listId: host.listId, ownerDid: owner.did, did };
  const first = await originals.recordPublishedVersion(host.client, list, snapshot);
  assert.equal(first.appended, true);
  assert.equal(first.version, 2);
  assert.match(first.checkpoint, /^2-/);

  const again = await originals.recordPublishedVersion(host.client, list, snapshot);
  assert.equal(again.appended, false);
  assert.equal(again.checkpoint, first.checkpoint);

  originals.setListAuthorSource(async () => null);
  const verified = await originals.verifyList(host.client, host.listId);
  assert.equal(verified.verified, true, verified.error ?? verified.reasons.join(", "));
  assert.match(verified.checkpoint, /^2-/);
});

test("a publish racing another device's save lands on the new head", async () => {
  const owner = await makeAuthor();
  const host = makeHost({ ownerDid: owner.did, authorLog: owner.log, judgeSubmission });
  originals.setListAuthorSource(async () => owner.listAuthor);
  const did = await originals.mintList(host.client, {
    listId: host.listId, ownerDid: owner.did, name: "Shared",
    content: { kind: "list", snapshot: originals.buildListSnapshot("Shared", []) },
  });
  const list = { listId: host.listId, ownerDid: owner.did, did };

  // Another device saves between this device's sync and its submit.
  host.beforeNextSubmit(() => originals.recordPublishedVersion(host.client, list,
    originals.buildListSnapshot("Shared", [{ name: "From the other device", checked: false }])));
  const mine = await originals.recordPublishedVersion(host.client, list,
    originals.buildListSnapshot("Shared", [{ name: "From this device", checked: false }]));
  assert.equal(mine.appended, true);
  assert.match(mine.checkpoint, /^3-/, "reconciled onto the other device's entry, not forked");
});

test("only the owner's device can sign for a list", async () => {
  const owner = await makeAuthor();
  const stranger = await makeAuthor();
  const host = makeHost({ ownerDid: owner.did, authorLog: owner.log, judgeSubmission });

  originals.setListAuthorSource(async () => stranger.listAuthor);
  await assert.rejects(
    originals.mintList(host.client, {
      listId: host.listId, ownerDid: owner.did, name: "Not mine",
      content: { kind: "list", snapshot: originals.buildListSnapshot("Not mine", []) },
    }),
    originals.ListNotAuthorableError,
  );

  // A device without a key yet fails the same way, not with an SDK error.
  originals.setListAuthorSource(async () => null);
  await assert.rejects(
    originals.mintList(host.client, {
      listId: host.listId, ownerDid: owner.did, name: "No key",
      content: { kind: "note", body: "" },
    }),
    originals.ListNotAuthorableError,
  );
});

test("the host refuses a genesis signed by someone else's DID", async () => {
  const owner = await makeAuthor();
  const stranger = await makeAuthor();
  const host = makeHost({ ownerDid: owner.did, authorLog: owner.log, judgeSubmission });
  // The stranger's device bypasses the client check and submits directly.
  const strangerHost = makeHost({ ownerDid: stranger.did, authorLog: stranger.log, judgeSubmission });
  originals.setListAuthorSource(async () => stranger.listAuthor);
  await originals.mintList(strangerHost.client, {
    listId: strangerHost.listId, ownerDid: stranger.did, name: "Forged",
    content: { kind: "list", snapshot: originals.buildListSnapshot("Forged", []) },
  });
  const [entry] = strangerHost.logLines();
  await assert.rejects(
    judgeSubmission(host.state(), { original: JSON.parse(entry).state.id, entry, resources: [] }, Date.now()),
    /Only the list owner/,
  );
});

test("tampered resource bytes fail verification", async () => {
  const owner = await makeAuthor();
  const host = makeHost({ ownerDid: owner.did, authorLog: owner.log, judgeSubmission });
  originals.setListAuthorSource(async () => owner.listAuthor);
  await originals.mintList(host.client, {
    listId: host.listId, ownerDid: owner.did, name: "Honest",
    content: { kind: "list", snapshot: originals.buildListSnapshot("Honest", [{ name: "A", checked: false }]) },
  });
  host.tamperResources();
  originals.setListAuthorSource(async () => null);
  const verified = await originals.verifyList(host.client, host.listId);
  assert.equal(verified.verified, false);
  assert.notEqual(verified.content, "available");
  assert.match(verified.error, /content/);
});

test("an author whose update key is also its assertion key cannot sign (5.x key separation)", async () => {
  const sameKey = await makeAuthor({ shareUpdateKey: true });
  const host = makeHost({ ownerDid: sameKey.did, authorLog: sameKey.log, judgeSubmission });
  originals.setListAuthorSource(async () => sameKey.listAuthor);
  await assert.rejects(originals.mintList(host.client, {
    listId: host.listId, ownerDid: sameKey.did, name: "Today's DIDs",
    content: { kind: "list", snapshot: originals.buildListSnapshot("Today's DIDs", []) },
  }));
});

test("legacy asset DIDs are recognised for re-mint", () => {
  assert.equal(originals.isLegacyAssetDid("did:cel:zabc"), true);
  assert.equal(originals.isLegacyAssetDid("did:peer:4zabc"), true);
  assert.equal(originals.isLegacyAssetDid("did:vh:zabc"), false);
  assert.equal(originals.isLegacyAssetDid(undefined), false);
});
