import { Capacitor } from "@capacitor/core";
import { authErrorData } from "../../convex/lib/authError";
import { onSessionExpiry } from "../lib/sessionExpiry";
import { TimeoutError, withAuthTimeout, withTimeout } from "../lib/authTimeout";
import { useConvex } from "convex/react";
import { api } from "../../convex/_generated/api";
/**
 * Auth context and hook for server-side authentication.
 *
 * Provides authentication state and OTP flow methods. This is the primary
 * authentication mechanism for the app.
 *
 * Authentication flow uses Convex HTTP endpoints:
 * - /auth/initiate - Start OTP flow, get sessionId and Turnkey's encryption target
 * - /auth/verify - Relay the code, encrypted on this device to Turnkey's enclave
 *   with this device's Turnkey session key; get the JWT and a verification
 *   token only this device can redeem
 * - /auth/logout - Clear auth cookie
 *
 * The JWT token is stored in localStorage and sent with API requests. The
 * Turnkey session (lib/turnkeySession) is completed by this client, never by
 * the server, and is the only thing that can use the author's Turnkey key.
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
import { useAuthorDid } from "./useAuthorDid";
import { clearCurrentAuthor, ensureAuthorDid } from "../lib/authorIdentity";
import { getConvexHttpUrl } from "../lib/convexUrls";
import { storageAdapter } from "../lib/storageAdapter";
import { identifyUser, resetAnalytics } from "../lib/analytics";
import {
  clearTurnkeySession,
  completeTurnkeyLogin,
  discardSessionKey,
  encryptOtpForSession,
  startTurnkeySessionRefresh,
} from "../lib/turnkeySession";

/** Best effort: end a boop session the client is giving up on, and its cookie. */
async function revokeServerSession(token: string): Promise<void> {
  try {
    await withTimeout(fetch(`${getConvexHttpUrl()}/auth/logout`, {
      method: "POST", headers: { Authorization: `Bearer ${token}` }, credentials: "include",
    }), 15_000, "Logout endpoint timed out");
  } catch (err) {
    console.warn("[useAuth] Could not revoke the abandoned session:", err);
  }
}

