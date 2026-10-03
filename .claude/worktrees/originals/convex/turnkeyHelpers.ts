"use node";

/**
 * Shared Turnkey wallet lookup helpers.
 *
 * Provides wallet-account resolution logic for DID creation flows.
 */

import { createTurnkeyClient } from "./lib/turnkeyClient";

/**
 * Look up the first Ed25519 wallet account for a Turnkey sub-org.
 *
 * Returns the Turnkey client, the Ed25519 account, and a convenience
 * `verificationMethodId` string (`did:key:<address>`).
 */
export async function getEd25519Account(subOrgId: string) {
  const turnkeyClient = createTurnkeyClient();

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
