/**
 * This account's author DID and its Originals signer (#286 PR b).
 *
 * `ensureAuthorDid` runs after sign-in. With a live Turnkey session and a
 * clean sub-org audit it makes sure the account's did:webvh is an author DID
 * (shared/authorDid.ts): it keeps one that is, and otherwise mints a new one
 * through the session and moves the account to it (re-genesis, no continuity
 * link, as decided on #286). Without a session it does nothing; the account
 * keeps its DID and simply can't sign Originals until the next login.
 *
 * `turnkeyListAuthorSource` is what PR e passes to `setListAuthorSource`.
 */
import { getConvexHttpUrl } from "./convexUrls";
import { authorSigningReady, turnkeyAuthorBackend } from "./turnkeySession";
import {
  buildListAuthor,
  inspectAuthorDid,
  mintAuthorDid,
  resolveAuthorKeys,
  type AuthorKeyBackend,
  type AuthorKeys,
} from "./authorDid";
import { currentWebvhDomain, domainFromDidSafe, forgetLegacyDidKey, userDidPath } from "./webvh";
import type { EntrySummary, ListAuthor } from "./originalsSigning";
import { AgentKeyError, publishAgentChange, servedChangeApplied, type AgentKeyDeps, type AgentKeyResult, type AgentKeyStep } from "./agentKeys";
import type { AgentMethodChange } from "../../shared/authorDid";

export interface CurrentAuthor {
  subOrgId: string;
  did: string;
  log: string;
  versionId: string;
  keys: AuthorKeys;
}

let current: CurrentAuthor | null = null;
let confirmSigning: ((display: string, summary: EntrySummary) => boolean | Promise<boolean>) | undefined;

/** Forget the signed-in author (logout, account switch). */
export function clearCurrentAuthor(): void {
  current = null;
}

/** The signed-in author DID this device confirmed, or null (src/lib/actionSigning.ts). */
export function currentAuthor(): CurrentAuthor | null {
  return current;
}

/**
 * After this device published a DID update (src/lib/agentKeys.ts): Originals
 * signs at the new version, with the new log as its evidence. Ignored when
 * the update is for another DID than the cached one (an account switch).
 */
export function updateCurrentAuthorLog(did: string, log: string, versionId: string): void {
  if (current?.did === did) current = { ...current, log, versionId };
}

/** Whether this device can sign a DID update now: a confirmed author and a live Turnkey session. */
export async function agentKeySigningReady(): Promise<boolean> {
  const author = current;
  return !!author && (await authorSigningReady(author.subOrgId));
}

/**
 * Add or remove an agent key in the signed-in author's DID, then sign
 * Originals at the version that makes. A change the served DID already has
 * needs no signature, so it goes straight through, even without a confirmed
 * author or a live Turnkey session, when `account` names whose DID to read
 * (an approval whose grant failed after its DID update). Otherwise, without
 * a confirmed author (no live Turnkey session at sign-in), it throws
 * AgentKeyError "not-ready": sign in again. `deps` defaults to the real
 * Turnkey session and Convex URL.
 */
export async function changeAuthorAgentKey(
  change: AgentMethodChange,
  token: string,
  onStep?: (step: AgentKeyStep) => void,
  deps: AgentKeyDeps = { backend: turnkeyAuthorBackend(), ready: authorSigningReady, fetch: (...args) => fetch(...args), httpUrl: getConvexHttpUrl(), token },
  account?: { subOrgId: string; did: string },
): Promise<AgentKeyResult> {
  const author = current;
  if (!author) {
    const applied = account ? await servedChangeApplied(deps, account, change) : null;
    if (applied) return applied;
    throw new AgentKeyError("not-ready", "Sign in again to change your agents: this device hasn't confirmed your signing keys.");
  }
  const result = await publishAgentChange(author, change, deps, onStep);
  updateCurrentAuthorLog(result.did, result.log, result.versionId);
  return result;
}

/**
 * Show what is about to be signed (`describeEntry` text, recomputed by the
 * signer) and return false to refuse. Optional: without it entries are signed
 * without a prompt, as keySigner does without `confirm`.
 */
export function setOriginalsSigningConfirm(confirm: typeof confirmSigning): void {
  confirmSigning = confirm;
}

/**
 * This account's ListAuthor for Originals 5, or null when it can't sign now:
 * nobody signed in, no author DID yet, or no live Turnkey session (Originals
 * signing is online-only and waits for the next login).
 *
 * Shape (src/lib/originalsSigning.ts, compatible with @originals/sdk 6.0.0):
 *   { author: { did, verificationMethod: `${did}#orig-1`, versionId },
 *     signer: OriginalsSigner (eddsa-jcs-2022, Turnkey signRawPayload),
 *     evidence: { did, log, source: "supplied", obtainedAt } }
 */
