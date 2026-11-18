/**
 * Internal actions for authentication - Web Crypto only implementation.
 *
 * This file implements Turnkey API integration using only Web Crypto APIs,
 * allowing it to run in Convex's V8 isolate without Node.js.
 */

import { internalAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import { signSessionToken, WEB_SESSION_SECONDS } from "./lib/sessionTokens";
import { bytesToHex, getTurnkeyCredentials, turnkeyRequest, TurnkeyApiError, type TurnkeyCredentials } from "./lib/turnkeyApi";

// ============================================================================
// Turnkey API Methods
// ============================================================================

interface CreateSubOrgResponse {
  activity: {
    result: {
      createSubOrganizationResultV8: {
        subOrganizationId: string;
      };
    };
  };
}

interface InitOtpResponse {
  activity: {
    result: {
      initOtpResultV2: {
        otpId: string;
        otpEncryptionTargetBundle: string;
      };
    };
  };
}

interface VerifyOtpResponse {
  activity: {
    result: {
      verifyOtpResult: {
        verificationToken: string;
      };
    };
  };
}

async function createSubOrganization(
  email: string,
  credentials: TurnkeyCredentials
): Promise<string> {
  const subOrgName = `user-${email.replace(/[^a-z0-9]/gi, "-").toLowerCase()}-${Date.now()}`;

  const response = await turnkeyRequest<CreateSubOrgResponse>(
    "/public/v1/submit/create_sub_organization",
    {
      type: "ACTIVITY_TYPE_CREATE_SUB_ORGANIZATION_V8",
      timestampMs: Date.now().toString(),
      organizationId: credentials.organizationId,
      parameters: {
        subOrganizationName: subOrgName,
        rootUsers: [
          {
            userName: email,
            userEmail: email,
            apiKeys: [],
            authenticators: [],
            oauthProviders: [],
          },
        ],
        rootQuorumThreshold: 1,
        // Only email OTP (completed by the user's own client key) may log in.
        // EMAIL_AUTH and email recovery let the parent choose the target key,
        // so they would let this backend obtain a session. See
        // docs/turnkey-custody.md.
        disableEmailAuth: true,
        disableEmailRecovery: true,
        disableSmsAuth: true,
        wallet: {
          walletName: "default-wallet",
          accounts: [
            {
              curve: "CURVE_SECP256K1",
              pathFormat: "PATH_FORMAT_BIP32",
              path: "m/44'/0'/0'/0/0",
              addressFormat: "ADDRESS_FORMAT_ETHEREUM",
            },
            {
              curve: "CURVE_ED25519",
              pathFormat: "PATH_FORMAT_BIP32",
              path: "m/44'/501'/0'/0'",
              addressFormat: "ADDRESS_FORMAT_SOLANA",
            },
            {
              curve: "CURVE_ED25519",
              pathFormat: "PATH_FORMAT_BIP32",
              path: "m/44'/501'/1'/0'",
              addressFormat: "ADDRESS_FORMAT_SOLANA",
            },
          ],
        },
      },
    },
    credentials
  );

  const subOrgId = response.activity?.result?.createSubOrganizationResultV8?.subOrganizationId;
  if (!subOrgId) {
    throw new Error("No sub-organization ID returned from Turnkey");
  }
  return subOrgId;
}

async function initOtp(
  email: string,
  credentials: TurnkeyCredentials
): Promise<{ otpId: string; otpEncryptionTargetBundle: string }> {
  // Generate user identifier from email hash
  const emailBytes = new TextEncoder().encode(email);
  const hashBuffer = await crypto.subtle.digest("SHA-256", emailBytes);
  const userIdentifier = bytesToHex(new Uint8Array(hashBuffer));

  const response = await turnkeyRequest<InitOtpResponse>(
    "/public/v1/submit/init_otp",
    {
      type: "ACTIVITY_TYPE_INIT_OTP_V3",
      timestampMs: Date.now().toString(),
      organizationId: credentials.organizationId,
      parameters: {
        otpType: "OTP_TYPE_EMAIL",
        contact: email,
        userIdentifier,
        appName: "Originals",
        otpLength: 6,
        alphanumeric: false,
      },
    },
    credentials
  );

  const result = response.activity?.result?.initOtpResultV2;
  if (!result?.otpId || !result.otpEncryptionTargetBundle) {
    throw new Error("No OTP ID returned from Turnkey");
  }
  return { otpId: result.otpId, otpEncryptionTargetBundle: result.otpEncryptionTargetBundle };
}

/**
 * Relays the client's encrypted OTP bundle (VERIFY_OTP_V2).
 *
 * The bundle is HPKE-encrypted to Turnkey's enclave and carries the code with
 * the client's session public key, so this backend never sees the code. The
 * returned verification token is bound to that client key: only the client can
 * turn it into a Turnkey session, never this backend.
 */
async function verifyOtp(
  otpId: string,
  encryptedOtpBundle: string,
  credentials: TurnkeyCredentials
): Promise<string> {
  const response = await turnkeyRequest<VerifyOtpResponse>(
    "/public/v1/submit/verify_otp",
    {
      type: "ACTIVITY_TYPE_VERIFY_OTP_V2",
      timestampMs: Date.now().toString(),
      organizationId: credentials.organizationId,
      parameters: {
        otpId,
        encryptedOtpBundle,
        expirationSeconds: "900", // 15 minutes to complete the client login
      },
    },
    credentials
  );

  const verificationToken = response.activity?.result?.verifyOtpResult?.verificationToken;
  if (!verificationToken) {
    throw new Error("OTP verification failed - no token returned");
  }
  return verificationToken;
}

// ============================================================================
// JWT Functions
// ============================================================================

function buildCookieValue(token: string): string {
  const isProduction = process.env.NODE_ENV === "production";
  const maxAgeSeconds = WEB_SESSION_SECONDS;

  return (
    `auth_token=${token}; ` +
    `HttpOnly; ` +
    `Path=/; ` +
    `Max-Age=${maxAgeSeconds}; ` +
    `SameSite=Strict` +
    (isProduction ? "; Secure" : "")
  );
}

function buildLogoutCookieValue(): string {
  const isProduction = process.env.NODE_ENV === "production";

  return (
    `auth_token=; ` +
    `HttpOnly; ` +
    `Path=/; ` +
    `Max-Age=0; ` +
    `SameSite=Strict` +
    (isProduction ? "; Secure" : "")
  );
}

// ============================================================================
// Exported Internal Actions
// ============================================================================

/**
 * Initiate email authentication - sends OTP to user.
 *
 * Returns Turnkey's enclave encryption target. The client encrypts the code to
 * it together with its own session public key, so the code never passes
 * through this backend in the clear.
 */
export const initiateAuth = internalAction({
  args: {
    email: v.string(),
  },
  handler: async (ctx, args): Promise<{
    sessionId: string;
    message: string;
    otpEncryptionTargetBundle: string;
    session: {
      email: string;
      subOrgId?: string;
      otpId: string;
    };
  }> => {
    const credentials = getTurnkeyCredentials();

    console.log(`[authInternal] Initiating auth for: ${args.email}`);

    // The parent Turnkey organization is shared with other apps. Only Boop's
    // saved account link identifies a returning user; a global email search does not.
    // New accounts get a sub-org only after the email is verified (verifyAuth).
    const account = await ctx.runQuery(internal.auth.getLoginAccount, { email: args.email });

    // Send OTP
    console.log(`[authInternal] Sending OTP to ${args.email}...`);
    const { otpId, otpEncryptionTargetBundle } = await initOtp(args.email, credentials);
    console.log(`[authInternal] OTP sent! OTP ID: ${otpId}`);

    // Generate session ID
    const sessionId = `session_${Date.now()}_${Math.random().toString(36).substring(2, 15)}`;

    return {
      sessionId,
      message: "Verification code sent to your email. Check your inbox!",
      otpEncryptionTargetBundle,
      session: {
        email: args.email,
        subOrgId: account?.turnkeySubOrgId,
        otpId,
      },
    };
  },
});

/**
 * Verify the client's encrypted OTP bundle and return authentication result.
 *
 * The verification token is bound to the client's Turnkey session key; the
 * client completes the Turnkey login itself (STAMP_LOGIN) with it.
 */
export const verifyAuth = internalAction({
  args: {
    sessionId: v.string(),
    encryptedOtpBundle: v.string(),
    session: v.object({
      email: v.string(),
      subOrgId: v.optional(v.string()),
      otpId: v.string(),
      timestamp: v.number(),
      verified: v.boolean(),
    }),
  },
  handler: async (ctx, args): Promise<{
    verified: boolean;
    email?: string;
    subOrgId?: string;
    verificationToken?: string;
  }> => {
    const credentials = getTurnkeyCredentials();

    // Recheck sessions initiated before a repair or a competing signup. Do this
    // before consuming the OTP, and never silently retarget a pending session.
    const account = await ctx.runQuery(internal.auth.getLoginAccount, { email: args.session.email });
    if (args.session.subOrgId && account?.turnkeySubOrgId !== args.session.subOrgId) {
      throw new Error("Your account changed. Please request a new code.");
    }

    console.log(`[authInternal] Verifying OTP for session: ${args.sessionId}`);

    let verificationToken: string;
    try {
      verificationToken = await verifyOtp(args.session.otpId, args.encryptedOtpBundle, credentials);
    } catch (error) {
      console.error(`[authInternal] OTP verification failed:`, error);
      // Turnkey answers a wrong/expired code with 400; 401/403/5xx are our config or their outage.
      if (error instanceof TurnkeyApiError && error.status === 400) {
        return { verified: false };
      }
      throw error;
    }
    console.log(`[authInternal] OTP verified successfully!`);

    // The email is now verified, so a new account may get its sub-org. A
    // competing signup that finished meanwhile is resolved by upsertUserInternal.
    const subOrgId = args.session.subOrgId ?? account?.turnkeySubOrgId
      ?? await createSubOrganization(args.session.email, credentials);

    return {
      verified: true,
      email: args.session.email,
      subOrgId,
      verificationToken,
    };
  },
});

/**
 * Sign a JWT token for authenticated user.
 */
export const createAuthToken = internalAction({
  args: {
    subOrgId: v.string(),
    email: v.string(),
    persistentMobile: v.optional(v.boolean()),
  },
  handler: async (_ctx, args): Promise<{
    token: string;
    cookieValue: string;
  }> => {
    const token = await signSessionToken(args.subOrgId, args.email, args.persistentMobile);
    // Native clients persist the bearer token; do not leave a persistent web cookie.
    const cookieValue = args.persistentMobile ? buildLogoutCookieValue() : buildCookieValue(token);

    return { token, cookieValue };
  },
});

/**
 * Get logout cookie value.
 */
export const getLogoutCookie = internalAction({
  args: {},
  handler: async (): Promise<{ cookieValue: string }> => {
    return { cookieValue: buildLogoutCookieValue() };
  },
});

/**
 * The Ed25519 accounts in a user's sub-org: `{ path, address }`, where a
 * Solana-format address is the base58 public key (#286 PR b).
 *
 * Read-only. The parent org can read its sub-orgs but cannot stamp activities
 * in them, so this lets the server check that an author DID's keys are the
 * account's own Turnkey keys without being able to use them. Queries are not
 * activities, so no policy governs them.
 */
export const listSubOrgEd25519Accounts = internalAction({
  args: { subOrgId: v.string() },
  handler: async (_ctx, args): Promise<Array<{ path: string; address: string }>> => {
    const credentials = getTurnkeyCredentials();
    const { wallets } = await turnkeyRequest<{ wallets: Array<{ walletId: string }> }>(
      "/public/v1/query/list_wallets", { organizationId: args.subOrgId }, credentials);
    const accounts: Array<{ path: string; address: string }> = [];
    for (const wallet of wallets ?? []) {
      const response = await turnkeyRequest<{ accounts: Array<{ curve: string; path: string; address: string }> }>(
        "/public/v1/query/list_wallet_accounts", { organizationId: args.subOrgId, walletId: wallet.walletId }, credentials);
      for (const account of response.accounts ?? []) {
        if (account.curve === "CURVE_ED25519") accounts.push({ path: account.path, address: account.address });
      }
    }
    return accounts;
  },
});
