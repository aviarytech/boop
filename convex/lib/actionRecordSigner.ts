/** Signing orchestration, free of Turnkey and Node imports so tests can drive
 * it with a real keypair behind a stubbed client. */
import type { ActionCtx } from "../_generated/server";
import type { Id } from "../_generated/dataModel";
import { internal } from "../_generated/api";
import {
  actionRecordDigest, actionRecordSigningInput, canonicalize, ed25519Multikey,
  encodeSignature, parseActionRecordPayload, verifyActionSignature,
} from "../../shared/actionRecord";

export type SigningKey = { publicKey: Uint8Array; sign: (message: Uint8Array) => Promise<Uint8Array> };
export type ResolveSigningKey = (turnkeySubOrgId: string) => Promise<SigningKey>;

type Pending = {
  recordId: Id<"actionRecords">; payload: string; digest: string;
  ownerUserId: Id<"users">; ownerDid?: string; turnkeySubOrgId?: string;
};
type Outcome =
  | { kind: "signed"; recordId: Id<"actionRecords">; digest: string; signature: string; publicKeyMultibase: string; verificationMethod: string }
  | { kind: "unsigned"; recordId: Id<"actionRecords"> }
  | { kind: "failed"; recordId: Id<"actionRecords">; reason: string; retry: boolean };

function isIntact(record: Pending): boolean {
  try {
    return canonicalize(JSON.parse(record.payload)) === record.payload
      && actionRecordDigest(record.payload) === record.digest;
  } catch {
    return false;
  }
}

async function signOne(record: Pending, keyFor: ResolveSigningKey): Promise<Outcome> {
  const { recordId } = record;
  const fail = (reason: string, retry: boolean): Outcome => ({ kind: "failed", recordId, reason, retry });

  // Sign only bytes that are still exactly what the mutation persisted.
  const payload = isIntact(record) ? parseActionRecordPayload(record.payload) : null;
  if (!payload) return fail("payload_integrity", false);
  // The key must belong to the account the payload names, under the DID it names.
  if (payload.owner.userId !== record.ownerUserId || payload.owner.did !== record.ownerDid) {
    return fail("owner_binding_changed", false);
  }
  if (!record.turnkeySubOrgId) return { kind: "unsigned", recordId };

  let key: SigningKey;
  try { key = await keyFor(record.turnkeySubOrgId); } catch { return fail("signing_key_unavailable", true); }
  let signature: Uint8Array;
  try { signature = await key.sign(actionRecordSigningInput(record.payload)); } catch { return fail("signing_request_failed", true); }
  // Never store a signature this deployment could not itself verify.
  if (!await verifyActionSignature(record.payload, signature, key.publicKey)) return fail("signature_invalid", true);

  const publicKeyMultibase = ed25519Multikey(key.publicKey);
  return {
    kind: "signed", recordId, digest: record.digest, signature: encodeSignature(signature),
    publicKeyMultibase, verificationMethod: `did:key:${publicKeyMultibase}#${publicKeyMultibase}`,
  };
}

export async function signActionRecords(
  ctx: Pick<ActionCtx, "runQuery" | "runMutation">,
  recordIds: Id<"actionRecords">[],
  resolveKey: ResolveSigningKey,
): Promise<void> {
  const pending: Pending[] = await ctx.runQuery(internal.actionRecords.loadForSigning, { recordIds });
  // One key lookup per owner per run; a failed lookup fails that owner's records alike.
  const keys = new Map<string, Promise<SigningKey>>();
  const keyFor: ResolveSigningKey = (subOrgId) => {
    if (!keys.has(subOrgId)) keys.set(subOrgId, resolveKey(subOrgId));
    return keys.get(subOrgId)!;
  };

  const unsettled: Outcome[] = [];
  for (const record of pending) {
    const outcome = await signOne(record, keyFor);
    // Store each signature as it arrives so a later failure cannot lose it.
    if (outcome.kind === "signed") await ctx.runMutation(internal.actionRecords.settle, { outcomes: [outcome] });
    else unsettled.push(outcome);
  }
  if (unsettled.length > 0) {
    // Reason codes only: provider errors may carry identifiers we do not log.
    console.warn("[actionRecords] not signed:", unsettled.map(o => `${o.recordId}:${o.kind === "failed" ? o.reason : o.kind}`).join(","));
    await ctx.runMutation(internal.actionRecords.settle, { outcomes: unsettled });
  }
}
