/**
 * A list's Original as verified on this device, for the provenance panel and
 * the header badge.
 */

import { useEffect, useState } from "react";
import { api } from "../../convex/_generated/api";
import type { Doc } from "../../convex/_generated/dataModel";
import { useQuery } from "../lib/authenticatedConvex";
import { isLegacyAssetDid, verifyList } from "../lib/originals";
import { useOriginalsClient } from "./useListOriginal";

export type ListVerificationState =
  | { status: "absent"; legacy: boolean }
  | { status: "checking" }
  | { status: "verified"; checkpoint: string }
  | { status: "failed"; detail: string };

/**
 * Verifies a list's Original client-side from what the host serves: the
 * did:vh log, the owner's DID history and every resource's bytes. Real work
 * (signature checks and hashing), so it runs in an effect, keyed by the head it
 * verified so a stale result is never shown for a newer log.
 */
export function useListVerification(list: Doc<"lists"> | null | undefined): ListVerificationState {
  const client = useOriginalsClient();
  const listId = list?._id;
  const hosted = useQuery(api.originalsHost.getAccepted, listId ? { listId } : "skip");
  const head = hosted?.head ?? null;
  const [result, setResult] = useState<{ head: string; state: ListVerificationState } | null>(null);

  useEffect(() => {
    if (!head || !listId) return;
    let cancelled = false;
    void verifyList(client, listId).then((verification) => {
      if (cancelled || !verification) return;
      setResult({
        head,
        state: verification.verified
          ? { status: "verified", checkpoint: verification.checkpoint }
          : { status: "failed", detail: verification.error ?? verification.reasons.join(", ") },
      });
    });
    return () => {
      cancelled = true;
    };
  }, [client, head, listId]);

  if (hosted === undefined || !list) return { status: "checking" };
  if (hosted === null) return { status: "absent", legacy: isLegacyAssetDid(list.assetDid) };
  return result?.head === head ? result.state : { status: "checking" };
}

/** The header badge's view of a list's verification (VerificationBadge). */
export function badgeSignature(state: ListVerificationState) {
  if (state.status === "verified") return { status: "signed" as const, checkpoint: state.checkpoint };
  if (state.status === "checking") return { status: "checking" as const };
  if (state.status === "failed") return { status: "failed" as const };
  return undefined;
}
