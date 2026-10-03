/**
 * Internal actions for authentication - Web Crypto only implementation.
 *
 * This file implements Turnkey API integration using only Web Crypto APIs,
 * allowing it to run in Convex's V8 isolate without Node.js.
 */

import { internalAction } from "./_generated/server";
import { v } from "convex/values";
import * as jose from "jose";

// ============================================================================
// Turnkey API Configuration
// ============================================================================

const TURNKEY_API_BASE_URL = "https://api.turnkey.com";

/**
 * How long a browser signing session lives. Shorter than the 30-day auth JWT
 * on purpose: a stolen session can sign as the user, while a stolen JWT can
 * only read and write app data. When it lapses mid-session the user stays
 * logged in and their events queue unsigned until the next login refreshes it.
 */
const SIGNING_SESSION_SECONDS = 7 * 24 * 60 * 60;

// ============================================================================
// P-256 Elliptic Curve Constants (for point decompression)
// ============================================================================

const P256_MODULUS = BigInt(
  "115792089210356248762697446949407573530086143415290314195533631308867097853951"
);
const P256_B = BigInt(
  "0x5ac635d8aa3a93e7b3ebbd55769886bc651d06b0cc53b0f63bce3c3e27d2604b"
);

// ============================================================================
// Utility Functions
// ============================================================================

function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.substr(i * 2, 2), 16);
  }
  return bytes;
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function bytesToBase64url(bytes: Uint8Array): string {
  const base64 = btoa(String.fromCharCode(...bytes));
  return base64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
}

function stringToBase64url(str: string): string {
  const bytes = new TextEncoder().encode(str);
  return bytesToBase64url(bytes);
}

// ============================================================================
// P-256 Point Decompression
// ============================================================================

function testBit(n: bigint, i: number): boolean {
  const m = BigInt(1) << BigInt(i);
  return (n & m) !== BigInt(0);
}

function modPow(b: bigint, exp: bigint, p: bigint): bigint {
  if (exp === BigInt(0)) return BigInt(1);
  let result = b;
  const exponentBitString = exp.toString(2);
  for (let i = 1; i < exponentBitString.length; ++i) {
    result = (result * result) % p;
    if (exponentBitString[i] === "1") {
      result = (result * b) % p;
    }
  }
  return result;
}

function modSqrt(x: bigint, p: bigint): bigint {
  const base = x % p;
  // P-256 satisfies p % 4 == 3
  const q = (p + BigInt(1)) >> BigInt(2);
  const squareRoot = modPow(base, q, p);
  if ((squareRoot * squareRoot) % p !== base) {
    throw new Error("Could not find a modular square root");
  }
  return squareRoot;
}

function getY(x: bigint, lsb: boolean): bigint {
  const p = P256_MODULUS;
  const a = p - BigInt(3);
  const rhs = ((x * x + a) * x + P256_B) % p;
  let y = modSqrt(rhs, p);
  if (lsb !== testBit(y, 0)) {
    y = (p - y) % p;
  }
  return y;
}

function integerToByteArray(i: bigint, length: number): Uint8Array {
  const hex = i.toString(16).padStart(length * 2, "0");
  return hexToBytes(hex);
}

function byteArrayToInteger(bytes: Uint8Array): bigint {
  return BigInt("0x" + bytesToHex(bytes));
}

/**
 * Decompress a P-256 compressed public key (33 bytes) to JWK format.
 */
function decompressPublicKey(compressedHex: string): JsonWebKey {
  const point = hexToBytes(compressedHex);
  if (point.length !== 33) {
    throw new Error("Invalid compressed public key length");
  }
  if (point[0] !== 2 && point[0] !== 3) {
    throw new Error("Invalid compressed public key format");
  }

  const lsb = point[0] === 3;
  const x = byteArrayToInteger(point.subarray(1));
  const y = getY(x, lsb);

  return {
    kty: "EC",
    crv: "P-256",
    x: bytesToBase64url(integerToByteArray(x, 32)),
    y: bytesToBase64url(integerToByteArray(y, 32)),
    ext: true,
  };
}

