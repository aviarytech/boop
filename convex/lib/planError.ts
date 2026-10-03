import { ConvexError } from "convex/values";

type PlanErrorData = { code: "PLAN_REQUIRED" | "SITE_LIMIT"; message: string };

/** Entitlement failures are safe to display and must survive production RPC redaction. */
export class PlanError extends ConvexError<PlanErrorData> {
  constructor(code: PlanErrorData["code"], message: string) {
    super({ code, message });
    this.message = message;
  }
}

export function planErrorData(error: unknown): PlanErrorData | null {
  if (!error || typeof error !== "object" || !("data" in error)) return null;
  const data = error.data;
  if (!data || typeof data !== "object" || !("code" in data) || !("message" in data)
    || typeof data.message !== "string"
    || (data.code !== "PLAN_REQUIRED" && data.code !== "SITE_LIMIT")) return null;
  return { code: data.code, message: data.message };
}
