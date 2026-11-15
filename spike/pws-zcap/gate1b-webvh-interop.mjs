// THROWAWAY spike code (#286). Gate 1, second half: is a boop did:webvh
// accepted by the resolver the PWS stack uses (@interop/did-method-webvh), and
// can the capabilityDelegation update be written cleanly?
//
//   bun gate1b-webvh-interop.mjs
import assert from "node:assert/strict";
import * as interop from "@interop/did-method-webvh";
import { resolveDIDFromLog } from "didwebvh-ts";
import { authorDidProblems } from "../../shared/authorDid.ts";
import { mintUserDid, addCapabilityDelegation } from "./lib/userDid.mjs";

const attempt = async (label, fn) => {
  try { const value = await fn(); console.log(`OK   ${label}`); return value; }
  catch (error) { console.log(`FAIL ${label}\n     ${String(error?.message ?? error).split("\n")[0]}`); return null; }
};

const user = await mintUserDid();

// 1. A boop log (didwebvh-ts 2.8.0) through the interop resolver, offline.
const genesis = await attempt("interop resolver accepts boop's genesis log (didwebvh-ts 2.8.0)", async () => {
  const r = await interop.resolveDIDFromLog(user.genesis.log, { verifier: user.signer, network: "none" });
  assert.equal(r.did, user.did);
  return r;
});

// 2. The update written with didwebvh-ts 2.8.0 (leaks `purpose` into the method).
const leaky = await addCapabilityDelegation(user);
console.log("     didwebvh-ts 2.8.0 update leaves on #orig-1:", JSON.stringify(Object.keys(leaky.doc.verificationMethod[1])));
await attempt("interop resolver accepts the didwebvh-ts-written update", async () => {
  const r = await interop.resolveDIDFromLog(leaky.log, { verifier: user.signer, network: "none" });
  assert.equal(r.meta.versionId, leaky.versionId);
});

// 3. The update written with the interop library's `didDocument` option: the
//    next document exactly as given, nothing merged.
const next = structuredClone(user.genesis.doc);
next.capabilityDelegation = ["#orig-1"];
const clean = await attempt("interop updateDID({ didDocument }) writes a clean update over boop's log", async () => {
  const absolute = structuredClone(next);
  absolute.verificationMethod = absolute.verificationMethod.map(vm => ({ ...vm, id: vm.id.startsWith("#") ? `${user.did}${vm.id}` : vm.id }));
  return interop.updateDID({ log: user.genesis.log, signer: user.signer, verifier: user.signer, updateKeys: [user.author.multikey], didDocument: absolute });
});
if (clean) {
  console.log("     state:", JSON.stringify({ verificationMethod: clean.doc.verificationMethod.map(vm => Object.keys(vm).join("+") + " " + vm.id.replace(user.did, "<did>")), assertionMethod: clean.doc.assertionMethod, capabilityDelegation: clean.doc.capabilityDelegation }));
  const back = await attempt("didwebvh-ts 2.8.0 (boop's resolver) accepts that update", async () => {
    const r = await resolveDIDFromLog(clean.log, { verifier: user.signer });
    assert.equal(r.meta.versionId, clean.log.at(-1).versionId);
    return r;
  });
  if (back) console.log("     authorDidProblems (main):", JSON.stringify(authorDidProblems(back.doc, [user.author.multikey])));
}
void genesis;
