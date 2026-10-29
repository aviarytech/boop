// #286 PR b, end to end against the real Originals SDK 5: a re-genesised
// author did:webvh whose Turnkey assertion key signs Originals entries that a
// reader holding only the DID log verifies.
//
// TURNKEY IS MOCKED (scripts/helpers/author-did-fixture.ts): signRawPayload is
// a local Ed25519 key per wallet account. Everything else is real: didwebvh-ts
// mints and resolves the DID, src/lib/originalsSigning.ts signs, SDK 5 builds,
// verifies and packages the Original.
//
// main is on @originals/sdk 4, so SDK 5 comes from ORIGINALS_SDK5_DIR (a
// directory with @originals/sdk@5 in node_modules) or, once #298 lands, from
// the installed package. Without either these tests are skipped, not passed.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";

async function loadSdk5() {
  const roots = [process.env.ORIGINALS_SDK5_DIR, process.cwd()].filter(Boolean);
  for (const root of roots) {
    const pkg = join(root, "node_modules/@originals/sdk");
    try {
      const { version } = JSON.parse(await readFile(join(pkg, "package.json"), "utf8"));
      if (Number(version.split(".")[0]) < 5) continue;
      return { version, sdk: await import(pathToFileURL(join(pkg, "dist/originals/index.js")).href) };
    } catch { /* not installed here */ }
  }
  return null;
}

const loaded = await loadSdk5();
const skip = loaded ? false : "needs @originals/sdk 5 (set ORIGINALS_SDK5_DIR, or rebase onto #298)";

const outdir = "tmp/originals-author-sdk5-test";
await mkdir(outdir, { recursive: true });
await build({
  entryPoints: ["scripts/helpers/author-did-fixture.ts"], outfile: `${outdir}/fixture.mjs`,
  bundle: true, platform: "node", format: "esm", target: "node20", logLevel: "silent",
});
const fixture = await import(`${pathToFileURL(`${process.cwd()}/${outdir}/fixture.mjs`).href}?t=${Date.now()}`);
const { mockTurnkey, mintAuthor, mintLegacyDid, originalsSigning, authorDidLog } = fixture;

const bytes = text => new TextEncoder().encode(text);

function sdkFor(evidence) {
  const { OriginalsSDK, MemoryStore } = loaded.sdk;
  return OriginalsSDK.create({ store: new MemoryStore(), authors: [evidence] });
}

/** Create, then edit, as the author; return the reader's view of the package. */
async function createAndEdit(author) {
  const sdk = sdkFor(author.listAuthor.evidence);
  const created = await sdk.create({
    name: "Groceries",
    resources: [{ id: "list.json", mediaType: "application/json", bytes: bytes('{"items":["Milk"]}') }],
    author: author.listAuthor.author,
    signer: author.listAuthor.signer,
  });
  assert.equal(created.kind, "original");
  const did = created.original.did;
  const edited = await sdk.edit(did, {
    parent: created.original.checkpoint,
    resources: [{ id: "list.json", bytes: bytes('{"items":["Milk","Eggs"]}') }],
    author: author.listAuthor.author,
    signer: author.listAuthor.signer,
  });
  const { bytes: zip } = await sdk.package(did);
  // The reader holds no key and nothing but the author's DID log.
  const reader = sdkFor({ did: author.did, log: author.jsonl, source: "supplied", obtainedAt: new Date().toISOString() });
  return { did, created, edited, loaded: await reader.load(zip) };
}

test("SDK 5 verifies a create and an edit signed by the re-genesised DID's Turnkey assertion key", { skip }, async () => {
  const turnkey = await mockTurnkey();
  // Re-genesis: the account starts on a pre-#286 DID and gets a new one.
  const legacy = await mintLegacyDid("boop.ad", "user-author");
  const author = await mintAuthor(turnkey, { path: "user-author" });
  assert.notEqual(author.did, legacy.did);
  const stored = await authorDidLog.checkDidLog(author.jsonl);
  assert.deepEqual(stored.authorProblems, [], "the new DID is an author DID by the server's own check");

  const { did, edited, loaded: view } = await createAndEdit(author);
  assert.match(did, /^did:vh:/);
  assert.equal(edited.status, "committed");
  const report = view.report;
  assert.equal(report.history.status, "valid", JSON.stringify(report.history));
  assert.equal(report.authorBinding.status, "valid");
  assert.equal(report.history.entries, 2);
  assert.equal(report.identityEvidence.author, author.did);
  assert.equal(report.identityEvidence.status, "complete");
  assert.deepEqual(view.reasons.filter(r => r !== "not-anchored"), [], view.reasons.join(", "));

  // Only the assertion key signed entries; the author key signed only the DID.
  const assertionAddress = author.keys.assertion.address;
  const authorAddress = author.keys.author.address;
  const signs = turnkey.calls.filter(c => c.op === "sign");
  assert.equal(signs.filter(c => c.address === authorAddress).length, 1, "the author key signed the genesis entry only");
  assert.equal(signs.filter(c => c.address === assertionAddress).length, 2, "the assertion key signed both Originals entries");
});

