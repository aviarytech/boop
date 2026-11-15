// THROWAWAY spike code (#286). Gate 3: an agent-signed action record that
// embeds its zCap verifies offline with no server, including after the zCap
// has expired or been revoked, given Boop's receipt time (D10).
//
//   bun gate3-offline.mjs
import assert from "node:assert/strict";
import * as ed from "@noble/ed25519";
import { updateDID } from "didwebvh-ts";
import { ZcapClient } from "@interop/ezcap";
import { EddsaJcs2022 } from "@interop/ed25519-signature/eddsa-jcs-2022";
import { newKey, remoteZcapSigner, staticDidLoader, rootZcap, rootZcapId } from "./lib/common.mjs";
import { mintUserDid, addCapabilityDelegation, SUB_ORG } from "./lib/userDid.mjs";
import { buildAgentRecord, signAgentRecord, signReceipt, ownerRootTarget, verifyAgentRecordWithLibs, verifyAgentRecordMinimal } from "./lib/agentRecord.mjs";

// No server: any network use from here on is a failure of the gate.
let networkCalls = 0;
globalThis.fetch = async (...args) => { networkCalls++; throw new Error(`network call attempted: ${args[0]}`); };

const DAY = 24 * 3600 * 1000;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

// --- Owner DID: v1 today's shape, v2 adds capabilityDelegation, v3 removes it again
const user = await mintUserDid();
await sleep(2100); // did:webvh version times have one-second resolution
const v2 = await addCapabilityDelegation(user);
const delegatedFrom = Date.parse(v2.log.at(-1).versionTime);
await sleep(3100);
const v3 = await updateDID({
  log: v2.log, signer: user.signer, verifier: user.signer, updateKeys: [user.author.multikey],
  verificationMethods: user.genesis.doc.verificationMethod.map(vm => ({ ...vm })), authentication: ["#key-0"], assertionMethod: ["#orig-1"],
});
const keyRemovedAt = Date.parse(v3.log.at(-1).versionTime);
const log = v3.log;
assert.deepEqual(log.map(e => (e.state.capabilityDelegation ?? []).length), [0, 1, 0]);

// --- Delegation, signed by #orig-1 through the Turnkey-shaped backend ------
const agent = newKey();
const agentDid = `did:key:${agent.multikey}`;
const rootTarget = ownerRootTarget("https://boop.example", user.did);
const zcap = await new ZcapClient({
  SuiteClass: EddsaJcs2022,
  delegationSigner: remoteZcapSigner({ verificationMethod: `${user.did}#orig-1`, signBytes: m => user.backend.sign(SUB_ORG, user.assertion.address, m) }),
  documentLoader: staticDidLoader({ [user.did]: v2.doc }, { [rootZcapId(rootTarget)]: rootZcap(rootTarget, user.did) }),
}).delegate({ capability: rootZcapId(rootTarget), controller: agentDid, invocationTarget: rootTarget, allowedActions: ["item.created", "item.completed"], expires: new Date(delegatedFrom + 30 * DAY), now: delegatedFrom });
const expiresAt = Date.parse(zcap.expires);

// --- Boop's service key (P3) -----------------------------------------------
const serviceKey = newKey();
const service = { ...serviceKey, verificationMethod: "did:webvh:QmSpikeService:boop.example#receipts-1" };

// --- One agent-signed record ------------------------------------------------
const receivedAt = delegatedFrom + 800; // inside v2 of the DID, before the key leaves in v3
assert.ok(receivedAt < keyRemovedAt && Date.parse(log[0].versionTime) < delegatedFrom - 1000);
const change = { action: "item.created", subject: { listId: "k17abc" }, after: { name: "oat milk" } };
const signAsAgent = bytes => ed.sign(bytes, agent.secretKey);
const make = async (overrides = {}) => {
  const built = buildAgentRecord({ change: overrides.change ?? change, agentDid: overrides.agentDid ?? agentDid, ownerDid: overrides.ownerDid ?? user.did, zcap: overrides.zcap ?? zcap, signedAt: overrides.signedAt ?? receivedAt - 400 });
  const record = await signAgentRecord(built, overrides.zcap ?? zcap, overrides.signBytes ?? signAsAgent);
  const at = overrides.receivedAt === null ? null : overrides.receivedAt ?? receivedAt;
  return at === null ? record : { ...record, receipt: signReceipt({ recordDigest: record.digest, receivedAt: at, service: overrides.service ?? service }) };
};
const record = await make();
console.log("== record (version 3 sketch)\n" + JSON.stringify({ ...record, payload: JSON.parse(record.payload), receipt: { ...record.receipt, payload: JSON.parse(record.receipt.payload) } }, null, 2));
console.log(`\nsizes: payload ${record.payload.length} B, zCap ${JSON.stringify(zcap).length} B, receipt ${JSON.stringify(record.receipt).length} B`);

