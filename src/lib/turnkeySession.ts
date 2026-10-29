/**
 * The author's Turnkey session, held by this client (#286).
 *
 * The session key is a non-extractable P-256 key the client generates
 * (IndexedDbStamper; the Capacitor WebView uses the same store). Login binds
 * it to the email OTP: the code is encrypted to Turnkey's enclave together
 * with the session public key, our server only relays the ciphertext, and the
 * resulting verification token can only be redeemed by the holder of this key.
 * So boop's backend can start an OTP but can never obtain the session.
 *
 * The session's only job is DID control: signing updates to the author's
 * did:webvh with the author's Turnkey Ed25519 key. Routine records are signed
 * by device keys, so an expired session blocks DID updates and nothing else.
 *
 * See docs/turnkey-custody.md for the Turnkey-side guarantees this relies on.
 */
import { TurnkeyClient, decodeVerificationToken } from "@turnkey/core";
import { encryptOtpCodeToBundle } from "@turnkey/crypto";
import { withTimeout } from "./authTimeout";

/** Decided on #286: seven days, refreshed silently while the app is used. */
export const TURNKEY_SESSION_SECONDS = 7 * 24 * 60 * 60;
/** Refresh once less than this remains, so each device holds at most ~2 live keys (Turnkey allows 10 per user). */
const REFRESH_WINDOW_SECONDS = 2 * 24 * 60 * 60;
const REFRESH_CHECK_MS = 60 * 60 * 1000;
const AUDIT_STORAGE_PREFIX = "boop-turnkey-audit";
/**
 * A session key created this soon after the sub-org's root user is the
 * sign-up device's first login: the sub-org is created when the email is
 * verified and the client logs in straight after. Another device can't get an
 * emailed code and sign in this fast in practice.
 */
const FIRST_LOGIN_WINDOW_SECONDS = 60;
/** Every session step (login, refresh) holds this cross-tab lock, released after at most this long. */
const SESSION_LOCK = "boop-turnkey-session";
const SESSION_LOCK_HOLD_MS = 30_000;
const AUDIT_MS = 30_000;

/**
 * Sub-org features that let the parent org choose a credential's target key
 * (or bypass the email OTP) and so would let boop's backend obtain a session.
 */
export const PARENT_INITIATED_AUTH_FEATURES = [
  "FEATURE_NAME_EMAIL_AUTH",
  "FEATURE_NAME_EMAIL_RECOVERY",
  "FEATURE_NAME_ROOT_USER_EMAIL_RECOVERY",
  "FEATURE_NAME_SMS_AUTH",
] as const;

export type TurnkeySessionStatus = "active" | "expired" | "none";

export interface SubOrgAudit {
  subOrgId: string;
  checkedAt: number;
  /** True when nothing but this user's own email OTP sessions can act in the sub-org. */
  clean: boolean;
  findings: string[];
  /** Findings that stay recorded on this device: evidence that can't be seen again later. */
  sticky?: string[];
}

/**
 * Run a session step under one cross-tab lock. Tabs share the session and its
 * key pairs, and login and refresh both delete unused key pairs, so two at
 * once can leave the session on a deleted key. A hung step releases the lock.
 */
function withSessionLock<T>(step: () => Promise<T>): Promise<T> {
  const bounded = () => withTimeout(step(), SESSION_LOCK_HOLD_MS, "Turnkey session step timed out");
  const locks = typeof navigator !== "undefined" ? navigator.locks : undefined;
  if (locks) return locks.request(SESSION_LOCK, bounded) as Promise<T>;
  // No Web Locks (iOS before 15.4): serialise within this tab at least.
  const run = localLock.then(bounded, bounded);
  localLock = run.catch(() => {});
  return run;
}
let localLock: Promise<unknown> = Promise.resolve();

const seconds = (timestamp?: { seconds?: string; nanos?: string }) =>
  Number(timestamp?.seconds ?? 0) + Number(timestamp?.nanos ?? 0) / 1e9;

const auditsInFlight = new Map<string, Promise<SubOrgAudit>>();

let clientPromise: Promise<TurnkeyClient> | null = null;

function getClient(): Promise<TurnkeyClient> {
  clientPromise ??= (async () => {
    const client = new TurnkeyClient({
      apiBaseUrl: "https://api.turnkey.com",
      // Only a default; every call below names the author's sub-org explicitly.
      organizationId: (import.meta.env.VITE_TURNKEY_ORGANIZATION_ID as string | undefined) ?? "unset",
    });
    await client.init();
    return client;
  })();
  clientPromise.catch(() => { clientPromise = null; });
  return clientPromise;
}

