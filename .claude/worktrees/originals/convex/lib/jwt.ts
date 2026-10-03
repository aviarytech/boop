/**
 * JWT validation helper for Convex mutations.
 *
 * Uses jose library for token verification (Web Crypto API - works everywhere).
 */

import * as jose from "jose";

/**
 * Result of a successful token verification.
 */
export interface AuthTokenPayload {
  /** Turnkey sub-organization ID (stable user identifier) */
  turnkeySubOrgId: string;
  /** User's email address */
  email: string;
  /** Optional Turnkey session token for wallet operations */
  sessionToken?: string;
}

/**
 * JWT payload structure from @originals/auth
 */
interface JWTPayload {
  sub: string;
  email: string;
  sessionToken?: string;
  iat?: number;
  exp?: number;
}

/**
 * Verify a JWT auth token and return the decoded payload.
 *
 * @param token - JWT token string
 * @returns Decoded token payload with turnkeySubOrgId and email
 * @throws Error if token is invalid, expired, or missing required fields
 */
export async function verifyAuthToken(token: string): Promise<AuthTokenPayload> {
  if (!token) {
    throw new Error("Token is required");
  }

  const jwtSecret = process.env.JWT_SECRET;
  if (!jwtSecret) {
    throw new Error("JWT_SECRET environment variable not set");
  }

  try {
    // Encode secret as Uint8Array for jose
    const secret = new TextEncoder().encode(jwtSecret);

    // Verify the token
    const { payload } = await jose.jwtVerify(token, secret, {
      algorithms: ["HS256"],
    });

    const jwtPayload = payload as unknown as JWTPayload;

    // Validate required fields
    if (!jwtPayload.sub) {
      throw new Error("Token missing sub-organization ID");
    }
    if (!jwtPayload.email) {
      throw new Error("Token missing email");
    }

    return {
      turnkeySubOrgId: jwtPayload.sub,
      email: jwtPayload.email,
      sessionToken: jwtPayload.sessionToken,
    };
  } catch (error) {
    if (error instanceof jose.errors.JWTExpired) {
      throw new Error("Token has expired");
    }
    if (error instanceof jose.errors.JWTInvalid) {
      throw new Error("Invalid token");
    }
    throw error;
  }
}

/**
 * Extract JWT token from an HTTP request.
 *
 * Checks Authorization header first (Bearer token), then falls back to auth_token cookie.
 *
 * @param request - HTTP request object
 * @returns JWT token string or null if not found
 */
export function extractTokenFromRequest(request: Request): string | null {
  // Check Authorization header first
  const authHeader = request.headers.get("Authorization");
  if (authHeader?.startsWith("Bearer ")) {
    return authHeader.slice(7); // Remove "Bearer " prefix
  }

  // Fall back to cookie
  const cookieHeader = request.headers.get("Cookie");
  if (cookieHeader) {
    const cookies = parseCookies(cookieHeader);
    if (cookies.auth_token) {
      return cookies.auth_token;
    }
  }

  return null;
}

/**
 * Parse a cookie header string into key-value pairs.
 */
function parseCookies(cookieHeader: string): Record<string, string> {
  const cookies: Record<string, string> = {};
  const pairs = cookieHeader.split(";");

  for (const pair of pairs) {
    const [name, ...rest] = pair.trim().split("=");
    if (name) {
      cookies[name] = rest.join("="); // Handle values with = in them
    }
  }

  return cookies;
}
