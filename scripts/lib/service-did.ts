/**
 * Building the Boop service did:webvh log (#286 P3, plans/002 D11): genesis
 * and receipt-key rotation, signed by the update key through a
 * `ServiceKeyBackend`. Used by the owner-run scripts/boop-service-did.ts with
 * the Turnkey parent org, and by tests with local keys. Convex never imports
 * this: it can sign receipts, not DID updates, and creates no keys.
 */
import { verifyAsync } from "@noble/ed25519";
import { createDID, updateDID, prepareDataForSigning, MultibaseEncoding, multibaseEncode } from "didwebvh-ts";
import type { DIDLog, SigningInput, SigningOutput } from "didwebvh-ts";
import { base58Encode, ed25519Multikey, parseEd25519PublicKey } from "../../shared/actionRecord";
import {
  RECEIPT_VM_PREFIX, SERVICE_DID_PATH, SERVICE_UPDATE_KEY_PATH, currentReceiptKey, receiptKeyPath, serviceLogProblems,
  type ServiceReceiptKey,
} from "../../shared/serviceDid";
import { turnkeyServiceSigner, type ServiceSigner } from "../../convex/lib/serviceReceipts";
import { turnkeyRequest, type TurnkeyCredentials } from "../../convex/lib/turnkeyApi";

/** The service wallet: Ed25519 keys by derivation path, and raw signing with them. */
export interface ServiceKeyBackend extends ServiceSigner {
  /** Raw public key of the Ed25519 account at `path`, created if the wallet lacks it. */
  keyAt(path: string): Promise<Uint8Array>;
}

const serialize = (log: DIDLog) => log.map(entry => JSON.stringify(entry)).join("\n");
const parse = (jsonl: string): DIDLog => jsonl.split("\n").filter(line => line.trim()).map(line => JSON.parse(line));

const verifier = {
  verify: (signature: Uint8Array, message: Uint8Array, publicKey: Uint8Array) =>
    verifyAsync(signature, message, publicKey.length === 33 ? publicKey.slice(1) : publicKey),
};

/** didwebvh-ts signer for log entries, backed by the update key. Every signature is checked before use. */
function updateSigner(backend: ServiceKeyBackend, updateKey: Uint8Array) {
  return {
    async sign(input: SigningInput): Promise<SigningOutput> {
      const payload = await prepareDataForSigning(input.document as Record<string, unknown>, input.proof);
      const signature = await backend.sign(updateKey, payload);
      if (!(await verifyAsync(signature, payload, updateKey).catch(() => false))) {
        throw new Error("The update key's signature does not verify");
      }
      return { proofValue: multibaseEncode(signature, MultibaseEncoding.BASE58_BTC) };
    },
    getVerificationMethodId: () => `did:key:${ed25519Multikey(updateKey)}`,
    ...verifier,
  };
}

export type ServiceDidLog = ServiceReceiptKey & { jsonl: string };

function checked(log: DIDLog): ServiceDidLog {
  const jsonl = serialize(log);
  const problems = serviceLogProblems(jsonl);
  if (problems.length > 0) throw new Error(`Not a Boop service DID: ${problems.join("; ")}`);
  return { ...(currentReceiptKey(jsonl) as ServiceReceiptKey), jsonl };
}

/** Genesis: updateKeys = [update key], assertionMethod = [#receipt-1]. */
export async function mintServiceDid(backend: ServiceKeyBackend, options: { domain: string }): Promise<ServiceDidLog> {
  const updateKey = await backend.keyAt(SERVICE_UPDATE_KEY_PATH);
  const receiptKey = await backend.keyAt(receiptKeyPath(1));
  // didwebvh-ts replaces {SCID} throughout the genesis entry; the domain is percent-encoded as in the DID.
  const controller = `did:webvh:{SCID}:${encodeURIComponent(options.domain)}:${SERVICE_DID_PATH}`;
  const signer = updateSigner(backend, updateKey);
  const result = await createDID({
    domain: options.domain, signer, verifier: signer, updateKeys: [ed25519Multikey(updateKey)],
    paths: [SERVICE_DID_PATH], portable: false,
    verificationMethods: [{ id: `#${RECEIPT_VM_PREFIX}1`, type: "Multikey", controller, publicKeyMultibase: ed25519Multikey(receiptKey) }],
    // didwebvh-ts lists a method with no purpose under authentication unless told otherwise.
    authentication: [], assertionMethod: [`#${RECEIPT_VM_PREFIX}1`],
  });
  return checked(result.log);
}

