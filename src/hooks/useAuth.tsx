import { onSessionExpiry } from "../lib/sessionExpiry";
import { withAuthTimeout } from "../lib/authTimeout";
import { useConvex } from "convex/react";
import { api } from "../../convex/_generated/api";
/**
 * Auth context and hook for server-side authentication.
 *
 * Provides authentication state and OTP flow methods. This is the primary
 * authentication mechanism for the app.
 *
 * Authentication flow uses Convex HTTP endpoints:
 * - /auth/initiate - Start OTP flow, get sessionId
 * - /auth/verify - Verify OTP, get JWT token (DID created server-side)
 * - /auth/logout - Clear auth cookie
 *
 * The JWT token is stored in localStorage and sent with API requests.
 * All signing operations (credentials, DIDs) are handled server-side.
 * 
 * Storage uses the async storageAdapter (Capacitor Preferences on native, localStorage on web)
 * for reliable persistence across platforms.
 */

/* eslint-disable react-refresh/only-export-components */
import {
  createContext,
  useContext,
  useState,
  useCallback,
  useEffect,
  useRef,
  type ReactNode,
} from "react";
import { createUserWebVHDid } from "../lib/webvh";
import { useDidDomainRemint } from "./useDidDomainRemint";
import { getConvexHttpUrl } from "../lib/convexUrls";
import { storageAdapter } from "../lib/storageAdapter";
import { identifyUser, resetAnalytics } from "../lib/analytics";

/**
 * Get the Convex HTTP endpoint base URL from the Convex URL.
 *
 * Convex Cloud: https://xxx.convex.cloud -> https://xxx.convex.site
 * Local dev: http://127.0.0.1:3210 -> http://127.0.0.1:3211
 */

const JWT_STORAGE_KEY = "lisa-jwt-token";

/**
 * Authenticated user data returned after successful OTP verification.
 */
export interface AuthUser {
  /** Turnkey sub-organization ID */
  turnkeySubOrgId: string;
  /** User's email address */
  email: string;
  /** User's DID (created server-side via Turnkey) */
  did: string;
  /** Display name (defaults to email prefix) */
  displayName: string;
}

/**
 * Auth context value providing authentication state and actions.
 */
