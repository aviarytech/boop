import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdir, rm } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";
import { ed25519 } from "@noble/curves/ed25519.js";

const outdir = "tmp/list-log-test";

async function loadModules() {
  await rm(outdir, { recursive: true, force: true });
  await mkdir(outdir, { recursive: true });
  for (const name of ["listLog", "originals", "originalsSigner", "credentials"]) {
    await build({
      entryPoints: [`src/lib/${name}.ts`],
      outfile: `${outdir}/${name}.mjs`,
      bundle: true,
      platform: "node",
      format: "esm",
      target: "node20",
      banner: {
        js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);",
      },
    });
  }
  return {
    listLog: await import(pathToFileURL(`${process.cwd()}/${outdir}/listLog.mjs`).href),
    originals: await import(pathToFileURL(`${process.cwd()}/${outdir}/originals.mjs`).href),
    signer: await import(pathToFileURL(`${process.cwd()}/${outdir}/originalsSigner.mjs`).href),
    credentials: await import(pathToFileURL(`${process.cwd()}/${outdir}/credentials.mjs`).href),
  };
}

const { listLog, originals, signer, credentials } = await loadModules();

function localSigner() {
  const privateKey = ed25519.utils.randomSecretKey();
  const publicKey = ed25519.getPublicKey(privateKey);
  return {
    publicKeyMultibase: signer.multikeyFromEd25519PublicKey(publicKey),
    async signBytes(bytes) {
      return ed25519.sign(bytes, privateKey);
    },
  };
}

async function newList(owner) {
  return originals.createListAsset("Groceries", signer.controllerDid(owner), owner);
}

/** Applies a controller action and returns the new log. */
async function act(log, owner, action, itemId, itemName) {
  const result = await listLog.recordItemAction({
    storedLog: log,
    itemId,
    action,
    itemName,
    actorDid: signer.controllerDid(owner),
    signer: owner,
  });
  assert.equal(result.kind, "appended");
  return result.eventLog;
}

test("the owner writes every item action straight to the list log", async () => {
  const owner = localSigner();
  const list = await newList(owner);

  let log = await act(list.eventLog, owner, "added", "item-1", "Milk");
  log = await act(log, owner, "checked", "item-1");

  assert.equal(JSON.parse(log).events.length, 3, "genesis plus two actions");
  assert.equal((await originals.verifyAssetLog(log)).verified, true);

  const item = listLog.foldListState(log).get("item-1");
  assert.equal(item.name, "Milk");
  assert.equal(item.checked, true);
  assert.equal(item.checkedBy, signer.controllerDid(owner));
});

test("the owner can check off an item a collaborator added — never blocked", async () => {
  // The property model B exists for: authority sits with the list, so the owner
  // acts on everything on their own list without waiting for anyone.
  const owner = localSigner();
  const collaborator = localSigner();
  const list = await newList(owner);

  const added = await listLog.recordItemAction({
    storedLog: list.eventLog,
    itemId: "item-1",
    action: "added",
    itemName: "Milk",
    actorDid: signer.controllerDid(collaborator),
    signer: collaborator,
  });
  assert.equal(added.kind, "claimed");

  const withItem = await listLog.foldInClaim(list.eventLog, added.credential, owner);
  const checked = await act(withItem, owner, "checked", "item-1");

  const item = listLog.foldListState(checked).get("item-1");
  assert.equal(item.addedBy, signer.controllerDid(collaborator), "credit stays with the adder");
  assert.equal(item.checked, true);
  assert.equal(item.checkedBy, signer.controllerDid(owner));
  assert.equal((await originals.verifyAssetLog(checked)).verified, true);
});

test("a collaborator's action becomes a signed claim the owner folds in", async () => {
  const owner = localSigner();
  const collaborator = localSigner();
  const list = await newList(owner);
  const withItem = await act(list.eventLog, owner, "added", "item-1", "Milk");

  const claim = await listLog.recordItemAction({
    storedLog: withItem,
    itemId: "item-1",
    action: "checked",
    actorDid: signer.controllerDid(collaborator),
    signer: collaborator,
  });

  assert.equal(claim.kind, "claimed");
  const folded = await listLog.foldInClaim(withItem, claim.credential, owner);

  const item = listLog.foldListState(folded).get("item-1");
  assert.equal(item.checked, true);
  assert.equal(
    item.checkedBy,
    signer.controllerDid(collaborator),
    "the log credits the collaborator, not the owner who relayed it"
  );
  assert.equal((await originals.verifyAssetLog(folded)).verified, true);
});