test("the signer signs exactly the bytes SDK 5 keySigner signs, and refuses what keySigner refuses", { skip }, async () => {
  const turnkey = await mockTurnkey();
  const author = await mintAuthor(turnkey);
  const reference = loaded.sdk.keySigner({
    keyType: "Ed25519", secretKey: turnkey.secretFor("m/44'/501'/1'/0'"), verificationMethod: author.listAuthor.author.verificationMethod,
  });
  // Capture real SigningRequests from the SDK, then hand each to both signers.
  const requests = [];
  const recording = { ...author.listAuthor.signer, sign: async request => { requests.push(structuredClone(request)); return author.listAuthor.signer.sign(request); } };
  await createAndEdit({ ...author, listAuthor: { ...author.listAuthor, signer: recording } });
  assert.equal(requests.length, 2);
  for (const request of requests) {
    assert.deepEqual(await author.listAuthor.signer.sign(request), await reference.sign(request), "Ed25519 is deterministic, so equal bytes signed means equal signatures");
  }

  const [create, edit] = requests;
  const tampered = [
    ["another key's proof options", { ...create, proofOptions: { ...create.proofOptions, verificationMethod: `${author.did}#key-0` } }],
    ["a non-assertion proof purpose", { ...create, proofOptions: { ...create.proofOptions, proofPurpose: "authentication" } }],
    ["another method", { ...create, entry: { ...create.entry, parameters: { ...create.entry.parameters, method: "did:webvh:1.0" } } }],
    ["a misstated name", { ...create, summary: { ...create.summary, name: "Something else" } }],
    ["misstated changes", { ...create, summary: { ...create.summary, changes: [] } }],
    ["a parent that does not chain", { ...edit, parent: { ...edit.parent, entry: { ...edit.parent.entry, versionTime: "2000-01-01T00:00:00Z" } } }],
    ["an entry for another author key", { ...create, entry: { ...create.entry, state: { ...create.entry.state, author: { ...create.entry.state.author, verificationMethod: `${author.did}#key-0` } } } }],
  ];
  for (const [what, request] of tampered) {
    await assert.rejects(() => reference.sign(request), `keySigner refuses ${what}`);
    await assert.rejects(() => author.listAuthor.signer.sign(request), /SIGNER_REFUSED|refuse|not|misstat|chain|summary/i, `our signer refuses ${what}`);
  }
  const before = turnkey.calls.length;
  await assert.rejects(() => author.listAuthor.signer.sign(tampered[0][1]));
  assert.equal(turnkey.calls.length, before, "a refused request never reaches Turnkey");
});

test("SDK 5 refuses an author DID whose assertion key is also its update key", { skip }, async () => {
  const turnkey = await mockTurnkey();
  const shared = await mintAuthor(turnkey, { shareUpdateKey: true });
  assert.ok((await authorDidLog.checkDidLog(shared.jsonl)).authorProblems.some(p => /also an update key/.test(p)), "the server's check refuses it too");
  const sdk = sdkFor(shared.listAuthor.evidence);
  await assert.rejects(() => sdk.create({
    name: "Shared", resources: [{ id: "a", mediaType: "text/plain", bytes: bytes("a") }],
    author: shared.listAuthor.author, signer: shared.listAuthor.signer,
  }), err => /update key/i.test(err.message) || /AUTHOR_VM/.test(err.code ?? ""));
});

test("SDK 5 refuses to sign with a pre-#286 DID (controller \"\", one key in every role)", { skip }, async () => {
  const legacy = await mintLegacyDid();
  const verificationMethod = `${legacy.did}#key-1`;
  const signer = loaded.sdk.keySigner({ keyType: "Ed25519", secretKey: legacy.secret, verificationMethod });
  const sdk = sdkFor({ did: legacy.did, log: legacy.jsonl, source: "supplied", obtainedAt: new Date().toISOString() });
  const versionId = JSON.parse(legacy.jsonl.split("\n").at(-1)).versionId;
  await assert.rejects(() => sdk.create({
    name: "Old", resources: [{ id: "a", mediaType: "text/plain", bytes: bytes("a") }],
    author: { did: legacy.did, verificationMethod, versionId }, signer,
  }), err => /controller|update key/i.test(err.message) || /AUTHOR_VM/.test(err.code ?? ""));
});

test("the signer's proofHashData matches SDK 5's for every captured request", { skip }, async () => {
  const turnkey = await mockTurnkey();
  const author = await mintAuthor(turnkey);
  const vh = await import(pathToFileURL(join(process.env.ORIGINALS_SDK5_DIR ?? process.cwd(), "node_modules/@originals/vh/dist/crypto/index.js")).href);
  const requests = [];
  const recording = { ...author.listAuthor.signer, sign: async request => { requests.push(structuredClone(request)); return author.listAuthor.signer.sign(request); } };
  await createAndEdit({ ...author, listAuthor: { ...author.listAuthor, signer: recording } });
  for (const { entry, proofOptions } of requests) {
    assert.deepEqual(await originalsSigning.proofHashData(entry, proofOptions), vh.proofHashData(entry, proofOptions));
  }
});
