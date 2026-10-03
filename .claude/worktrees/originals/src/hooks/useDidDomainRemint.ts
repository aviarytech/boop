/**
 * One-shot repair for identities minted on a domain we no longer serve.
 *
 * A did:webvh encodes its domain in the identifier and ours are non-portable,
 * so an identity minted while the app lived on an old host names that host
 * forever — and a did:webvh resolves by fetching did.jsonl from its own domain,
 * so those DIDs are unresolvable and lists published under them cannot verify.
 *
 * The DID is minted here because that is where the signing key lives. It is a
 * genuinely NEW identity, not a continuation: the key that controlled the old
 * DID is gone with the origin it was minted on, which is why didwebvh-ts
 * rejects any attempt to update the old log ("Key ... is not authorized to
 * update"). There is no continuity left to preserve.
 *
 * The server authorizes the swap on the JWT, so the rewrite is bounded to the
 * caller's own account.
 *
 * TEMPORARY. Delete once no account reports a stale domain.
 */

import { useEffect, useRef } from "react";
import { createUserWebVHDid, isStaleDidDomain } from "../lib/webvh";
import { getConvexHttpUrl } from "../lib/convexUrls";
import { storageAdapter } from "../lib/storageAdapter";
import { Sentry } from "../lib/sentry";

/** Must match useAuth's persisted-state key. */
const AUTH_STORAGE_KEY = "lisa-auth-state";

export function useDidDomainRemint(
  user: { did?: string; email?: string; turnkeySubOrgId?: string } | null,
  token: string | null
) {
  // Guards a second run while the first is in flight — the effect re-fires as
  // the user identity changes across renders.
  const attempted = useRef<string | null>(null);

  useEffect(() => {
    const did = user?.did;
    const email = user?.email;
    const subOrgId = user?.turnkeySubOrgId;
    if (!did || !email || !subOrgId || !token) return;
    if (!isStaleDidDomain(did)) return;
    if (attempted.current === did) return;
    attempted.current = did;

    void (async () => {
      try {
        const minted = await createUserWebVHDid({ email, subOrgId });

        const response = await fetch(`${getConvexHttpUrl()}/api/user/remintDid`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          credentials: "include",
          body: JSON.stringify({
            did: minted.did,
            didLog: minted.didLogJsonl,
            path: minted.path,
          }),
        });
        if (!response.ok) {
          throw new Error(`remint failed: ${response.status} ${await response.text()}`);
        }

        const result = (await response.json()) as { newDid: string; rewritten: number };
        console.info(`[remint] ${did} -> ${result.newDid} (${result.rewritten} rows)`);

        // Persisted auth state is restored on reload without re-contacting the
        // server, so leaving the old DID cached would re-trigger this on every
        // load. (The endpoint also refuses a second migration, but burning a
        // keypair per reload is worth avoiding.)
        try {
          const raw = await storageAdapter.get(AUTH_STORAGE_KEY);
          if (raw) {
            const state = JSON.parse(raw);
            if (state?.user) {
              state.user.did = result.newDid;
              await storageAdapter.set(AUTH_STORAGE_KEY, JSON.stringify(state));
            }
          }
        } catch (cacheErr) {
          console.warn("[remint] could not refresh cached auth state", cacheErr);
        }

        // The whole app is keyed by DID; reload so every subscription re-reads
        // under the new identity rather than holding stale rows.
        window.location.reload();
      } catch (err) {
        // Never block login on this. The old DID keeps working as an identifier,
        // it just stays unresolvable until a later attempt succeeds.
        console.error("[remint] failed", err);
        Sentry.captureException(err);
        attempted.current = null;
      }
    })();
  }, [user?.did, user?.email, user?.turnkeySubOrgId, token]);
}
