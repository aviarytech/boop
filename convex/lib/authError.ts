import { ConvexError } from "convex/values";

export type AuthErrorCode = "UNAUTHORIZED" | "INVALID_TOKEN" | "EXPIRED_TOKEN" | "FORBIDDEN";
type AuthErrorData = { kind: "auth"; code: AuthErrorCode; message: string };

/** Convex preserves data across RPC; ordinary Error properties are stripped. */
export class AuthError extends ConvexError<AuthErrorData> {
  readonly code: AuthErrorCode;
  constructor(message: string, code: AuthErrorCode) {
    super({ kind: "auth", code, message });
    this.name = "AuthError";
    this.message = message;
    this.code = code;
  }
}

export function authErrorData(error: unknown): AuthErrorData | null {
  if (!error || typeof error !== "object" || !("data" in error)) return null;
  const data = error.data;
  if (!data || typeof data !== "object" || !("kind" in data) || data.kind !== "auth"
    || !("code" in data) || !("message" in data) || typeof data.message !== "string") return null;
  if (data.code !== "UNAUTHORIZED" && data.code !== "INVALID_TOKEN" && data.code !== "EXPIRED_TOKEN" && data.code !== "FORBIDDEN") return null;
  return { kind: "auth", code: data.code, message: data.message };
}

/** Identical for missing and inaccessible resources: never disclose existence. */
export function resourceUnavailable(): AuthError {
  return new AuthError("Resource unavailable", "FORBIDDEN");
}
