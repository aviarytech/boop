/**
 * Internal actions for authentication - Web Crypto only implementation.
 *
 * This file implements Turnkey API integration using only Web Crypto APIs,
 * allowing it to run in Convex's V8 isolate without Node.js.
 */

import { internalAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import * as jose from "jose";

// ============================================================================
// Turnkey API Configuration
// ============================================================================

const TURNKEY_API_BASE_URL = "https://api.turnkey.com";

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
  handler: async (ctx, args): Promise<{
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

    // The parent Turnkey organization is shared with other apps. Only Boop's
    // saved account link identifies a returning user; a global email search does not.
    const account = await ctx.runQuery(internal.auth.getLoginAccount, { email: args.email });
    const subOrgId = account?.turnkeySubOrgId ?? await createSubOrganization(args.email, credentials);

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
  handler: async (ctx, args): Promise<{
    verified: boolean;
    email?: string;
    subOrgId?: string;
  }> => {
    const credentials = getTurnkeyCredentials();

    // Recheck sessions initiated before a repair or a competing signup. Do this
    // before consuming the OTP, and never silently retarget a pending session.
    const account = await ctx.runQuery(internal.auth.getLoginAccount, { email: args.session.email });
    if (account && account.turnkeySubOrgId !== args.session.subOrgId) {
      throw new Error("Your account changed. Please request a new code.");
    }

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
