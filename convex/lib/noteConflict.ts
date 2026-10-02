import { ConvexError } from "convex/values";

export function noteConflict() {
  return new ConvexError({ code: "NOTE_CONFLICT", message: "The note changed. Review both versions before saving." });
}

/** Error messages are redacted in production; application data survives RPC. */
export function isNoteConflict(error: unknown): boolean {
  if (!error || typeof error !== "object" || !("data" in error)) return false;
  const data = error.data;
  return !!data && typeof data === "object" && "code" in data && data.code === "NOTE_CONFLICT";
}