// ============================================================================
// ECDSA Signature Conversion (IEEE P1363 to DER)
// ============================================================================

function toUnsignedBigNum(bytes: Uint8Array): Uint8Array {
  let start = 0;
  while (start < bytes.length && bytes[start] === 0) {
    start++;
  }
  if (start === bytes.length) {
    start = bytes.length - 1;
  }
  let extraZero = 0;
  if ((bytes[start] & 128) === 128) {
    extraZero = 1;
  }
  const res = new Uint8Array(bytes.length - start + extraZero);
  res.set(bytes.subarray(start), extraZero);
  return res;
}

function convertEcdsaIeee1363ToDer(ieee: Uint8Array): Uint8Array {
  if (ieee.length % 2 !== 0 || ieee.length === 0 || ieee.length > 132) {
    throw new Error("Invalid IEEE P1363 signature encoding");
  }
  const r = toUnsignedBigNum(ieee.subarray(0, ieee.length / 2));
  const s = toUnsignedBigNum(ieee.subarray(ieee.length / 2));

  let offset = 0;
  const length = 1 + 1 + r.length + 1 + 1 + s.length;
  let der: Uint8Array;

  if (length >= 128) {
    der = new Uint8Array(length + 3);
    der[offset++] = 48;
    der[offset++] = 128 + 1;
    der[offset++] = length;
  } else {
    der = new Uint8Array(length + 2);
    der[offset++] = 48;
    der[offset++] = length;
  }

  der[offset++] = 2;
  der[offset++] = r.length;
  der.set(r, offset);
  offset += r.length;
  der[offset++] = 2;
  der[offset++] = s.length;
  der.set(s, offset);

  return der;
}

// ============================================================================
// Turnkey API Request Signing
// ============================================================================

interface TurnkeyCredentials {
  apiPublicKey: string;
  apiPrivateKey: string;
  organizationId: string;
}

function getTurnkeyCredentials(): TurnkeyCredentials {
  const apiPublicKey = process.env.TURNKEY_API_PUBLIC_KEY;
  const apiPrivateKey = process.env.TURNKEY_API_PRIVATE_KEY;
  const organizationId = process.env.TURNKEY_ORGANIZATION_ID;

  if (!apiPublicKey || !apiPrivateKey || !organizationId) {
    throw new Error("Missing Turnkey API credentials in environment");
  }

  return { apiPublicKey, apiPrivateKey, organizationId };
}

/**
 * Sign a request body with Turnkey API credentials using Web Crypto.
 */
async function signRequestBody(
  body: string,
  publicKey: string,
  privateKey: string
): Promise<string> {
  // Convert Turnkey API keys to JWK format
  const jwk = decompressPublicKey(publicKey);
  // Add private key component
  jwk.d = bytesToBase64url(hexToBytes(privateKey.padStart(64, "0")));

  // Import as CryptoKey
  const key = await crypto.subtle.importKey(
    "jwk",
    jwk,
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign"]
  );

  // Sign the body
  const signatureBuffer = await crypto.subtle.sign(
    { name: "ECDSA", hash: "SHA-256" },
    key,
    new TextEncoder().encode(body)
  );

  // Convert IEEE P1363 to DER format
  const signatureDer = convertEcdsaIeee1363ToDer(new Uint8Array(signatureBuffer));
  return bytesToHex(signatureDer);
}

/**
 * Create the X-Stamp header value for Turnkey API requests.
 */
async function createStamp(body: string, publicKey: string, privateKey: string): Promise<string> {
  const signature = await signRequestBody(body, publicKey, privateKey);
  const stamp = {
    publicKey,
    scheme: "SIGNATURE_SCHEME_TK_API_P256",
    signature,
  };
  return stringToBase64url(JSON.stringify(stamp));
}

/**
 * Make an authenticated request to the Turnkey API.
 */