/**
 * Generate the key this login's Turnkey session will be bound to, and encrypt
 * the code with it. `encryptOtpCodeToBundle` checks the target bundle's enclave
 * signature first, so a server that substitutes its own encryption target is
 * refused here rather than learning the code.
 */
export async function encryptOtpForSession(code: string, otpEncryptionTargetBundle: string): Promise<{
  encryptedOtpBundle: string;
  publicKey: string;
}> {
  const client = await getClient();
  const publicKey = await client.createApiKeyPair();
  try {
    const encryptedOtpBundle = await encryptOtpCodeToBundle(code, otpEncryptionTargetBundle, publicKey,
      // Dev/E2E only: production builds compile this to undefined (Turnkey's own signer).
      import.meta.env.DEV ? import.meta.env.VITE_TURNKEY_TEST_OTP_SIGNER as string | undefined : undefined);
    return { encryptedOtpBundle, publicKey };
  } catch (err) {
    await discardSessionKey(publicKey);
    throw err;
  }
}

/** Remove a key pair that never became a session (wrong code, server error). */
export async function discardSessionKey(publicKey: string): Promise<void> {
  try {
    const client = await getClient();
    // A login can fail after storing its session (core's key-pair cleanup runs
    // in a finally): never delete the key a live session uses.
    if ((await client.getSession())?.publicKey === publicKey) return;
    await client.deleteApiKeyPair({ publicKey });
  } catch (err) {
    console.warn("[turnkeySession] Could not discard unused session key:", err);
  }
}

/**
 * Redeem the verification token for a Turnkey session (attested STAMP_LOGIN,
 * sent by this client straight to Turnkey), then start closing parent-initiated
 * auth paths and auditing the sub-org in the background (`subOrgAuditDone`).
 * Throws only if the login itself fails.
 */
export async function completeTurnkeyLogin(params: {
  verificationToken: string;
  subOrgId: string;
  publicKey: string;
}): Promise<void> {
  const client = await getClient();
  const { public_key: boundKey } = decodeVerificationToken(params.verificationToken) as { public_key?: string };
  if (boundKey !== params.publicKey) {
    await discardSessionKey(params.publicKey);
    throw new Error("Verification token is not bound to this device's session key");
  }
  // This login's audit replaces the last one. Until it writes a result, the
  // stored audit says pending, so a refresh check retries it even if this
  // login's own audit never starts (#299 review).
  markAuditPending(params.subOrgId);
  await withSessionLock(async () => {
    await client.loginWithOtp({
      verificationToken: params.verificationToken,
      organizationId: params.subOrgId,
      expirationSeconds: String(TURNKEY_SESSION_SECONDS),
    });
    await client.clearUnusedKeyPairs().catch(() => {});
  });
  void runAudit(params.subOrgId);
}

function markAuditPending(subOrgId: string): void {
  const sticky = lastSubOrgAudit(subOrgId)?.sticky ?? [];
  const pending: SubOrgAudit = { subOrgId, checkedAt: Date.now(), clean: false, findings: [...sticky, AUDIT_INCOMPLETE], sticky };
  try { localStorage.setItem(`${AUDIT_STORAGE_PREFIX}:${subOrgId}`, JSON.stringify(pending)); } catch { /* storage unavailable */ }
}

/** Harden and audit, sharing one run per sub-org between every caller (login, retries). */
function runAudit(subOrgId: string): Promise<SubOrgAudit> {
  const running = auditsInFlight.get(subOrgId);
  if (running) return running;
  // Bounded: refresh waits on it, and Turnkey requests have no timeout of
  // their own. A run that hangs is dropped; the next check starts a fresh one.
  const audit = withTimeout(hardenAndAuditSubOrg(subOrgId), AUDIT_MS, "Turnkey audit timed out");
  auditsInFlight.set(subOrgId, audit);
  void audit.finally(() => { if (auditsInFlight.get(subOrgId) === audit) auditsInFlight.delete(subOrgId); }).catch(() => {});
  return audit;
}

/** Wait for an audit this login started, then return this device's latest audit. */
export async function subOrgAuditDone(subOrgId: string): Promise<SubOrgAudit | null> {
  await auditsInFlight.get(subOrgId)?.catch(() => {}); // bounded by AUDIT_MS
  return lastSubOrgAudit(subOrgId);
}