interface AuthContextValue {
  /** Whether user is authenticated */
  isAuthenticated: boolean;
  /** Whether auth state is loading (checking session, performing OTP, etc.) */
  isLoading: boolean;
  /** Authenticated user data, or null if not authenticated */
  user: AuthUser | null;
  /** JWT token for API authentication, or null if not authenticated */
  token: string | null;
  /** Start OTP flow by sending code to email. */
  startOtp: (email: string) => Promise<void>;
  /** Verify OTP code and complete authentication */
  verifyOtp: (code: string) => Promise<void>;
  /** Log out and clear session */
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

interface AuthProviderProps {
  children: ReactNode;
}

/**
 * Internal OTP flow state.
 */
interface OtpFlowState {
  /** Session ID from /auth/initiate (used for /auth/verify) */
  sessionId: string | null;
  email: string | null;
}

/**
 * Auth state persisted in localStorage for session recovery.
 */
interface PersistedAuthState {
  user: AuthUser;
  /** JWT token for API authentication */
  token: string;
}

const AUTH_STORAGE_KEY = "lisa-auth-state";

/**
 * Provides auth context to child components.
 *
 * Wraps the app to provide authentication state via useAuth hook.
 */
export function AuthProvider({ children }: AuthProviderProps) {
  const convex = useConvex();
  const [user, setUser] = useState<AuthUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  // JWT token for API authentication
  const [token, setToken] = useState<string | null>(null);

  // Track OTP flow state (stored in component state, not exposed)
  const [otpFlowState, setOtpFlowState] = useState<OtpFlowState>({
    sessionId: null,
    email: null,
  });

  // Track mounted state to prevent setState after unmount
  const isMountedRef = useRef(true);
  // Serialize restore/login/logout, including the cookie response from logout.
  const authTransitionRef = useRef(true);

  /**
   * Restore session from localStorage.
   */
  useEffect(() => {
    // Mark as mounted at start, unmount flag in cleanup
    isMountedRef.current = true;

    const restoreSession = async () => {
      try {
        const storedState = await storageAdapter.get(AUTH_STORAGE_KEY);
        if (!storedState) {
          console.log("[useAuth] No stored session found");
          if (isMountedRef.current) setIsLoading(false);
          return;
        }

        const parsed: PersistedAuthState = JSON.parse(storedState);
        console.log("[useAuth] Found stored session, restoring...");

        // Validate JWT is not expired before restoring
        try {
          const payload = JSON.parse(atob(parsed.token.split('.')[1]));
          if (payload.exp && payload.exp * 1000 < Date.now()) {
            console.log("[useAuth] Stored token expired, clearing session");
            await storageAdapter.remove(AUTH_STORAGE_KEY);
            await storageAdapter.remove(JWT_STORAGE_KEY);
            if (isMountedRef.current) setIsLoading(false);
            return;
          }
        } catch {
          console.warn("[useAuth] Could not parse JWT for expiry check, proceeding anyway");
        }

        // Restore auth state
        await withAuthTimeout(convex.mutation(api.actorSession.establish, { authToken: parsed.token }));
        setUser(parsed.user);
        setToken(parsed.token);
        await storageAdapter.set(JWT_STORAGE_KEY, parsed.token);

        // If user is stuck on did:temp (or no DID), create did:webvh now
        if (parsed.user && (!parsed.user.did || !parsed.user.did.startsWith("did:webvh:"))) {
          try {
            console.log("[useAuth] User has no did:webvh, creating client-side...");
            const webvhResult = await createUserWebVHDid({
              email: parsed.user.email,
              subOrgId: parsed.user.turnkeySubOrgId,
            });

            const httpUrl = getConvexHttpUrl();
            await fetch(`${httpUrl}/api/user/updateDID`, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${parsed.token}`,
              },
              credentials: "include",
              body: JSON.stringify({ did: webvhResult.did }),
            });

            // Store DID log in Convex for resolution
            await fetch(`${httpUrl}/api/did/log`, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${parsed.token}`,
              },
              credentials: "include",
              body: JSON.stringify({
                userDid: webvhResult.did,
                path: webvhResult.path,
                log: webvhResult.didLogJsonl,
              }),
            });

            const upgradedUser = { ...parsed.user, did: webvhResult.did };
            setUser(upgradedUser);
            const updatedState: PersistedAuthState = { user: upgradedUser, token: parsed.token };
            await storageAdapter.set(AUTH_STORAGE_KEY, JSON.stringify(updatedState));
            console.log("[useAuth] Upgraded DID on session restore:", webvhResult.did);
          } catch (didErr) {
            console.error("[useAuth] Failed to upgrade DID on restore:", didErr);
          }
        }
      } catch (err) {
        console.error("[useAuth] Error restoring session:", err);
        setUser(null);
        setToken(null);
        await storageAdapter.remove(AUTH_STORAGE_KEY);
        await storageAdapter.remove(JWT_STORAGE_KEY);
      } finally {
        authTransitionRef.current = false;
        if (isMountedRef.current) setIsLoading(false);
      }
    };

    restoreSession();

    return () => {
      isMountedRef.current = false;
    };
  }, [convex]);

  /**
   * Start OTP flow by sending verification code to email.
   * Calls /auth/initiate HTTP endpoint.
   *
   * @param email - User's email address
   */
  const startOtp = useCallback(
    async (email: string) => {
      if (authTransitionRef.current) throw new Error("Authentication is already in progress");
      authTransitionRef.current = true;
      setIsLoading(true);
      try {
        console.log("[useAuth] Sending OTP to:", email);

        const httpUrl = getConvexHttpUrl();
        const response = await fetch(`${httpUrl}/auth/initiate`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ email }),
        });

        if (!response.ok) {
          const errorData = await response.json();
          throw new Error(errorData.error || "Failed to initiate authentication");
        }

        const { sessionId } = await response.json();
        console.log("[useAuth] OTP initiated, sessionId:", sessionId);

        setOtpFlowState({ sessionId, email });
      } catch (err) {
        console.error("[useAuth] Failed to start OTP:", err);
        throw err;
      } finally {
        authTransitionRef.current = false;
        setIsLoading(false);
      }
    },
    []
  );

  /**
   * Verify OTP code and complete authentication.
   * Calls /auth/verify HTTP endpoint and receives JWT.
   * DID is created server-side during verification.
   */
  const verifyOtp = useCallback(
    async (code: string) => {
      if (!otpFlowState.sessionId || !otpFlowState.email) {
        throw new Error("OTP flow not started. Call startOtp first.");
      }

      if (authTransitionRef.current) throw new Error("Authentication is already in progress");
      authTransitionRef.current = true;
      setIsLoading(true);
      try {
        console.log("[useAuth] Verifying OTP via server...");

        const httpUrl = getConvexHttpUrl();
        const response = await fetch(`${httpUrl}/auth/verify`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          credentials: "include", // Include cookies for httpOnly auth cookie
          body: JSON.stringify({
            sessionId: otpFlowState.sessionId,
            code,
          }),
        });

        if (!response.ok) {
          const errorData = await response.json();
          throw new Error(errorData.error || "Verification failed");
        }

        const { token: jwtToken, user: serverUser } = await response.json();
        console.log("[useAuth] OTP verified, got JWT for:", serverUser.email);

        await withAuthTimeout(convex.mutation(api.actorSession.establish, { authToken: jwtToken }));

        // Start with server-provided DID. If it is not already did:webvh,
        // create did:webvh client-side and persist it.
        let userDid = serverUser.did || `did:temp:${serverUser.turnkeySubOrgId}`;
        if (!userDid.startsWith("did:webvh:")) {
          try {
            const webvhResult = await createUserWebVHDid({
              email: serverUser.email,
              subOrgId: serverUser.turnkeySubOrgId,
            });
            userDid = webvhResult.did;

            await fetch(`${httpUrl}/api/user/updateDID`, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${jwtToken}`,
              },
              credentials: "include",
              body: JSON.stringify({ did: userDid }),
            });

            console.log("[useAuth] Upgraded user DID to did:webvh:", userDid);
          } catch (didErr) {
            console.error("[useAuth] Failed to create/update did:webvh:", didErr);
          }
        }

        // Create auth user object
        const authUser: AuthUser = {
          turnkeySubOrgId: serverUser.turnkeySubOrgId,
          email: serverUser.email,
          did: userDid,
          displayName: serverUser.displayName,
        };

        // Persist auth state
        const persistedState: PersistedAuthState = {
          user: authUser,
          token: jwtToken,
        };
        await storageAdapter.set(AUTH_STORAGE_KEY, JSON.stringify(persistedState));
        await storageAdapter.set(JWT_STORAGE_KEY, jwtToken);
        setToken(jwtToken);

        // Update state
        setUser(authUser);
        setOtpFlowState({ sessionId: null, email: null });

        // Identify user in analytics
        identifyUser(authUser.turnkeySubOrgId, { email_domain: authUser.email.split('@')[1] });

        console.log("[useAuth] Authentication complete, DID:", userDid);
      } catch (err) {
        console.error("[useAuth] Failed to verify OTP:", err);
        setUser(null);
        setToken(null);
        await storageAdapter.remove(AUTH_STORAGE_KEY);
        await storageAdapter.remove(JWT_STORAGE_KEY);
        throw err;
      } finally {
        authTransitionRef.current = false;
        setIsLoading(false);
      }
    },
    [otpFlowState, convex]
  );

  /**
   * Log out and clear session.
   * Calls /auth/logout HTTP endpoint to clear the auth cookie.
   */
  const logout = useCallback(async () => {
    if (authTransitionRef.current) throw new Error("Authentication is already in progress");
    authTransitionRef.current = true;
    setIsLoading(true);
    setToken(null);
    setUser(null);
    setOtpFlowState({ sessionId: null, email: null });
    resetAnalytics();

    try {
      await storageAdapter.remove(AUTH_STORAGE_KEY);
      await storageAdapter.remove(JWT_STORAGE_KEY);
      const httpUrl = getConvexHttpUrl();
      await fetch(`${httpUrl}/auth/logout`, {
        method: "POST",
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        credentials: "include",
      });
    } catch (err) {
      console.error("[useAuth] Logout endpoint failed:", err);
    } finally {
      authTransitionRef.current = false;
      setIsLoading(false);
    }
  }, [token]);

  // Drop subscriptions promptly at expiry; the server independently expires the
  // database session so cached private queries are invalidated on every device.
  useEffect(() => {
    if (!token) return;
    let expiresAt: number;
    try { expiresAt = JSON.parse(atob(token.split(".")[1])).exp * 1000; }
    catch { return; }
    return onSessionExpiry(expiresAt, () => {
      setToken(null);
      setUser(null);
      void storageAdapter.remove(AUTH_STORAGE_KEY);
      void storageAdapter.remove(JWT_STORAGE_KEY);
    });
  }, [token]);

  // Repairs identities minted on a domain we no longer serve. Temporary.
  useDidDomainRemint(user, token);

  const value: AuthContextValue = {
    isAuthenticated: user !== null,
    isLoading,
    user,
    token,
    startOtp,
    verifyOtp,
    logout,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

/**
 * Hook to access auth context.
 *
 * @returns Auth context value with state and actions
 * @throws Error if used outside AuthProvider
 */
export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
}
