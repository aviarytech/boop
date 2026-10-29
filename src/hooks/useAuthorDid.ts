/**
 * Moves the signed-in account onto an author DID once its Turnkey session is
 * live (#286 PR b; src/lib/authorIdentity.ts). Replaces the stale-domain
 * re-mint, which minted with a key kept in localStorage: a DID on a domain we
 * no longer serve is not an author DID on the current domain, so it is
 * re-genesised here like any pre-#286 DID.
 */
import { useEffect, useRef } from "react";
import { clearCurrentAuthor, ensureAuthorDid } from "../lib/authorIdentity";
import { storageAdapter } from "../lib/storageAdapter";
import { Sentry } from "../lib/sentry";

/** Must match useAuth's persisted-state key. */
const AUTH_STORAGE_KEY = "lisa-auth-state";

export function useAuthorDid(
  user: { did?: string; turnkeySubOrgId?: string } | null,
  token: string | null,
  onAdopted: (did: string) => void
) {
  // One attempt per sign-in: a session that isn't live now only becomes live
  // through a new login, which brings a new token.
  const attempted = useRef<string | null>(null);
  const onAdoptedRef = useRef(onAdopted);
  useEffect(() => { onAdoptedRef.current = onAdopted; }, [onAdopted]);

  useEffect(() => {
    const subOrgId = user?.turnkeySubOrgId;
    if (!subOrgId || !token) {
      clearCurrentAuthor();
      attempted.current = null;
      return;
    }
    const attempt = `${subOrgId}:${user?.did ?? ""}:${token}`;
    if (attempted.current === attempt) return;
    attempted.current = attempt;

    void (async () => {
      try {
        const result = await ensureAuthorDid({ did: user?.did, turnkeySubOrgId: subOrgId }, token);
        if (result.status === "not-ready") {
          console.info("[authorDid] No live Turnkey session; Originals signing waits for the next login");
        } else if (result.status === "kept") {
          console.warn("[authorDid] The server kept this account's DID; this device can't confirm it as an author DID");
        } else if (result.status === "adopted") {
          onAdoptedRef.current(result.did);
        } else if (result.status === "reminted" || result.status === "moved") {
          console.info(`[authorDid] ${result.previousDid} -> ${result.did}`);
          // Restored auth state isn't re-read from the server, so update it,
          // then reload: the whole app is keyed by DID and its rows just moved.
          try {
            const raw = await storageAdapter.get(AUTH_STORAGE_KEY);
            const state = raw ? JSON.parse(raw) : null;
            if (state?.user) {
              state.user.did = result.did;
              await storageAdapter.set(AUTH_STORAGE_KEY, JSON.stringify(state));
            }
          } catch (cacheErr) {
            console.warn("[authorDid] could not refresh cached auth state", cacheErr);
          }
          window.location.reload();
        }
      } catch (err) {
        // Never block sign-in. The account keeps its DID and retries at the next login.
        console.error("[authorDid] failed", err);
        Sentry.captureException(err);
      }
    })();
  }, [user?.did, user?.turnkeySubOrgId, token]);
}
