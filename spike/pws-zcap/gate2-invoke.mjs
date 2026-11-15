// THROWAWAY spike code (#286). Gate 2: an agent invokes its delegated zCap
// over HTTP Signatures against a LOCAL Convex backend, which verifies the
// signature and the delegation chain in an HTTP route (V8 runtime) and in a
// "use node" action.
//
//   CONVEX_AGENT_MODE=anonymous npx convex dev      # local backend, no account
//   bun gate2-invoke.mjs
import assert from "node:assert/strict";
import * as ed from "@noble/ed25519";
import { ConvexHttpClient } from "convex/browser";
import { ZcapClient } from "@interop/ezcap";
import { EddsaJcs2022 } from "@interop/ed25519-signature/eddsa-jcs-2022";
import { signCapabilityInvocation } from "@interop/http-signature-zcap-invoke";
import { api } from "./convex/_generated/api.js";
import { newKey, remoteZcapSigner, staticDidLoader, rootZcap, rootZcapId } from "./lib/common.mjs";
import { mintUserDid, addCapabilityDelegation, SUB_ORG } from "./lib/userDid.mjs";

const CONVEX_URL = process.env.CONVEX_URL ?? "http://127.0.0.1:3210";
const SITE = process.env.CONVEX_SITE_URL ?? "http://127.0.0.1:3211";
// This script must only ever talk to a local backend.
for (const url of [CONVEX_URL, SITE]) assert.match(url, /^http:\/\/(127\.0\.0\.1|localhost):\d+$/, `refusing non-local Convex URL ${url}`);

const ACTIONS = ["item.created", "item.completed", "item.reopened", "list.created", "list.renamed"];
const ROOT = `${SITE}/lws/`;
const NODE_ROOT = `${SITE}/node/lws/`;

const user = await mintUserDid();
const updated = await addCapabilityDelegation(user);
await new ConvexHttpClient(CONVEX_URL).mutation(api.spike.seed, { did: user.did, document: JSON.stringify(updated.doc) });

const agent = newKey();
const agentDid = `did:key:${agent.multikey}`;
const agentSigner = { id: `${agentDid}#${agent.multikey}`, algorithm: "Ed25519", sign: async ({ data }) => ed.sign(data, agent.secretKey) };
const userSigner = remoteZcapSigner({ verificationMethod: `${user.did}#orig-1`, signBytes: m => user.backend.sign(SUB_ORG, user.assertion.address, m) });

const loader = staticDidLoader({ [user.did]: updated.doc }, { [rootZcapId(ROOT)]: rootZcap(ROOT, user.did) });
// Every delegation is parented on the owner's root (`urn:zcap:root:<…/lws/>`);
// a narrower grant keeps that parent and attenuates `invocationTarget`.
const delegate = (target, options = {}) => new ZcapClient({ SuiteClass: EddsaJcs2022, delegationSigner: options.signer ?? userSigner, documentLoader: loader })
  .delegate({ capability: rootZcapId(options.root ?? ROOT), controller: options.to ?? agentDid, invocationTarget: target, allowedActions: options.actions ?? ACTIONS, expires: options.expires ?? new Date(Date.now() + 30 * 24 * 3600 * 1000), ...(options.now ? { now: options.now } : {}) });

/** Sign and send one invocation; returns the route's JSON verdict. */
async function invoke({ url, capability, action = "item.created", signer = agentSigner, json = { name: "milk" }, mutate }) {
  // The digest is over the bytes sent, so sign the bytes rather than the object.
  const bytes = new TextEncoder().encode(JSON.stringify(json));
  const headers = await signCapabilityInvocation({ url, method: "POST", headers: { date: new Date().toUTCString(), "content-type": "application/json" }, body: bytes, invocationSigner: signer, capability, capabilityAction: action });
  const body = JSON.stringify(mutate?.json ?? json);
  const response = await fetch(url + (mutate?.query ?? ""), { method: "POST", headers: { ...headers, "x-spike-action": mutate?.expectAction ?? action }, body });
  return { status: response.status, headerBytes: Object.entries(headers).reduce((n, [k, v]) => n + k.length + String(v).length + 4, 0), ...(await response.json()) };
}

