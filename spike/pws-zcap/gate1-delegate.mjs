// THROWAWAY spike code (#286). Gate 1: the user's #orig-1 key, reachable only
// as "sign these bytes" through a Turnkey session, signs an eddsa-jcs-2022 zCap
// delegation to an agent did:key.
//
//   bun gate1-delegate.mjs
//
// The Turnkey session is replaced by local keys behind the identical interface
// (AuthorKeyBackend.sign in src/lib/authorDid.ts). The live check is an owner
// action; see plans/pws-spike-findings.md.
import assert from "node:assert/strict";
import * as ed from "@noble/ed25519";
import jsigs from "@interop/jsonld-signatures";
import { ZcapClient } from "@interop/ezcap";
import { CapabilityDelegation } from "@interop/zcap";
import { EddsaJcs2022, createVerifyCryptosuite } from "@interop/ed25519-signature/eddsa-jcs-2022";
import { DataIntegrityProof } from "@interop/data-integrity-proof";
import { PwsClient } from "@interop/pws-client";
import { authorDidProblems, authorLogProblems } from "../../shared/authorDid.ts";
import { base58 } from "@scure/base";
import { proofHashData, canonicalize } from "../../src/lib/originalsSigning.ts";
import { newKey, remoteZcapSigner, staticDidLoader, rootZcap, rootZcapId } from "./lib/common.mjs";
import { mintUserDid, addCapabilityDelegation, SUB_ORG } from "./lib/userDid.mjs";

const TARGET = "https://boop.example/lws/";
const out = (label, value) => console.log(`\n== ${label}\n${typeof value === "string" ? value : JSON.stringify(value, null, 2)}`);

const user = await mintUserDid();
const updated = await addCapabilityDelegation(user);
const agent = newKey();
const agentDid = `did:key:${agent.multikey}`;
const orig1 = `${user.did}#orig-1`;

out("user DID", user.did);
out("DID state after the update (version " + updated.versionId + ")", updated.doc);

// --- What the DID change does to today's boop -----------------------------
out("authorDidProblems on the genesis state (today's shape)", authorDidProblems(user.genesis.doc, [user.author.multikey]));
out("authorDidProblems on the updated state (main as of c4ec8b1)", authorDidProblems(updated.doc, [user.author.multikey]));
out("authorLogProblems on the updated log", authorLogProblems(updated.log));

// --- The signer: {id, sign({data})} over raw bytes -------------------------
const signBytes = message => user.backend.sign(SUB_ORG, user.assertion.address, message);
const delegationSigner = remoteZcapSigner({ verificationMethod: orig1, signBytes });

const loaderFor = (doc, options) => staticDidLoader({ [user.did]: doc }, { [rootZcapId(TARGET)]: rootZcap(TARGET, user.did) }, options);
const expires = new Date(Date.now() + 30 * 24 * 3600 * 1000); // D12: 30 days

// ezcap, as pws-client's zcapClientForSigner builds it.
const client = new ZcapClient({ SuiteClass: EddsaJcs2022, delegationSigner, documentLoader: loaderFor(updated.doc) });
const before = user.backend.calls.length;
const zcap = await client.delegate({
  controller: agentDid, invocationTarget: TARGET, expires,
  allowedActions: ["item.created", "item.completed", "item.reopened", "list.created", "list.renamed"],
});
out("delegated zCap (ezcap + EddsaJcs2022, signed through the remote signer)", zcap);

const calls = user.backend.calls.slice(before);
assert.equal(calls.length, 1, "exactly one Turnkey signature per delegation");
assert.equal(calls[0].address, user.assertion.address, "the #orig-1 account signed");
assert.equal(calls[0].message.length, 64, "the signer was handed the 64-byte eddsa-jcs-2022 hash data");

// The bytes handed to the signer are the bytes boop's own eddsa-jcs-2022 code
// computes (src/lib/originalsSigning.ts proofHashData): the same call Turnkey
// already serves for Originals entries.
const { proof, ...unsecured } = zcap;
const { proofValue, ...proofOptions } = proof;
const refused = await proofHashData(unsecured, proofOptions).then(() => null, error => error);
out("boop proofHashData(zcap, proof options) as it is on main", refused ? `${refused.code}: ${refused.message}` : "accepted");
// Its allowlist of proof members has no `capabilityChain`. With that one
// member set aside the function is plain eddsa-jcs-2022, so compute the same
// thing with the member kept: sha256(JCS(proof config)) || sha256(JCS(document)).
const sha256 = async text => new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)));
const ours = Uint8Array.from([...await sha256(canonicalize(proofOptions)), ...await sha256(canonicalize(unsecured))]);
assert.deepEqual([...calls[0].message], [...ours]);
console.log("\nOK signed bytes == sha256(JCS(proof options)) || sha256(JCS(zcap)), using boop's own canonicalize");
assert.ok(await ed.verifyAsync(base58.decode(proofValue.slice(1)), calls[0].message, user.assertion.publicKey));
console.log("OK proofValue is #orig-1's Ed25519 signature over those bytes");

// --- Verify the delegation the way a zcap verifier does --------------------
const verifySuite = () => new DataIntegrityProof({ cryptosuite: createVerifyCryptosuite() });
const purpose = () => new CapabilityDelegation({ suite: verifySuite(), expectedRootCapability: rootZcapId(TARGET), allowTargetAttenuation: true });
const verify = (document, doc) => jsigs.verify(document, { suite: verifySuite(), purpose: purpose(), documentLoader: loaderFor(doc) });

const good = await verify(zcap, updated.doc);
assert.equal(good.verified, true, String(good.error?.errors?.[0] ?? good.error));
console.log("OK chain verifies: root (controller = user did:webvh) -> agent did:key, #orig-1 under capabilityDelegation");

// The document exactly as didwebvh-ts wrote it (relative `#orig-1` references).
const relative = await jsigs.verify(zcap, { suite: verifySuite(), purpose: purpose(), documentLoader: loaderFor(updated.doc, { absolutize: false }) });
assert.equal(relative.verified, false);
out("same zCap, DID document left with relative key references", String(relative.error?.errors?.[0]?.message ?? relative.error?.message ?? relative.error));

// Negative: the same zCap against today's DID (no capabilityDelegation).
const today = await verify(zcap, user.genesis.doc);
assert.equal(today.verified, false);
out("same zCap against today's DID state (no capabilityDelegation)", String(today.error?.errors?.[0]?.message ?? today.error?.message ?? today.error));

// Negative: tampered scope.
const tampered = await verify({ ...zcap, allowedAction: [...zcap.allowedAction, "item.deleted"] }, updated.doc);
assert.equal(tampered.verified, false);
console.log("OK a tampered zCap does not verify");

// --- pws-client's own entry point takes the same signer --------------------
const pws = PwsClient.fromSigner ? PwsClient.fromSigner({ baseServerUrl: "https://boop.example", signer: delegationSigner }) : null;
if (pws?.grant) {
  const viaPws = await pws.grant({ to: agentDid, actions: ["GET", "POST"], target: TARGET, expires });
  const res = await verify(viaPws, updated.doc);
  assert.equal(res.verified, true, String(res.error?.errors?.[0] ?? res.error));
  console.log("OK PwsClient.fromSigner({signer}).grant(...) signs through the same remote signer and verifies");
} else {
  console.log("NOTE PwsClient.fromSigner/grant not available in this version; ezcap path used");
}

console.log("\nGATE 1: PASS (local key behind the Turnkey backend interface)");
