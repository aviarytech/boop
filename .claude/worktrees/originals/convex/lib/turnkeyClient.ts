"use node";

/**
 * Local Turnkey client wrapper.
 *
 * This mirrors the behavior of @originals/auth/server but avoids the
 * extensionless re-export that breaks Convex's module analyzer.
 */

import { Turnkey } from "@turnkey/sdk-server";

interface TurnkeyClientConfig {
  apiPublicKey?: string;
  apiPrivateKey?: string;
  organizationId?: string;
  apiBaseUrl?: string;
}

export function createTurnkeyClient(config?: TurnkeyClientConfig) {
  const apiPublicKey = config?.apiPublicKey ?? process.env.TURNKEY_API_PUBLIC_KEY;
  const apiPrivateKey =
    config?.apiPrivateKey ?? process.env.TURNKEY_API_PRIVATE_KEY;
  const organizationId =
    config?.organizationId ?? process.env.TURNKEY_ORGANIZATION_ID;

  if (!apiPublicKey) {
    throw new Error("TURNKEY_API_PUBLIC_KEY is required");
  }
  if (!apiPrivateKey) {
    throw new Error("TURNKEY_API_PRIVATE_KEY is required");
  }
  if (!organizationId) {
    throw new Error("TURNKEY_ORGANIZATION_ID is required");
  }

  return new Turnkey({
    apiBaseUrl: config?.apiBaseUrl ?? "https://api.turnkey.com",
    apiPublicKey,
    apiPrivateKey,
    defaultOrganizationId: organizationId,
  });
}