/**
 * A new version whose only key is the next receipt key, `#receipt-<n+1>`,
 * signed by the update key. Earlier receipts keep verifying: they name the
 * version they were signed under.
 */
export async function rotateServiceDid(backend: ServiceKeyBackend, jsonl: string): Promise<ServiceDidLog> {
  const current = currentReceiptKey(jsonl);
  if ("problems" in current) throw new Error(`Not a Boop service DID: ${current.problems.join("; ")}`);
  const updateKey = await backend.keyAt(SERVICE_UPDATE_KEY_PATH);
  const next = current.number + 1;
  const receiptKey = await backend.keyAt(receiptKeyPath(next));
  const signer = updateSigner(backend, updateKey);
  const result = await updateDID({
    log: parse(jsonl), signer, verifier: signer, updateKeys: [ed25519Multikey(updateKey)],
    verificationMethods: [{ id: `#${RECEIPT_VM_PREFIX}${next}`, type: "Multikey", controller: current.did, publicKeyMultibase: ed25519Multikey(receiptKey) }],
    authentication: [], assertionMethod: [`#${RECEIPT_VM_PREFIX}${next}`],
  });
  return checked(result.log);
}

type Activity<T> = { activity?: { status?: string; result?: T } };
type Account = { curve?: string; path?: string; address?: string; addressFormat?: string };

/**
 * The service wallet in the Turnkey parent org. Needs credentials that may
 * create a wallet and wallet accounts and sign with the update key: the
 * owner's, never the ones Convex holds. With no `walletId`, the first key
 * creates a wallet and `walletId()` then names it.
 * UNVALIDATED against the live Turnkey API.
 */
export function turnkeyServiceKeyBackend(
  credentials: TurnkeyCredentials,
  options: { walletId?: string; walletName?: string; fetchImpl?: typeof fetch } = {},
): ServiceKeyBackend & { walletId(): string | undefined } {
  const fetchImpl = options.fetchImpl ?? fetch;
  let walletId = options.walletId;
  const account = (path: string) => ({ curve: "CURVE_ED25519", pathFormat: "PATH_FORMAT_BIP32", path, addressFormat: "ADDRESS_FORMAT_SOLANA" });
  const submit = async <T>(endpoint: string, type: string, parameters: Record<string, unknown>): Promise<T> => {
    const response = await turnkeyRequest<Activity<T>>(endpoint, {
      type, timestampMs: Date.now().toString(), organizationId: credentials.organizationId, parameters,
    }, credentials, fetchImpl);
    if (response.activity?.status !== "ACTIVITY_STATUS_COMPLETED" || !response.activity.result) {
      throw new Error(`Turnkey did not complete ${type} (${response.activity?.status ?? "no activity"})`);
    }
    return response.activity.result;
  };
  const publicKey = (address: string | undefined) => {
    const key = address ? parseEd25519PublicKey(address) : null;
    if (!key) throw new Error("Turnkey returned no Solana-format Ed25519 address");
    return key;
  };
  return {
    walletId: () => walletId,
    async keyAt(path) {
      if (!walletId) {
        const created = await submit<{ createWalletResult?: { walletId?: string; addresses?: string[] } }>(
          "/public/v1/submit/create_wallet", "ACTIVITY_TYPE_CREATE_WALLET",
          { walletName: options.walletName ?? "boop-service-did", accounts: [account(path)] });
        walletId = created.createWalletResult?.walletId;
        if (!walletId) throw new Error("Turnkey returned no wallet ID");
        return publicKey(created.createWalletResult?.addresses?.[0]);
      }
      const { accounts } = await turnkeyRequest<{ accounts?: Account[] }>(
        "/public/v1/query/list_wallet_accounts", { organizationId: credentials.organizationId, walletId }, credentials, fetchImpl);
      const existing = (accounts ?? []).find(a => a.curve === "CURVE_ED25519" && a.path === path && a.addressFormat === "ADDRESS_FORMAT_SOLANA");
      if (existing) return publicKey(existing.address);
      const created = await submit<{ createWalletAccountsResult?: { addresses?: string[] } }>(
        "/public/v1/submit/create_wallet_accounts", "ACTIVITY_TYPE_CREATE_WALLET_ACCOUNTS", { walletId, accounts: [account(path)] });
      return publicKey(created.createWalletAccountsResult?.addresses?.[0]);
    },
    sign: turnkeyServiceSigner(credentials, fetchImpl).sign,
  };
}

/** The Solana-format address Turnkey knows a key by. */
export const turnkeyAddress = (publicKeyMultibase: string) => base58Encode(parseEd25519PublicKey(publicKeyMultibase)!);
