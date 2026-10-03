/**
 * Unified hook for getting current user identity.
 *
 * This hook provides the current user's identity from Turnkey authentication.
 * All signing and DID operations are now handled server-side.
 */

import { useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import { useAuth } from "./useAuth";

export interface CurrentUser {
  /** User's canonical DID (from Convex user record, or fallback to authUser.did) */
  did: string | null;
  /** Legacy DID for migrated users (their old localStorage DID, stored in Convex) */
  legacyDid: string | null;
  /** Turnkey sub-organization ID (needed for server-side signing) */
  subOrgId: string | null;
  /** Display name */
  displayName: string | null;
  /** Email address */
  email: string | null;
  /** Whether user is authenticated */
  isAuthenticated: boolean;
  /** Whether data is still loading */
  isLoading: boolean;
}

/**
 * Get the current user's identity from Turnkey authentication.
 *
 * This is the primary hook for accessing user identity throughout the app.
 * It provides the user's DID, display name, email, and subOrgId.
 *
 * For migrated users, the legacyDid field contains their old localStorage DID
 * which is used for backwards-compatible ownership checks on pre-migration lists.
 */
export function useCurrentUser(): CurrentUser {
  const { isAuthenticated, user: authUser, isLoading: authLoading } = useAuth();

  // If Turnkey authenticated, fetch user record to get legacyDid
  const turnkeyUser = useQuery(
    api.auth.getUserByTurnkeyId,
    isAuthenticated && authUser?.turnkeySubOrgId
      ? { turnkeySubOrgId: authUser.turnkeySubOrgId }
      : "skip"
  );

  const isLoading = authLoading || (isAuthenticated && turnkeyUser === undefined);

  // Debug: log what we're getting
  console.log("[useCurrentUser] Debug:", {
    isAuthenticated,
    authUser: authUser ? { did: authUser.did, turnkeySubOrgId: authUser.turnkeySubOrgId } : null,
    turnkeyUser: turnkeyUser ? { did: turnkeyUser.did, legacyDid: turnkeyUser.legacyDid } : turnkeyUser,
    isLoading,
  });

  // Authenticated user
  if (isAuthenticated && authUser) {
    // Prefer DID from Convex (canonical) over client-generated DID
    const canonicalDid = turnkeyUser?.did ?? authUser.did;

    console.log("[useCurrentUser] Returning:", { canonicalDid });

    return {
      did: canonicalDid,
      legacyDid: turnkeyUser?.legacyDid ?? null,
      subOrgId: authUser.turnkeySubOrgId,
      displayName: authUser.displayName,
      email: authUser.email,
      isAuthenticated: true,
      isLoading,
    };
  }

  // Not authenticated
  return {
    did: null,
    legacyDid: null,
    subOrgId: null,
    displayName: null,
    email: null,
    isAuthenticated: false,
    isLoading,
  };
}
