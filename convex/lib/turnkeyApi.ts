/**
 * Stamped requests to the Turnkey API, using only Web Crypto so it runs in
 * Convex's V8 isolate as well as under Node and Bun.
 *
 * Shared by the auth relay (convex/authInternal.ts), the Boop service receipt
 * signer (convex/lib/serviceReceipts.ts) and the owner-run service DID script
 * (scripts/boop-service-did.ts). This module submits nothing by itself.
 */

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

export function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.substr(i * 2, 2), 16);
  }
  return bytes;
}

export function bytesToHex(bytes: Uint8Array): string {
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

export interface TurnkeyCredentials {
  apiPublicKey: string;
  apiPrivateKey: string;
  organizationId: string;
}

export function getTurnkeyCredentials(): TurnkeyCredentials {
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

export class TurnkeyApiError extends Error {
  readonly status: number;

  constructor(status: number, body: string) {
    super(`Turnkey API error ${status}: ${body}`);
    this.status = status;
  }
}

/**
 * Make an authenticated request to the Turnkey API.
 */
export async function turnkeyRequest<T>(
  endpoint: string,
  body: Record<string, unknown>,
  credentials: TurnkeyCredentials,
  fetchImpl: typeof fetch = fetch
): Promise<T> {
  const bodyStr = JSON.stringify(body);
  const stamp = await createStamp(bodyStr, credentials.apiPublicKey, credentials.apiPrivateKey);

  const response = await fetchImpl(`${TURNKEY_API_BASE_URL}${endpoint}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Stamp": stamp,
    },
    body: bodyStr,
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new TurnkeyApiError(response.status, errorText);
  }

  return response.json();
}