export async function turnkeyListAuthorSource(): Promise<ListAuthor | null> {
  const author = current;
  if (!author || !(await authorSigningReady(author.subOrgId))) return null;
  return buildListAuthor({
    backend: turnkeyAuthorBackend(),
    subOrgId: author.subOrgId,
    keys: author.keys,
    did: author.did,
    versionId: author.versionId,
    log: author.log,
    confirm: confirmSigning,
  });
}

export interface EnsureAuthorDidDeps {
  backend: AuthorKeyBackend;
  ready(subOrgId: string): Promise<boolean>;
  fetch: typeof fetch;
  httpUrl: string;
  domain: string;
}

export type EnsureAuthorDidResult =
  | { status: "not-ready" }
  | { status: "current"; did: string }
  /** The account moved to `did`; rows keyed to the old DID moved with it (remint). */
  | { status: "reminted"; did: string; previousDid: string }
  /** The account is already on `did` (another device moved it); this device had `previousDid` cached. */
  | { status: "moved"; did: string; previousDid: string }
  /** The server kept the account on `did`, which this device couldn't confirm as an author DID. */
  | { status: "kept"; did: string }
  /** A first did:webvh for an account that had none. */
  | { status: "adopted"; did: string };

async function post(deps: EnsureAuthorDidDeps, token: string, route: string, body: unknown): Promise<unknown> {
  const response = await deps.fetch(`${deps.httpUrl}${route}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    credentials: "include",
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error(`${route} failed: ${response.status} ${await response.text()}`);
  return response.json();
}

async function servedLog(deps: EnsureAuthorDidDeps, path: string): Promise<string | null> {
  const response = await deps.fetch(`${deps.httpUrl}/api/did/log?path=${encodeURIComponent(path)}`);
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`/api/did/log failed: ${response.status}`);
  return response.text();
}

export async function ensureAuthorDid(
  user: { did?: string | null; turnkeySubOrgId: string },
  token: string,
  deps: EnsureAuthorDidDeps = defaultDeps(),
): Promise<EnsureAuthorDidResult> {
  const subOrgId = user.turnkeySubOrgId;
  if (!(await deps.ready(subOrgId))) return { status: "not-ready" };
  const keys = await resolveAuthorKeys(deps.backend, subOrgId);
  const path = userDidPath(subOrgId);
  // Any DID the server holds, did:webvh or a legacy did:key/did:temp: it owns
  // rows, so moving off it is a re-mint (rows move with it), never an adopt.
  const did = user.did || null;

  // What the path serves already, if it is this account's author DID on the
  // current domain. A DID on a domain we no longer serve is unresolvable, so
  // it is re-genesised like any pre-#286 DID.
  const log = await servedLog(deps, path);
  const inspected = log ? await inspectAuthorDid(log, keys).catch(() => null) : null;
  if (log && inspected && inspected.problems.length === 0 && domainFromDidSafe(inspected.did) === deps.domain) {
    current = { subOrgId, did: inspected.did, log, versionId: inspected.versionId, keys };
    if (inspected.did === did) return { status: "current", did };
    if (!did) {
      // A sign-up whose updateDID failed after its log was stored: adopt that DID, don't mint another.
      await post(deps, token, "/api/user/updateDID", { did: inspected.did });
      return { status: "adopted", did: inspected.did };
    }
    // Another device already moved the account (its rows moved with it); this one had the old DID cached.
    return { status: "moved", did: inspected.did, previousDid: did };
  }

  const minted = await mintAuthorDid({ backend: deps.backend, subOrgId, keys, domain: deps.domain, path });
  if (did) {
    const result = await post(deps, token, "/api/user/remintDid", { did: minted.did, didLog: minted.jsonl, path }) as { newDid: string | null };
    if (result.newDid !== minted.did) {
      // The server kept the account where it is: nothing changed, so no reload (#300 review).
      if (!result.newDid || result.newDid === did) return { status: "kept", did };
      // Another re-mint moved the account first; its DID is the one served.
      return { status: "moved", did: result.newDid, previousDid: did };
    }
    current = { subOrgId, did: minted.did, log: minted.jsonl, versionId: minted.versionId, keys };
    forgetLegacyDidKey(subOrgId);
    return { status: "reminted", did: minted.did, previousDid: did };
  }
  await post(deps, token, "/api/did/log", { userDid: minted.did, path, log: minted.jsonl });
  await post(deps, token, "/api/user/updateDID", { did: minted.did });
  current = { subOrgId, did: minted.did, log: minted.jsonl, versionId: minted.versionId, keys };
  return { status: "adopted", did: minted.did };
}

function defaultDeps(): EnsureAuthorDidDeps {
  return {
    backend: turnkeyAuthorBackend(),
    ready: authorSigningReady,
    fetch: (...args) => fetch(...args),
    httpUrl: getConvexHttpUrl(),
    domain: currentWebvhDomain(),
  };
}