/**
 * Sub-orgs created before #286 still allow EMAIL_AUTH and email recovery,
 * which the parent org can start with a target key of its choosing. Only the
 * sub-org's root user can remove them, so this session does it at login.
 * Then record anything other than this user's own sessions that could act.
 */
export async function hardenAndAuditSubOrg(subOrgId: string): Promise<SubOrgAudit> {
  const findings: string[] = [];
  const sticky = [...(lastSubOrgAudit(subOrgId)?.sticky ?? [])];
  try {
    const client = await getClient();
    const session = await client.getSession();
    const { configs } = await client.httpClient.getOrganizationConfigs({ organizationId: subOrgId });
    for (const feature of configs.features ?? []) {
      if (!(PARENT_INITIATED_AUTH_FEATURES as readonly string[]).includes(feature.name ?? "")) continue;
      try {
        await client.httpClient.removeOrganizationFeature({ organizationId: subOrgId, name: feature.name! });
      } catch (err) {
        findings.push(`${DISABLE_FAILED} ${feature.name}`);
        console.error("[turnkeySession] Failed to disable sub-org feature:", feature.name, err);
      }
    }

    const { users } = await client.httpClient.getUsers({ organizationId: subOrgId });
    if (users.length !== 1 || users[0].userId !== session?.userId) {
      findings.push(`sub-org has ${users.length} users`);
    }
    // boop creates sub-orgs with no credentials and only ever adds this user's
    // own login keys. The parent picks the root user's credentials at creation,
    // so a passkey, OAuth provider, phone number or longer-lived API key there
    // could be the backend's own (#299 review). Flag them all.
    for (const user of users) {
      if (user.authenticators.length > 0) findings.push(`user ${user.userId} has ${user.authenticators.length} passkeys`);
      if (user.oauthProviders.length > 0) findings.push(`user ${user.userId} has ${user.oauthProviders.length} OAuth providers`);
      if (user.userPhoneNumber) findings.push(`user ${user.userId} has a phone number`);
      const foreign = user.apiKeys.filter(key => !(Number(key.expirationSeconds) > 0 && Number(key.expirationSeconds) <= TURNKEY_SESSION_SECONDS));
      if (foreign.length > 0) findings.push(`user ${user.userId} has ${foreign.length} API keys that outlive a session`);
      // A session-length key planted at creation could renew itself forever
      // (STAMP_LOGIN), and later looks like any other login. It can only be
      // told apart here: on the sign-up device, at its first login, no other
      // key can legitimately exist yet. Recorded as sticky, since no later
      // audit can see it. (A second device signing in within the window would
      // be flagged too; see docs/turnkey-custody.md.)
      const own = user.apiKeys.find(key => key.credential.publicKey === session?.publicKey);
      if (own && seconds(own.createdAt) - seconds(user.createdAt) < FIRST_LOGIN_WINDOW_SECONDS) {
        const earlier = user.apiKeys.filter(key => key !== own && seconds(key.createdAt) <= seconds(own.createdAt));
        if (earlier.length > 0) sticky.push(`user ${user.userId} had ${earlier.length} API keys before its first login`);
      }
    }
    const quorum = configs.quorum;
    if (!quorum || quorum.threshold !== 1 || quorum.userIds.length !== 1 || quorum.userIds[0] !== session?.userId) {
      findings.push("root quorum is not this user alone");
    }
  } catch (err) {
    console.error("[turnkeySession] Sub-org audit failed:", err);
    findings.push(AUDIT_INCOMPLETE);
  }
  const all = [...new Set([...sticky, ...findings])];
  const audit: SubOrgAudit = { subOrgId, checkedAt: Date.now(), clean: all.length === 0, findings: all, sticky: [...new Set(sticky)] };
  try {
    localStorage.setItem(`${AUDIT_STORAGE_PREFIX}:${subOrgId}`, JSON.stringify(audit));
  } catch { /* storage unavailable: the audit reruns at next login */ }
  if (!audit.clean) console.warn("[turnkeySession] Sub-org audit findings:", audit.findings);
  return audit;
}

/** The last audit this device ran; DID updates refuse to sign without a clean one. */
export function lastSubOrgAudit(subOrgId: string): SubOrgAudit | null {
  try {
    const stored = localStorage.getItem(`${AUDIT_STORAGE_PREFIX}:${subOrgId}`);
    return stored ? JSON.parse(stored) as SubOrgAudit : null;
  } catch {
    return null;
  }
}

