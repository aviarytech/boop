/**
 * A list's Original, as its page sees it.
 *
 * A list with no Original yet is minted silently when its owner opens it
 * while signed in. A legacy did:cel list cannot be read under Originals 5,
 * so its owner is asked to re-mint it (RemintListModal) before going on.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useConvex } from "convex/react";
import { api } from "../../convex/_generated/api";
import type { Doc } from "../../convex/_generated/dataModel";
import { useAuth } from "./useAuth";
import { sessionArgs, useQuery } from "../lib/authenticatedConvex";
import { ListNotAuthorableError, mintList, type MintInput, type OriginalsClient } from "../lib/originals";
import { Sentry } from "../lib/sentry";

/** The Convex client with this session applied, for the Originals host calls. */
export function useOriginalsClient(): OriginalsClient {
  const convex = useConvex();
  const { token } = useAuth();
  return useMemo<OriginalsClient>(() => ({
    query: ((ref: never, args: never) => convex.query(ref, sessionArgs(ref, args ?? {}, token) as never)) as OriginalsClient["query"],
    action: ((ref: never, args: never) => convex.action(ref, sessionArgs(ref, args ?? {}, token) as never)) as OriginalsClient["action"],
  }), [convex, token]);
}

export type ListOriginalState =
  | "loading"
  | "minted"
  | "unminted" // no Original yet, and this viewer can't mint it now
  | "minting"
  | "legacy" // a did:cel list waiting for its owner to re-mint it
  | "unauthorable"; // owner, but no live Turnkey session to sign with

export function useListOriginal(
  list: Doc<"lists"> | null | undefined,
  isOwner: boolean,
  /** The list's current state, which genesis commits to. Null until it has loaded. */
  content: MintInput["content"] | null,
  isOnline: boolean
) {
  const client = useOriginalsClient();
  const status = useQuery(api.originalsHost.getOriginalStatus, list ? { listIds: [list._id] } : "skip");
  const [busy, setBusy] = useState(false);
  const [unauthorable, setUnauthorable] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const autoMinted = useRef<string | null>(null);

  const legacy = !!list && !!status?.legacy.includes(list._id);
  const unminted = !!list && !!status?.unminted.includes(list._id);

  const mint = useCallback(async () => {
    if (!list || !content) return;
    setBusy(true);
    setError(null);
    try {
      await mintList(client, { listId: list._id, ownerDid: list.ownerDid, name: list.name, content });
    } catch (err) {
      if (err instanceof ListNotAuthorableError) {
        setUnauthorable(true);
      } else {
        Sentry.captureException(err, { tags: { area: "originals" } });
        setError(err instanceof Error ? err.message : String(err));
      }
    } finally {
      setBusy(false);
    }
  }, [client, list, content]);

  // New lists mint on first open. Once per list per mount: a failure is shown,
  // not retried in a loop.
  useEffect(() => {
    if (!list || !isOwner || !unminted || !content || !isOnline || busy) return;
    if (autoMinted.current === list._id) return;
    autoMinted.current = list._id;
    void mint();
  }, [list, isOwner, unminted, content, isOnline, busy, mint]);

  let state: ListOriginalState = "loading";
  if (status) {
    if (busy) state = "minting";
    else if (!legacy && !unminted) state = "minted";
    else if (isOwner && unauthorable) state = "unauthorable";
    else if (legacy) state = "legacy";
    else state = "unminted";
  }

  return { state, isLegacy: legacy, remint: mint, error };
}