test("a forged claim is refused", async () => {
  const owner = localSigner();
  const collaborator = localSigner();
  const list = await newList(owner);

  const claim = await listLog.recordItemAction({
    storedLog: list.eventLog,
    itemId: "item-1",
    action: "checked",
    actorDid: signer.controllerDid(collaborator),
    signer: collaborator,
  });

  const forged = {
    ...claim.credential,
    credentialSubject: { ...claim.credential.credentialSubject, itemId: "item-99" },
  };

  await assert.rejects(() => listLog.foldInClaim(list.eventLog, forged, owner), /verif/i);
});

test("a validly signed claim about a DIFFERENT list is refused", async () => {
  const owner = localSigner();
  const collaborator = localSigner();
  const list = await newList(owner);
  const otherList = await newList(owner);

  const claim = await listLog.recordItemAction({
    storedLog: otherList.eventLog,
    itemId: "item-1",
    action: "checked",
    actorDid: signer.controllerDid(collaborator),
    signer: collaborator,
  });

  assert.equal(claim.kind, "claimed", "guard the setup");
  assert.equal(await credentials.verifyCredential(claim.credential), true, "it is validly signed");

  await assert.rejects(
    () => listLog.foldInClaim(list.eventLog, claim.credential, owner),
    /does not name this list/i
  );
});

test("an unknown action is refused rather than signed", async () => {
  // One log carries content and control events, so the vocabulary stays closed.
  const owner = localSigner();
  const list = await newList(owner);

  await assert.rejects(
    () =>
      listLog.recordItemAction({
        storedLog: list.eventLog,
        itemId: "item-1",
        action: "promoted",
        actorDid: signer.controllerDid(owner),
        signer: owner,
      }),
    /unknown item action/i
  );
});

test("a claim carrying an unknown action is refused at fold-in", async () => {
  const owner = localSigner();
  const collaborator = localSigner();
  const list = await newList(owner);

  const claim = await listLog.recordItemAction({
    storedLog: list.eventLog,
    itemId: "item-1",
    action: "checked",
    actorDid: signer.controllerDid(collaborator),
    signer: collaborator,
  });

  const tampered = {
    ...claim.credential,
    credentialSubject: { ...claim.credential.credentialSubject, action: "migrated" },
  };

  await assert.rejects(
    () => listLog.foldInClaim(list.eventLog, tampered, owner),
    /unknown item action/i,
    "the vocabulary check must run before the signature check can be argued about"
  );
});

test("check, uncheck, check folds to checked once", async () => {
  const owner = localSigner();
  const list = await newList(owner);

  let log = await act(list.eventLog, owner, "added", "item-1", "Milk");
  log = await act(log, owner, "checked", "item-1");
  log = await act(log, owner, "unchecked", "item-1");
  log = await act(log, owner, "checked", "item-1");

  const item = listLog.foldListState(log).get("item-1");
  assert.equal(item.checked, true, "last action wins");
  assert.equal(JSON.parse(log).events.length, 5);
  assert.equal((await originals.verifyAssetLog(log)).verified, true);
});

test("removed items drop out of the live list but stay in the log", async () => {
  const owner = localSigner();
  const list = await newList(owner);

  let log = await act(list.eventLog, owner, "added", "item-1", "Milk");
  log = await act(log, owner, "added", "item-2", "Eggs");
  log = await act(log, owner, "removed", "item-1");

  const live = listLog.liveItems(log);
  assert.deepEqual(live.map((i) => i.itemId), ["item-2"]);
  assert.equal(listLog.foldListState(log).get("item-1").removed, true, "history is not erased");
});

test("renaming updates the folded name", async () => {
  const owner = localSigner();
  const list = await newList(owner);

  let log = await act(list.eventLog, owner, "added", "item-1", "Milk");
  log = await act(log, owner, "renamed", "item-1", "Oat milk");

  assert.equal(listLog.foldListState(log).get("item-1").name, "Oat milk");
});

test("isController distinguishes the writer from everyone else", async () => {
  const owner = localSigner();
  const collaborator = localSigner();
  const list = await newList(owner);

  assert.equal(listLog.isController(list.eventLog, owner), true);
  assert.equal(listLog.isController(list.eventLog, collaborator), false);
});