async function turnkeyRequest<T>(
  endpoint: string,
  body: Record<string, unknown>,
  credentials: TurnkeyCredentials
): Promise<T> {
  const bodyStr = JSON.stringify(body);
  const stamp = await createStamp(bodyStr, credentials.apiPublicKey, credentials.apiPrivateKey);

  const response = await fetch(`${TURNKEY_API_BASE_URL}${endpoint}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Stamp": stamp,
    },
    body: bodyStr,
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Turnkey API error ${response.status}: ${errorText}`);
  }

  return response.json();
}

// ============================================================================
// Turnkey API Methods
// ============================================================================

interface GetSubOrgIdsResponse {
  organizationIds: string[];
}

interface CreateSubOrgResponse {
  activity: {
    result: {
      createSubOrganizationResultV7: {
        subOrganizationId: string;
      };
    };
  };
}

interface InitOtpResponse {
  activity: {
    result: {
      initOtpResult: {
        otpId: string;
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

interface ListUsersResponse {
  users: Array<{ userId: string; userName?: string }>;
}

interface ListWalletsResponse {
  wallets: Array<{ walletId: string }>;
}

interface ListWalletAccountsResponse {
  accounts: Array<{ address: string; curve: string; addressFormat?: string }>;
}

interface CreateReadWriteSessionResponse {
  activity: {
    result: {
      createReadWriteSessionResultV2: {
        userId: string;
        apiKeyId: string;
        /** HPKE-encrypted to targetPublicKey; only the browser can open it. */
        credentialBundle: string;
      };
    };
  };
}

async function getSubOrgIds(
  email: string,
  credentials: TurnkeyCredentials
): Promise<string[]> {
  const response = await turnkeyRequest<GetSubOrgIdsResponse>(
    "/public/v1/query/list_suborgs",
    {
      organizationId: credentials.organizationId,
      filterType: "EMAIL",
      filterValue: email,
    },
    credentials
  );
  return response.organizationIds || [];
}

async function createSubOrganization(
  email: string,
  credentials: TurnkeyCredentials
): Promise<string> {
  const subOrgName = `user-${email.replace(/[^a-z0-9]/gi, "-").toLowerCase()}-${Date.now()}`;

  const response = await turnkeyRequest<CreateSubOrgResponse>(
    "/public/v1/submit/create_sub_organization",
    {
      type: "ACTIVITY_TYPE_CREATE_SUB_ORGANIZATION_V7",
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

  const subOrgId = response.activity?.result?.createSubOrganizationResultV7?.subOrganizationId;
  if (!subOrgId) {
    throw new Error("No sub-organization ID returned from Turnkey");
  }
  return subOrgId;
}

async function getOrCreateSubOrg(
  email: string,
  credentials: TurnkeyCredentials
): Promise<string> {
  console.log(`[authInternal] Checking for existing sub-org for ${email}...`);

  try {
    const subOrgIds = await getSubOrgIds(email, credentials);
    if (subOrgIds.length > 0) {
      console.log(`[authInternal] Found existing sub-org: ${subOrgIds[0]}`);
      return subOrgIds[0];
    }
  } catch {
    console.log(`[authInternal] No existing sub-org found, will create new one`);
  }

  console.log(`[authInternal] Creating new sub-org for ${email}...`);
  const subOrgId = await createSubOrganization(email, credentials);
  console.log(`[authInternal] Created sub-org: ${subOrgId}`);
  return subOrgId;
}

async function initOtp(
  email: string,
  credentials: TurnkeyCredentials
): Promise<string> {
  // Generate user identifier from email hash
  const emailBytes = new TextEncoder().encode(email);
  const hashBuffer = await crypto.subtle.digest("SHA-256", emailBytes);
  const userIdentifier = bytesToHex(new Uint8Array(hashBuffer));

  const response = await turnkeyRequest<InitOtpResponse>(
    "/public/v1/submit/init_otp",
    {
      type: "ACTIVITY_TYPE_INIT_OTP",
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

  const otpId = response.activity?.result?.initOtpResult?.otpId;
  if (!otpId) {
    throw new Error("No OTP ID returned from Turnkey");
  }
  return otpId;
}

async function verifyOtp(
  otpId: string,
  otpCode: string,
  credentials: TurnkeyCredentials
): Promise<string> {
  const response = await turnkeyRequest<VerifyOtpResponse>(
    "/public/v1/submit/verify_otp",
    {
      type: "ACTIVITY_TYPE_VERIFY_OTP",
      timestampMs: Date.now().toString(),
      organizationId: credentials.organizationId,
      parameters: {
        otpId,
        otpCode,
        expirationSeconds: "900", // 15 minutes
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

/**
 * Sub-orgs are created with exactly one root user and no credentials of their
 * own, so the session has to be minted for that user by the parent org.
 */
async function getSubOrgRootUserId(
  subOrgId: string,
  credentials: TurnkeyCredentials
): Promise<string> {
  const response = await turnkeyRequest<ListUsersResponse>(
    "/public/v1/query/list_users",
    { organizationId: subOrgId },
    credentials
  );

  const userId = response.users?.[0]?.userId;
  if (!userId) {
    throw new Error(`No users found in sub-organization ${subOrgId}`);
  }
  return userId;
}

/**
 * The Ed25519 account address backing every DID and CEL proof this user makes.
 *
 * Returned to the browser with the session so it can derive its Multikey
 * without a second round-trip. Note this is a Solana-format address (base58 of
 * the raw public key), NOT a Multikey — see turnkeyAddressToMultikey.
 */
async function getEd25519Address(
  subOrgId: string,
  credentials: TurnkeyCredentials
): Promise<string> {
  const wallets = await turnkeyRequest<ListWalletsResponse>(
    "/public/v1/query/list_wallets",
    { organizationId: subOrgId },
    credentials
  );

  const walletId = wallets.wallets?.[0]?.walletId;
  if (!walletId) {
    throw new Error(`No wallets found for sub-organization ${subOrgId}`);
  }

  const accounts = await turnkeyRequest<ListWalletAccountsResponse>(
    "/public/v1/query/list_wallet_accounts",
    { organizationId: subOrgId, walletId },
    credentials
  );

  const address = accounts.accounts?.find((a) => a.curve === "CURVE_ED25519")?.address;
  if (!address) {
    throw new Error(`No Ed25519 account in sub-organization ${subOrgId}`);
  }
  return address;
}

/**
 * Mint a browser signing session: a short-lived API key inside the user's
 * sub-org, encrypted to a public key only the browser holds.
 *
 * This is what lets the browser sign CEL events and DID logs directly — one
 * Turnkey round-trip instead of a Convex hop plus a Turnkey round-trip — while
 * the user's Ed25519 key itself never leaves Turnkey.
 *
 * V2 rather than STAMP_LOGIN: STAMP_LOGIN infers the user from whoever stamped
 * the request, which here is the PARENT org's API key, so the session would be
 * bound to the wrong user. V2 takes an explicit userId.
 */
async function createReadWriteSession(
  subOrgId: string,
  userId: string,
  targetPublicKey: string,
  expirationSeconds: number,
  credentials: TurnkeyCredentials
): Promise<string> {
  const response = await turnkeyRequest<CreateReadWriteSessionResponse>(
    "/public/v1/submit/create_read_write_session",
    {
      type: "ACTIVITY_TYPE_CREATE_READ_WRITE_SESSION_V2",
      timestampMs: Date.now().toString(),
      organizationId: subOrgId,
      parameters: {
        targetPublicKey,
        userId,
        apiKeyName: `boop-signing-${Date.now()}`,
        expirationSeconds: expirationSeconds.toString(),
        // Each login supersedes the last, so a lost device stops signing.
        invalidateExisting: true,
      },
    },
    credentials
  );

  const bundle =
    response.activity?.result?.createReadWriteSessionResultV2?.credentialBundle;
  if (!bundle) {
    throw new Error("No credential bundle returned from Turnkey");
  }
  return bundle;
}

// ============================================================================
// JWT Functions
// ============================================================================

async function signJwtToken(subOrgId: string, email: string): Promise<string> {
  const jwtSecret = process.env.JWT_SECRET;
  if (!jwtSecret) {
    throw new Error("JWT_SECRET environment variable not set");
  }

  const secret = new TextEncoder().encode(jwtSecret);
  const token = await new jose.SignJWT({ sub: subOrgId, email })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("30d")
    .setIssuer("originals-auth")
    .setAudience("originals-api")
    .sign(secret);

  return token;
}

function buildCookieValue(token: string): string {
  const isProduction = process.env.NODE_ENV === "production";
  const maxAgeSeconds = 30 * 24 * 60 * 60; // 30 days

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
 */
export const initiateAuth = internalAction({
  args: {
    email: v.string(),
  },
  handler: async (_ctx, args): Promise<{
    sessionId: string;
    message: string;
    session: {
      email: string;
      subOrgId: string;
      otpId: string;
    };
  }> => {
    const credentials = getTurnkeyCredentials();

    console.log(`[authInternal] Initiating auth for: ${args.email}`);

    // Get or create sub-organization
    const subOrgId = await getOrCreateSubOrg(args.email, credentials);

    // Send OTP
    console.log(`[authInternal] Sending OTP to ${args.email}...`);
    const otpId = await initOtp(args.email, credentials);
    console.log(`[authInternal] OTP sent! OTP ID: ${otpId}`);

    // Generate session ID
    const sessionId = `session_${Date.now()}_${Math.random().toString(36).substring(2, 15)}`;

    return {
      sessionId,
      message: "Verification code sent to your email. Check your inbox!",
      session: {
        email: args.email,
        subOrgId,
        otpId,
      },
    };
  },
});

/**
 * Verify OTP code and return authentication result.
 */
export const verifyAuth = internalAction({
  args: {
    sessionId: v.string(),
    code: v.string(),
    session: v.object({
      email: v.string(),
      subOrgId: v.string(),
      otpId: v.string(),
      timestamp: v.number(),
      verified: v.boolean(),
    }),
  },
  handler: async (_ctx, args): Promise<{
    verified: boolean;
    email?: string;
    subOrgId?: string;
  }> => {
    const credentials = getTurnkeyCredentials();

    console.log(`[authInternal] Verifying OTP for session: ${args.sessionId}`);

    try {
      // Verify OTP with Turnkey
      await verifyOtp(args.session.otpId, args.code, credentials);

      console.log(`[authInternal] OTP verified successfully!`);

      return {
        verified: true,
        email: args.session.email,
        subOrgId: args.session.subOrgId,
      };
    } catch (error) {
      console.error(`[authInternal] OTP verification failed:`, error);
      throw new Error(
        `Invalid verification code: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  },
});

/**
 * Mint a Turnkey signing session for the browser.
 *
 * Called during login with a public key the browser just generated. The
 * returned bundle is HPKE-encrypted to that key, so it is useless to anyone
 * who intercepts it — including us.
 *
 * Failure is not fatal to login: without a session the user can still read and
 * edit, their changes just queue unsigned until the next successful login.
 */
export const createSigningSession = internalAction({
  args: {
    subOrgId: v.string(),
    targetPublicKey: v.string(),
  },
  handler: async (_ctx, args): Promise<{
    credentialBundle: string;
    signingAddress: string;
    expiresAt: number;
  }> => {
    const credentials = getTurnkeyCredentials();
    const [userId, signingAddress] = await Promise.all([
      getSubOrgRootUserId(args.subOrgId, credentials),
      getEd25519Address(args.subOrgId, credentials),
    ]);

    const credentialBundle = await createReadWriteSession(
      args.subOrgId,
      userId,
      args.targetPublicKey,
      SIGNING_SESSION_SECONDS,
      credentials
    );

    return {
      credentialBundle,
      signingAddress,
      expiresAt: Date.now() + SIGNING_SESSION_SECONDS * 1000,
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
  },
  handler: async (_ctx, args): Promise<{
    token: string;
    cookieValue: string;
  }> => {
    const token = await signJwtToken(args.subOrgId, args.email);
    const cookieValue = buildCookieValue(token);

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
