"use node";

/**
 * Shared Turnkey wallet lookup helpers.
 *
 * Provides wallet-account resolution logic for DID creation flows.
 */

import { bytesToHex, hexToBytes } from "@noble/hashes/utils.js";
import { createTurnkeyClient } from "./lib/turnkeyClient";
import type { SigningKey } from "./lib/actionRecordSigner";
import { parseEd25519PublicKey } from "../shared/actionRecord";

type TurnkeyClient = ReturnType<typeof createTurnkeyClient>;

/**
 * Look up the first Ed25519 wallet account for a Turnkey sub-org.
 *
 * Returns the Turnkey client, the Ed25519 account, and a convenience
 * `verificationMethodId` string (`did:key:<address>`).
 */
export async function getEd25519Account(
  subOrgId: string,
  turnkeyClient: TurnkeyClient = createTurnkeyClient()
) {

  // Get wallets for the sub-org
  const walletsResponse = await turnkeyClient.apiClient().getWallets({
    organizationId: subOrgId,
  });
  const wallets = walletsResponse.wallets;
  if (!wallets || wallets.length === 0) {
    throw new Error("No wallets found for sub-org");
  }

  // Use the typed SDK client directly.
  const accountsResponse = await turnkeyClient.apiClient().getWalletAccounts({
    organizationId: subOrgId,
    walletId: wallets[0].walletId,
  });
  const accounts = accountsResponse.accounts;
  if (!accounts || accounts.length === 0) {
    throw new Error("No wallet accounts found for sub-org");
  }

  // Find the first Ed25519 account (Solana address = base58 public key)
  const ed25519Account = accounts.find((a) => a.curve === "CURVE_ED25519");
  if (!ed25519Account) {
    throw new Error("No Ed25519 account found in wallet");
  }

  const signingOrganizationId = ed25519Account.organizationId || subOrgId;
  if (signingOrganizationId !== subOrgId) {
    console.warn(
      `[turnkeyHelpers] Requested org ${subOrgId} but selected account belongs to ${signingOrganizationId}. Using account organization for signing.`
    );
  }
  const address = ed25519Account.address;
  const verificationMethodId = `did:key:${address}`;

  return {
    turnkeyClient,
    address,
    verificationMethodId,
    signingOrganizationId,
  };
}

/**
 * The sub-org's Ed25519 key as a raw signer, for action records. Same
 * server-initiated signRawPayload call the did:webvh signer makes.
 */
export async function turnkeySigningKey(
  subOrgId: string,
  turnkeyClient: TurnkeyClient = createTurnkeyClient()
): Promise<SigningKey> {
  const { address, signingOrganizationId } = await getEd25519Account(subOrgId, turnkeyClient);
  // A Turnkey Ed25519 (Solana-format) address is the base58 public key itself.
  const publicKey = parseEd25519PublicKey(address);
  if (!publicKey) throw new Error("Turnkey Ed25519 address is not a public key");

  return {
    publicKey,
    sign: async (message) => {
      const result = await turnkeyClient.apiClient().signRawPayload({
        organizationId: signingOrganizationId,
        signWith: address,
        payload: `0x${bytesToHex(message)}`,
        encoding: "PAYLOAD_ENCODING_HEXADECIMAL",
        hashFunction: "HASH_FUNCTION_NO_OP",
      });
      const signRawResult = result.activity?.result?.signRawPayloadResult;
      if (!signRawResult?.r || !signRawResult?.s) {
        throw new Error("No signature returned from Turnkey");
      }
      const signature = hexToBytes((signRawResult.r + signRawResult.s).replace(/^0x/, ""));
      if (signature.length !== 64) {
        throw new Error(`Invalid Ed25519 signature length: ${signature.length} (expected 64 bytes)`);
      }
      return signature;
    },
  };
}
