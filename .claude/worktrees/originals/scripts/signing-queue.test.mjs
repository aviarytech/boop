import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdir, rm } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";
import { ed25519 } from "@noble/curves/ed25519.js";

const outdir = "tmp/signing-queue-test";

async function loadModules() {
  await rm(outdir, { recursive: true, force: true });
  await mkdir(outdir, { recursive: true });
  for (const name of ["signingQueue", "listLog", "originals", "originalsSigner"]) {
    await build({
      entryPoints: [`src/lib/${name}.ts`],
      outfile: `${outdir}/${name}.mjs`,
      bundle: true, platform: "node", format: "esm", target: "node20",
      banner: { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" },
    });
  }
  return {
    queue: await import(pathToFileURL(`${process.cwd()}/${outdir}/signingQueue.mjs`).href),
    listLog: await import(pathToFileURL(`${process.cwd()}/${outdir}/listLog.mjs`).href),
    originals: await import(pathToFileURL(`${process.cwd()}/${outdir}/originals.mjs`).href),
    signer: await import(pathToFileURL(`${process.cwd()}/${outdir}/originalsSigner.mjs`).href),
  };
}

const { queue, listLog, originals, signer } = await loadModules();

function localSigner() {
  const privateKey = ed25519.utils.randomSecretKey();
  const publicKey = ed25519.getPublicKey(privateKey);
  return {
    publicKeyMultibase: signer.multikeyFromEd25519PublicKey(publicKey),
    async signBytes(bytes) { return ed25519.sign(bytes, privateKey); },
  };
}

/** Records what the queue asked of the outside world. */
function transportFor(logs = {}, overrides = {}) {
  const saved = {};
  const claims = [];
  let saveLogCalls = 0;
  return {
    saved, claims,
    get saveLogCalls() { return saveLogCalls; },
    transport: {
      async loadLog(listId) { return saved[listId] ?? logs[listId] ?? null; },
      async saveLog(listId, eventLog) { saveLogCalls += 1; saved[listId] = eventLog; },
      async saveClaim(listId, credential) { claims.push({ listId, credential }); },
      ...overrides,
    },
  };
}

async function newList(owner) {
  return originals.createListAsset("Groceries", signer.controllerDid(owner), owner);
}

function action(overrides) {
  return {
    listId: "list-1",
    itemId: "item-1",
    action: "added",
    itemName: "Milk",
    actorDid: "did:key:zActor",
    at: "2026-01-15T12:00:00.000Z",
    ...overrides,
  };
}

test("a drained action lands on the list's log", async () => {
  const owner = localSigner();
  const list = await newList(owner);
  const store = queue.createMemoryQueueStore();
  const t = transportFor({ "list-1": list.eventLog });

  await queue.enqueue(store, action({ actorDid: signer.controllerDid(owner) }));
  const result = await queue.drainQueue({ store, transport: t.transport, signer: owner });

  assert.equal(result.appended, 1);
  assert.equal(result.pending, 0, "a drained action leaves the queue");
  assert.equal((await originals.verifyAssetLog(t.saved["list-1"])).verified, true);
  assert.equal(listLog.foldListState(t.saved["list-1"]).get("item-1").name, "Milk");
});

test("actions on one list are applied in order and written once", async () => {
  const owner = localSigner();
  const list = await newList(owner);
  const store = queue.createMemoryQueueStore();
  const t = transportFor({ "list-1": list.eventLog });
  const actorDid = signer.controllerDid(owner);

  await queue.enqueue(store, action({ actorDid, action: "added", itemName: "Milk" }));
  await queue.enqueue(store, action({ actorDid, action: "checked" }));
  await queue.enqueue(store, action({ actorDid, action: "renamed", itemName: "Oat milk" }));

  const result = await queue.drainQueue({ store, transport: t.transport, signer: owner });

  assert.equal(result.appended, 3);
  assert.equal(t.saveLogCalls, 1, "one write per list, not per action");
  assert.equal(JSON.parse(t.saved["list-1"]).events.length, 4);

  const item = listLog.foldListState(t.saved["list-1"]).get("item-1");
  assert.equal(item.name, "Oat milk", "the rename must land after the add");
  assert.equal(item.checked, true);
});

test("no signer leaves the queue untouched — that is the normal offline state", async () => {
  const store = queue.createMemoryQueueStore();
  const t = transportFor();

  await queue.enqueue(store, action());
  const result = await queue.drainQueue({ store, transport: t.transport, signer: null });

  assert.equal(result.appended, 0);
  assert.equal(result.pending, 1);
  assert.equal(result.failed, 0, "offline is not failure");
  assert.equal(t.saveLogCalls, 0);
});

test("an action on someone else's list becomes a stored claim", async () => {
  const owner = localSigner();
  const collaborator = localSigner();
  const list = await newList(owner);
  const store = queue.createMemoryQueueStore();
  const t = transportFor({ "list-1": list.eventLog });

  await queue.enqueue(store, action({
    action: "checked",
    actorDid: signer.controllerDid(collaborator),
  }));

  const result = await queue.drainQueue({ store, transport: t.transport, signer: collaborator });

  assert.equal(result.claimed, 1);
  assert.equal(result.appended, 0);
  assert.equal(result.pending, 0);
  assert.equal(t.claims.length, 1);
  assert.equal(t.claims[0].credential.credentialSubject.itemId, "item-1");
});

test("a failure keeps the action queued and counts the attempt", async () => {
  const owner = localSigner();
  const store = queue.createMemoryQueueStore();
  const t = transportFor({}, {
    async loadLog() { throw new Error("network down"); },
  });

  await queue.enqueue(store, action({ actorDid: signer.controllerDid(owner) }));
  const result = await queue.drainQueue({ store, transport: t.transport, signer: owner });

  assert.equal(result.appended, 0);
  assert.equal(result.pending, 1, "the work is not lost");
  assert.equal(result.failed, 0, "one failure is not permanent");

  const [queued] = await store.list();
  assert.equal(queued.attempts, 1);
  assert.match(queued.lastError, /network down/);
});

test("retries are given up on and surfaced rather than looping forever", async () => {
  const owner = localSigner();
  const store = queue.createMemoryQueueStore();
  const t = transportFor({}, {
    async loadLog() { throw new Error("network down"); },
  });

  await queue.enqueue(store, action({ actorDid: signer.controllerDid(owner) }));
  for (let i = 0; i < 5; i += 1) {
    await queue.drainQueue({ store, transport: t.transport, signer: owner });
  }

  const failed = await queue.failedActions(store);
  assert.equal(failed.length, 1, "a permanently failed action must stay visible");
  assert.equal(failed[0].attempts, 5);

  // A failed action is skipped, not retried forever.
  const result = await queue.drainQueue({ store, transport: t.transport, signer: owner });
  assert.equal(result.failed, 1);
  assert.equal(failed[0].attempts, 5, "no further attempts are spent on it");
});

test("a failure halts its own list but not the others", async () => {
  const owner = localSigner();
  const listA = await newList(owner);
  const listB = await newList(owner);
  const store = queue.createMemoryQueueStore();
  const actorDid = signer.controllerDid(owner);

  // list-1 has no log, so its actions fail; list-2 is healthy.
  const t = transportFor({ "list-2": listB.eventLog });
  void listA;

  await queue.enqueue(store, action({ listId: "list-1", actorDid }));
  await queue.enqueue(store, action({ listId: "list-2", actorDid, itemName: "Eggs" }));

  const result = await queue.drainQueue({ store, transport: t.transport, signer: owner });

  assert.equal(result.appended, 1, "the healthy list still drains");
  assert.equal(listLog.foldListState(t.saved["list-2"]).get("item-1").name, "Eggs");

  const remaining = await store.list();
  assert.equal(remaining.length, 1);
  assert.equal(remaining[0].listId, "list-1");
});

test("a mid-chain failure does not let later actions overtake it", async () => {
  const owner = localSigner();
  const list = await newList(owner);
  const store = queue.createMemoryQueueStore();
  const actorDid = signer.controllerDid(owner);

  // Fails on the second signature only.
  let signCalls = 0;
  const flaky = {
    publicKeyMultibase: owner.publicKeyMultibase,
    async signBytes(bytes) {
      signCalls += 1;
      if (signCalls === 2) throw new Error("signer blipped");
      return owner.signBytes(bytes);
    },
  };
  const t = transportFor({ "list-1": list.eventLog });

  await queue.enqueue(store, action({ actorDid, action: "added", itemName: "Milk" }));
  await queue.enqueue(store, action({ actorDid, action: "checked" }));
  await queue.enqueue(store, action({ actorDid, action: "renamed", itemName: "Oat milk" }));

  const result = await queue.drainQueue({ store, transport: t.transport, signer: flaky });

  assert.equal(result.appended, 1, "only the first action got through");
  const remaining = await store.list();
  assert.deepEqual(
    remaining.map((a) => a.action),
    ["checked", "renamed"],
    "the rename must not jump ahead of the checked that failed"
  );
  assert.equal(listLog.foldListState(t.saved["list-1"]).get("item-1").name, "Milk");
});

test("the queued timestamp is preserved, not the moment of signing", async () => {
  const owner = localSigner();
  const list = await newList(owner);
  const store = queue.createMemoryQueueStore();
  const t = transportFor({ "list-1": list.eventLog });

  await queue.enqueue(store, action({
    actorDid: signer.controllerDid(owner),
    action: "checked",
    at: "2026-01-15T09:30:00.000Z",
  }));
  await queue.drainQueue({ store, transport: t.transport, signer: owner });

  assert.equal(
    listLog.foldListState(t.saved["list-1"]).get("item-1").checkedAt,
    "2026-01-15T09:30:00.000Z",
    "the log must say when the user acted, not when the network came back"
  );
});