// --- Verify, offline, with both verifiers -----------------------------------
const options = { resolveDidLog: async did => (did === user.did ? log : null), serviceKeys: { [service.verificationMethod]: service.publicKey } };
const results = [];
async function expect(name, candidate, want, extra = {}) {
  for (const [label, verify] of [["libs", verifyAgentRecordWithLibs], ["minimal", verifyAgentRecordMinimal]]) {
    const result = await verify(candidate, { ...options, ...extra });
    const got = result.verified ? "verified" : result.reason;
    const ok = want === "verified" ? result.verified : !result.verified && got.startsWith(want);
    results.push(ok);
    console.log(`${ok ? "OK  " : "FAIL"} [${label.padEnd(7)}] ${name}: ${got}`);
  }
}

console.log(`\n== offline verification (zCap expires ${zcap.expires}; owner DID drops the key at ${new Date(keyRemovedAt).toISOString()})`);
await expect("received inside the delegation", record, "verified");

// The gate: the wall clock is far past expiry and the key is long gone from
// the DID; the record still verifies because the receipt predates both.
const realNow = Date.now;
Date.now = () => expiresAt + 400 * DAY;
assert.ok(Date.now() > expiresAt);
await expect("verified 400 days after the zCap expired", record, "verified");
await expect("…and after the owner revoked it, receipt earlier than the revocation", record, "verified", { revokedAt: { [zcap.id]: receivedAt + 100 } });
await expect("received after the revocation", record, "received_after_revocation", { revokedAt: { [zcap.id]: receivedAt - 1 } });
await expect("no receipt (D10: fails)", await make({ receivedAt: null }), "no_receipt");
await expect("backdated: signedAt inside the window, received after expiry", await make({ signedAt: receivedAt, receivedAt: expiresAt + DAY }), "received_after_expiry");
await expect("received after the owner's DID dropped the delegating key", await make({ receivedAt: keyRemovedAt + 1000 }), "delegation_proof");
await expect("received before the DID listed the key under capabilityDelegation", await make({ receivedAt: delegatedFrom - 1000 }), "delegation_proof");
Date.now = realNow;

// --- Tampering ----------------------------------------------------------------
const stranger = newKey();
await expect("payload changed after signing", { ...record, payload: record.payload.replace("oat milk", "whisky") }, "non_canonical_payload|digest_mismatch".split("|")[1]);
await expect("signed by a key that is not the author's", await make({ signBytes: bytes => ed.sign(bytes, stranger.secretKey) }), "bad_signature");
await expect("another agent presents this agent's zCap", await make({ agentDid: `did:key:${stranger.multikey}`, signBytes: bytes => ed.sign(bytes, stranger.secretKey) }), "delegation_not_for_author");
await expect("action the zCap does not grant", await make({ change: { action: "list.renamed", subject: { listId: "k17abc" }, after: { name: "x" } } }), "action_not_delegated");
await expect("zCap widened after delegation", { ...record, delegation: [{ ...zcap, allowedAction: ["item.created", "item.completed", "list.renamed"] }] }, "delegation_mismatch");
await expect("receipt from a key the verifier does not trust", await make({ service: { ...newKey(), verificationMethod: service.verificationMethod } }), "bad_receipt");
await expect("receipt lifted from another record", { ...record, receipt: (await make({ change: { ...change, after: { name: "other" } } })).receipt }, "receipt_for_another_record");
// A zCap the stranger self-issued, naming the owner's root.
const forged = await new ZcapClient({
  SuiteClass: EddsaJcs2022, delegationSigner: { id: `did:key:${stranger.multikey}#${stranger.multikey}`, algorithm: "Ed25519", sign: async ({ data }) => ed.sign(data, stranger.secretKey) },
  documentLoader: staticDidLoader({}, { [rootZcapId(rootTarget)]: rootZcap(rootTarget, user.did) }),
}).delegate({ capability: rootZcapId(rootTarget), controller: agentDid, invocationTarget: rootTarget, allowedActions: ["item.created"], expires: new Date(delegatedFrom + 30 * DAY), now: delegatedFrom });
await expect("zCap for the owner's root signed by someone else", await make({ zcap: forged }), "delegation_proof");

assert.equal(networkCalls, 0, "the verifiers made a network call");
console.log(`\nnetwork calls during verification: ${networkCalls}`);
console.log(results.every(Boolean) ? "\nGATE 3: PASS" : "\nGATE 3: FAIL");
process.exit(results.every(Boolean) ? 0 : 1);