const results = [];
const check = (name, result, expectVerified) => {
  const ok = result.verified === expectVerified;
  results.push(ok);
  console.log(`${ok ? "OK  " : "FAIL"} ${name}: ${result.status} ${result.runtime} verified=${result.verified}${result.error ? ` (${result.error})` : ""}${result.ms !== undefined ? ` ${result.ms}ms` : ""}`);
  return result;
};

const zcap = await delegate(ROOT);
const good = check("V8 route: agent invokes zCap delegated by #orig-1", await invoke({ url: `${ROOT}items`, capability: zcap }), true);
console.log("     invoker:", good.invoker, "\n     chain:", JSON.stringify(good.chain), "\n     request header bytes:", good.headerBytes, "seen url:", good.seenUrl);
assert.equal(good.invoker, agentDid);
assert.equal(good.chain?.[0]?.controller, user.did);

const nodeZcap = await delegate(NODE_ROOT, { root: NODE_ROOT });
const viaNode = check('"use node" action: the same verifier module', await invoke({ url: `${NODE_ROOT}items`, capability: nodeZcap }), true);
assert.equal(viaNode.runtime, "node");
check("zCap rooted at /node/lws/ invoked on the /lws/ route", await invoke({ url: `${ROOT}items`, capability: nodeZcap }), false);

// --- What the verifier must refuse -----------------------------------------
const stranger = newKey();
const strangerSigner = { id: `did:key:${stranger.multikey}#${stranger.multikey}`, algorithm: "Ed25519", sign: async ({ data }) => ed.sign(data, stranger.secretKey) };
check("another key invokes the agent's zCap", await invoke({ url: `${ROOT}items`, capability: zcap, signer: strangerSigner }), false);
check("action outside allowedAction", await invoke({ url: `${ROOT}items`, capability: zcap, action: "item.deleted" }), false);
check("action signed differs from the action the route performs", await invoke({ url: `${ROOT}items`, capability: zcap, mutate: { expectAction: "list.renamed" } }), false);
check("body changed after signing (digest)", await invoke({ url: `${ROOT}items`, capability: zcap, mutate: { json: { name: "beer" } } }), false);
check("zCap tampered after delegation", await invoke({ url: `${ROOT}items`, capability: { ...zcap, allowedAction: [...ACTIONS, "item.deleted"] }, action: "item.deleted" }), false);
check("zCap delegated by a key that is not the owner's", await invoke({ url: `${ROOT}items`, capability: await delegate(ROOT, { signer: strangerSigner }) }), false);
check("zCap delegated by the owner's #key-0 (not under capabilityDelegation)", await invoke({ url: `${ROOT}items`, capability: await delegate(ROOT, { signer: remoteZcapSigner({ verificationMethod: `${user.did}#key-0`, signBytes: m => user.backend.sign(SUB_ORG, user.author.address, m) }) }) }), false);
check("expired zCap (expired an hour ago)", await invoke({ url: `${ROOT}items`, capability: await delegate(ROOT, { now: Date.now() - 30 * 24 * 3600 * 1000, expires: new Date(Date.now() - 3600 * 1000) }) }), false);
check("replayed request (verifier clock 31 days on)", await invoke({ url: `${ROOT}items`, capability: zcap, mutate: { query: `?spikeNow=${Math.floor(Date.now() / 1000) + 31 * 24 * 3600}` } }), false);
check("zCap longer than the 31-day TTL cap", await invoke({ url: `${ROOT}items`, capability: await delegate(ROOT, { expires: new Date(Date.now() + 365 * 24 * 3600 * 1000) }) }), false);
const narrowed = await delegate(`${ROOT}lists/abc/`);
check("narrowed zCap used inside its target", await invoke({ url: `${ROOT}lists/abc/items`, capability: narrowed }), true);
check("narrowed zCap used outside its target", await invoke({ url: `${ROOT}lists/xyz/items`, capability: narrowed }), false);

console.log(results.every(Boolean) ? "\nGATE 2: PASS" : "\nGATE 2: FAIL");
process.exit(results.every(Boolean) ? 0 : 1);
