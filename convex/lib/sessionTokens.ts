import { SignJWT } from "jose";

export const WEB_SESSION_SECONDS = 30 * 24 * 60 * 60;

/** Mobile sessions are explicitly signed as persistent and remain revocable. */
export async function signSessionToken(subOrgId: string, email: string, persistentMobile = false): Promise<string> {
  const jwtSecret = process.env.JWT_SECRET;
  if (!jwtSecret) throw new Error("JWT_SECRET environment variable not set");

  const token = new SignJWT({ sub: subOrgId, email, ...(persistentMobile ? { sessionType: "mobile_persistent" } : {}) })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setJti(crypto.randomUUID())
    .setIssuer("originals-auth")
    .setAudience("originals-api");
  if (!persistentMobile) token.setExpirationTime(`${WEB_SESSION_SECONDS}s`);
  return token.sign(new TextEncoder().encode(jwtSecret));
}
