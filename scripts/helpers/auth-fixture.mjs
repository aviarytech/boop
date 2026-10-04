import { SignJWT } from "jose";
import { createHash } from "node:crypto";

// Exercise the production verifier with a test-only signing secret. The DID is
// deliberately absent from the JWT: the database account owns that association.
export const AUTH_FIXTURE_SECRET = "boop-handler-regression-test-secret-only";
process.env.JWT_SECRET = AUTH_FIXTURE_SECRET;

export async function createAuthFixture(did, overrides = {}, signingSecret = process.env.JWT_SECRET) {
  const user = {
    _id: `user-${did}`,
    did,
    turnkeySubOrgId: `org-${did}`,
    ...overrides,
  };
  const expiresAt = (Math.floor(Date.now() / 1000) + 3600) * 1000;
  const authToken = await new SignJWT({ email: "fixture@example.test" })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(user.turnkeySubOrgId)
    .setIssuer("originals-auth")
    .setAudience("originals-api")
    .setIssuedAt()
    .setExpirationTime(expiresAt / 1000)
    .sign(new TextEncoder().encode(signingSecret));
  const accessSession = {
    _id: `session-${did}`,
    tokenHash: createHash("sha256").update(authToken).digest("hex"),
    subject: user.turnkeySubOrgId,
    expiresAt,
  };
  return { user, authToken, accessSession };
}
