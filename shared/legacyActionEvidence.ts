/** Only recognize the known unsigned VC placeholder shape. Unknown evidence,
 * including nested CEL/WebVH histories, is never downgraded to unsigned here. */
export function legacyActionEvidence(proof?: string): "unsigned" | "unverified" {
  if (!proof) return "unsigned";
  try {
    const parsed = JSON.parse(proof);
    if (parsed && typeof parsed === "object"
      && Array.isArray(parsed["@context"])
      && Array.isArray(parsed.type) && parsed.type.includes("VerifiableCredential")
      && parsed.credentialSubject && typeof parsed.credentialSubject === "object"
      && !parsed.proof && !parsed.signature) return "unsigned";
  } catch { /* Preserve opaque legacy evidence without claiming verification. */ }
  return "unverified";
}