export async function turnkeySessionStatus(subOrgId: string): Promise<TurnkeySessionStatus> {
  const session = await (await getClient()).getSession();
  if (!session || session.organizationId !== subOrgId) return "none";
  return session.expiry * 1000 > Date.now() ? "active" : "expired";
}

/**
 * Silent refresh: STAMP_LOGIN stamped by the current session key, for a new
 * key pair. Never `invalidateExisting`, which would sign out the user's other
 * devices. Returns the status after any refresh.
 */
export async function refreshTurnkeySessionIfDue(subOrgId: string): Promise<TurnkeySessionStatus> {
  return withSessionLock(() => refreshUnlocked(subOrgId));
}

async function refreshUnlocked(subOrgId: string): Promise<TurnkeySessionStatus> {
  const client = await getClient();
  const session = await client.getSession();
  if (!session || session.organizationId !== subOrgId) return "none";
  const remaining = session.expiry - Date.now() / 1000;
  if (remaining <= 0) return "expired";
  if (remaining > REFRESH_WINDOW_SECONDS) return "active";
  await client.refreshSession({ expirationSeconds: String(TURNKEY_SESSION_SECONDS) });
  await client.clearUnusedKeyPairs().catch(() => {});
  return "active";
}

/** Check hourly and whenever the app returns to the foreground. */
const AUDIT_INCOMPLETE = "audit could not complete";
const DISABLE_FAILED = "could not disable";

/**
 * Findings from a step that failed rather than from something found (a
 * network blip, a feature removal that didn't go through): worth running the
 * audit again for. Anything else stands until the next OTP login.
 */
function auditNeedsRetry(audit: SubOrgAudit | null): boolean {
  return !audit || audit.findings.some(f => f === AUDIT_INCOMPLETE || f.startsWith(DISABLE_FAILED));
}

export function startTurnkeySessionRefresh(subOrgId: string): () => void {
  const check = async () => {
    try {
      // Retry an unfinished audit before refreshing: the first-login check
      // compares against this device's current key, which a refresh replaces.
      if (auditNeedsRetry(await subOrgAuditDone(subOrgId)) && await turnkeySessionStatus(subOrgId) === "active") {
        await runAudit(subOrgId);
      }
    } catch (err) {
      console.warn("[turnkeySession] Sub-org audit failed; retrying later:", err);
    }
    // Whatever the audit did, the session must not lapse.
    try {
      await refreshTurnkeySessionIfDue(subOrgId);
    } catch (err) {
      console.warn("[turnkeySession] Silent refresh failed; retrying later:", err);
    }
  };
  void check();
  const interval = setInterval(() => void check(), REFRESH_CHECK_MS);
  const onVisible = () => { if (document.visibilityState === "visible") void check(); };
  document.addEventListener("visibilitychange", onVisible);
  return () => {
    clearInterval(interval);
    document.removeEventListener("visibilitychange", onVisible);
  };
}

const REVOKE_MS = 8_000;

/**
 * Logout: revoke this device's session key at Turnkey, then forget it locally.
 * Under the session lock, so it can't race a refresh or a login still landing.
 * The revoke is time-boxed and the local wipe always runs after it, inside the
 * lock, so a slow Turnkey can neither leave the session on this device nor
 * wipe a later sign-in's session when it finally answers (#299 review).
 */
export async function clearTurnkeySession(): Promise<void> {
  await withSessionLock(async () => {
    const client = await getClient();
    try {
      await withTimeout((async () => {
        const session = await client.getSession();
        if (!session?.publicKey || session.expiry * 1000 <= Date.now()) return;
        const { users } = await client.httpClient.getUsers({ organizationId: session.organizationId });
        const keyIds = users.flatMap(user => user.apiKeys)
          .filter(key => key.credential.publicKey === session.publicKey).map(key => key.apiKeyId);
        if (keyIds.length > 0) {
          await client.httpClient.deleteApiKeys({ organizationId: session.organizationId, userId: session.userId, apiKeyIds: keyIds });
        }
      })(), REVOKE_MS, "Turnkey revoke timed out");
    } catch (err) {
      console.warn("[turnkeySession] Could not revoke the Turnkey session key:", err);
    }
    // boop only uses the default session key. clearAllSessions doesn't await
    // its own wipe, so clear the session directly, then any stray key pairs.
    if (await client.getSession()) {
      await client.clearSession().catch(err => console.warn("[turnkeySession] Could not clear the local Turnkey session:", err));
    }
    await client.clearUnusedKeyPairs().catch(() => {});
  }).catch(err => console.warn("[turnkeySession] Turnkey sign-out did not finish:", err));
}