/** Turnkey steps never hold up boop's own sign-in or sign-out for longer than this. */
const TURNKEY_STEP_MS = 15_000;
/** A new account's author DID: the audit (up to 30 s), the mint and two writes. */
const AUTHOR_DID_SETUP_MS = 60_000;

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
  /** Turnkey enclave target the code is encrypted to; its signature is checked before use. */
  otpEncryptionTargetBundle: string | null;
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
    otpEncryptionTargetBundle: null,
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
    let cancelled = false;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;

    const restoreSession = async () => {
      let retrying = false;
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
            // Signed out of boop, so out of Turnkey too.
            void clearTurnkeySession();
            if (isMountedRef.current) setIsLoading(false);
            return;
          }
        } catch {
          console.warn("[useAuth] Could not parse JWT for expiry check, proceeding anyway");
        }

        // Restore auth state
        try {
          await withAuthTimeout(convex.mutation(api.actorSession.establish, { authToken: parsed.token }));
        } catch (err) {
          const code = authErrorData(err)?.code;
          const rejected = code === "INVALID_TOKEN" || code === "UNAUTHORIZED";
          if (Capacitor.isNativePlatform() && !rejected) {
            // Keep stored credentials and wait for server acceptance before exposing them.
            retrying = true;
            if (!cancelled) retryTimer = setTimeout(() => void restoreSession(), 5000);
            return;
          }
          throw err;
        }
        if (cancelled) return;
        // An older build cached `did:temp` when the server had no DID. Which
        // DID the account has is the server's to say: one with none is refused
        // on every call, and only an OTP sign-up can mint one now (#286), so
        // that session is dropped. A did:key or did:temp the server does hold
        // is kept; useAuthorDid re-mints it.
        if (!parsed.user?.did?.startsWith("did:webvh:")) {
          let account: { did?: string } | null;
          try {
            account = await withAuthTimeout(convex.query(api.auth.getUserByTurnkeyId, {
              turnkeySubOrgId: parsed.user.turnkeySubOrgId, authToken: parsed.token,
            })) as { did?: string } | null;
          } catch (err) {
            const code = authErrorData(err)?.code;
            // As for establish: on native, keep the session through a transient failure.
            if (Capacitor.isNativePlatform() && code !== "INVALID_TOKEN" && code !== "UNAUTHORIZED") {
              retrying = true;
              if (!cancelled) retryTimer = setTimeout(() => void restoreSession(), 5000);
              return;
            }
            throw err;
          }
          // Only the server answering that it holds no DID drops the session.
          if (!account?.did) {
            void revokeServerSession(parsed.token);
            throw new Error("Stored session has no DID; sign in again");
          }
          parsed.user = { ...parsed.user, did: account.did };
          await storageAdapter.set(AUTH_STORAGE_KEY, JSON.stringify(parsed));
        }
        if (cancelled) return;
        setUser(parsed.user);
        setToken(parsed.token);
        await storageAdapter.set(JWT_STORAGE_KEY, parsed.token);

        // useAuthorDid moves the account onto an author DID once its Turnkey
        // session is live (#286); nothing is minted here.
      } catch (err) {
        console.error("[useAuth] Error restoring session:", err);
        setUser(null);
        setToken(null);
        await storageAdapter.remove(AUTH_STORAGE_KEY);
        await storageAdapter.remove(JWT_STORAGE_KEY);
        // Signed out of boop, so out of Turnkey too.
        void clearTurnkeySession();
      } finally {
        if (!cancelled && !retrying) {
          authTransitionRef.current = false;
          setIsLoading(false);
        }
      }
    };

    restoreSession();

    return () => {
      cancelled = true;
      clearTimeout(retryTimer);
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

        const { sessionId, otpEncryptionTargetBundle } = await response.json();
        console.log("[useAuth] OTP initiated, sessionId:", sessionId);

        setOtpFlowState({ sessionId, email, otpEncryptionTargetBundle: otpEncryptionTargetBundle ?? null });
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
      if (!otpFlowState.sessionId || !otpFlowState.email || !otpFlowState.otpEncryptionTargetBundle) {
        throw new Error("OTP flow not started. Call startOtp first.");
      }

      if (authTransitionRef.current) throw new Error("Authentication is already in progress");
      authTransitionRef.current = true;
      setIsLoading(true);
      let sessionPublicKey: string | null = null;
      // Set once /auth/verify issued a boop session, so a later failure revokes it.
      let issuedToken: string | null = null;
      // Set once this sign-in's Turnkey login succeeded or timed out (it may still land).
      let turnkeyLoginMayHaveLanded = false;
      try {
        console.log("[useAuth] Verifying OTP via server...");

        // No plaintext fallback: the server refuses codes it could read.
        const { encryptedOtpBundle, publicKey } = await withTimeout(
          encryptOtpForSession(code, otpFlowState.otpEncryptionTargetBundle),
          TURNKEY_STEP_MS, "Couldn't prepare a secure sign-in on this device. Reload and try again.");
        sessionPublicKey = publicKey;

        const httpUrl = getConvexHttpUrl();
        const response = await fetch(`${httpUrl}/auth/verify`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          credentials: "include", // Include cookies for httpOnly auth cookie
          body: JSON.stringify({
            sessionId: otpFlowState.sessionId,
            encryptedOtpBundle,
            platform: Capacitor.getPlatform(),
          }),
        });

        if (!response.ok) {
          const errorData = await response.json();
          throw new Error(errorData.error || "Verification failed");
        }

        const { token: jwtToken, user: serverUser, turnkey } = await response.json();
        issuedToken = jwtToken;
        console.log("[useAuth] OTP verified, got JWT for:", serverUser.email);

        // The Turnkey session only gates DID updates, so a failure here must not
        // block sign-in; the next OTP login retries it.
        try {
          if (!turnkey?.verificationToken) throw new Error("Server returned no Turnkey verification token");
          // Only the login itself is awaited; the audit runs on in the background.
          await withTimeout(completeTurnkeyLogin({
            verificationToken: turnkey.verificationToken,
            subOrgId: turnkey.subOrgId,
            publicKey,
          }), TURNKEY_STEP_MS, "Turnkey login timed out");
          turnkeyLoginMayHaveLanded = true;
        } catch (turnkeyErr) {
          console.error("[useAuth] Turnkey session login failed:", turnkeyErr);
          // After a timeout the login may still land and use this key; keep it.
          if (turnkeyErr instanceof TimeoutError) turnkeyLoginMayHaveLanded = true;
          else await discardSessionKey(publicKey);
        }
        sessionPublicKey = null;

        await withAuthTimeout(convex.mutation(api.actorSession.establish, { authToken: jwtToken }));

        // A new account has no DID, and the server refuses every call from an
        // account without one. Its author DID can only be minted through this
        // Turnkey session (#286), so sign-up finishes only once it exists: a
        // failure here fails sign-in, to be retried, rather than leaving an
        // account that can do nothing. An account with any DID the server
        // holds (did:webvh, or a legacy did:key/did:temp) signs in on it, and
        // useAuthorDid moves it onto an author DID when it can.
        let userDid: string = serverUser.did;
        if (!userDid) {
          const authored = await withTimeout(
            ensureAuthorDid({ did: serverUser.did, turnkeySubOrgId: serverUser.turnkeySubOrgId }, jwtToken),
            AUTHOR_DID_SETUP_MS, "Setting up your account timed out");
          if (authored.status === "not-ready" || authored.status === "kept") {
            throw new Error("We couldn't finish setting up your account. Please request a new code and try again.");
          }
          userDid = authored.did;
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
        setOtpFlowState({ sessionId: null, email: null, otpEncryptionTargetBundle: null });

        // Identify user in analytics
        identifyUser(authUser.turnkeySubOrgId, { email_domain: authUser.email.split('@')[1] });

        console.log("[useAuth] Authentication complete, DID:", userDid);
      } catch (err) {
        console.error("[useAuth] Failed to verify OTP:", err);
        // /auth/verify already established a server session and set its cookie.
        if (issuedToken) void revokeServerSession(issuedToken);
        if (sessionPublicKey) await discardSessionKey(sessionPublicKey);
        // boop sign-in failed after this sign-in's Turnkey login (or one that
        // may still land): don't leave it behind. Never clear a session this
        // sign-in didn't create, e.g. another tab's.
        else if (turnkeyLoginMayHaveLanded) void clearTurnkeySession();
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
    setOtpFlowState({ sessionId: null, email: null, otpEncryptionTargetBundle: null });
    resetAnalytics();

    clearCurrentAuthor();
    try {
      await storageAdapter.remove(AUTH_STORAGE_KEY);
      await storageAdapter.remove(JWT_STORAGE_KEY);
      const httpUrl = getConvexHttpUrl();
      await withTimeout(fetch(`${httpUrl}/auth/logout`, {
        method: "POST",
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        credentials: "include",
      }), TURNKEY_STEP_MS, "Logout endpoint timed out");
    } catch (err) {
      console.error("[useAuth] Logout endpoint failed:", err);
    }
    try {
      // After boop's own session is gone, and even if the endpoint failed: a
      // slow Turnkey must not keep a signed-out device signed in.
      await withTimeout(clearTurnkeySession(), TURNKEY_STEP_MS, "Turnkey sign-out timed out");
    } catch (err) {
      console.warn("[useAuth] Turnkey session not cleared:", err);
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
    try {
      const { exp } = JSON.parse(atob(token.split(".")[1]));
      if (exp === undefined) return; // Persistent mobile session, validated by the server.
      expiresAt = exp * 1000;
    }
    catch { return; }
    return onSessionExpiry(expiresAt, () => {
      setToken(null);
      setUser(null);
      void storageAdapter.remove(AUTH_STORAGE_KEY);
      void storageAdapter.remove(JWT_STORAGE_KEY);
      void clearTurnkeySession();
    });
  }, [token]);

  // Keep this device's Turnkey session alive (7 days, refreshed silently).
  const subOrgId = user?.turnkeySubOrgId;
  useEffect(() => {
    if (!subOrgId) return;
    return startTurnkeySessionRefresh(subOrgId);
  }, [subOrgId]);

  // Moves the account onto an author DID (#286), including identities minted
  // on a domain we no longer serve.
  const adoptAuthorDid = useCallback((did: string) => {
    setUser(current => {
      if (!current) return current;
      const next = { ...current, did };
      if (token) void storageAdapter.set(AUTH_STORAGE_KEY, JSON.stringify({ user: next, token }));
      return next;
    });
  }, [token]);
  useAuthorDid(user, token, adoptAuthorDid);

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
