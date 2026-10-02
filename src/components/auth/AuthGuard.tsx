/**
 * Auth guard wrapper component for protected routes.
 *
 * Checks if user is authenticated:
 * - If loading: shows loading spinner
 * - If not authenticated: redirects to /login
 * - If authenticated: renders children
 *
 * Used to wrap routes that require authentication.
 */

import { useState, type ReactNode } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "../../hooks/useAuth";

import { useQuery, useMutation } from "../../lib/authenticatedConvex";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";

function DeletionPending({ userId }: { userId: Id<"users"> }) {
  const resume = useMutation(api.users.deleteUserData);
  const { logout } = useAuth();
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const retry = async () => {
    setBusy(true);
    setFailed(false);
    try { await resume({ userId }); await logout(); }
    catch { setFailed(true); setBusy(false); }
  };
  return <main className="min-h-screen flex flex-col items-center justify-center gap-4 p-6 text-center">
    <p>Your account deletion is in progress.</p>
    <p>If deletion was interrupted, you can resume it here.</p>
    {failed && <p role="alert">Could not resume deletion. Please try again.</p>}
    <button disabled={busy} onClick={retry} className="rounded-xl bg-amber-500 px-4 py-2 text-white">
      {busy ? "Resuming…" : "Resume deletion"}
    </button>
    <button onClick={() => void logout()}>Sign out</button>
  </main>;
}

interface AuthGuardProps {
  children: ReactNode;
}

export function AuthGuard({ children }: AuthGuardProps) {
  const { isAuthenticated, isLoading, user, logout } = useAuth();
  const account = useQuery(api.auth.getUserByTurnkeyId,
    isAuthenticated && user ? { turnkeySubOrgId: user.turnkeySubOrgId } : "skip");
  const location = useLocation();

  // Show loading state while checking auth
  if (isLoading || (isAuthenticated && account === undefined)) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="inline-block animate-spin rounded-full h-8 w-8 border-4 border-gray-300 border-t-blue-600"></div>
          <p className="mt-2 text-gray-500">Loading...</p>
        </div>
      </div>
    );
  }

  // Redirect to login if not authenticated
  if (!isAuthenticated) {
    // Preserve the attempted URL so we can redirect back after login
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  if (account?.deletionRequestedAt !== undefined) {
    return <DeletionPending userId={account._id} />;
  }
  if (account === null) {
    return <main className="min-h-screen flex flex-col items-center justify-center gap-4">
      <p>This account is no longer available.</p>
      <button onClick={() => void logout()}>Sign out</button>
    </main>;
  }

  // User is authenticated, render children
  return <>{children}</>;
}
