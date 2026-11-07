/**
 * LWS access requests and grants (lws10-core "Access Requests and Grants",
 * docs/lws-agent-auth.md): the shape an agent may POST, the documents boop
 * returns, action → scope mapping, and the error bodies. Pure, so tests import
 * it directly.
 */
import { AGENT_SCOPES } from "./apiKeyHelpers";
import { decodeEd25519DidKey } from "../../shared/multikey";
import { parseStoragePath, storageRootUri, storageUri } from "./lwsUrls";

export const LWS_CONTEXT = "https://www.w3.org/ns/lws/v1";
export const LWS_JSON = "application/lws+json";
export const ACCESS_PROFILE = "https://www.w3.org/ns/lws#AccessProfile";

/**
 * Actions an agent may ask for. `modify` is the LWS spec's name for what
 * docs/lws-agent-auth.md calls `update`; both are accepted, and kept as sent.
 */
export const LWS_ACTIONS = ["read", "create", "update", "modify", "delete"] as const;
export type LwsAction = (typeof LWS_ACTIONS)[number];
export const MAX_AGENT_NAME_LENGTH = 60;
const DEFAULT_AGENT_NAME = "Agent";
const STORAGE_RESOURCE_TYPES = new Set(["StorageResource", "https://www.w3.org/ns/lws#StorageResource", "Container", "https://www.w3.org/ns/lws#Container"]);

type AgentScope = (typeof AGENT_SCOPES)[number];

/** `read` → lists:read and items:read; `create`, `update`/`modify`, `delete` → items:write. Never `*`. */
export function scopesForActions(actions: readonly string[]): AgentScope[] {
  const scopes = new Set<AgentScope>();
  for (const action of actions) {
    if (action === "read") { scopes.add("lists:read"); scopes.add("items:read"); }
    else if (action === "create" || action === "update" || action === "modify" || action === "delete") scopes.add("items:write");
    else throw new Error(`Unknown action ${action}`);
  }
  return AGENT_SCOPES.filter(scope => scopes.has(scope));
}

/** A non-empty list of distinct known actions, or null. */
export function parseActions(value: unknown): LwsAction[] | null {
  if (!Array.isArray(value) || value.length === 0 || value.length > LWS_ACTIONS.length) return null;
  if (!value.every((action): action is LwsAction => typeof action === "string" && (LWS_ACTIONS as readonly string[]).includes(action))) return null;
  return new Set(value).size === value.length ? value : null;
}

/** `requested` narrowed to `narrowed` (absent: unchanged). Null if that would add anything. */
export function narrowActions(requested: readonly string[], narrowed: readonly string[] | undefined): string[] | null {
  if (narrowed === undefined) return [...requested];
  const parsed = parseActions(narrowed);
  if (!parsed || !parsed.every(action => requested.includes(action))) return null;
  return parsed;
}

/** A display name: trimmed, NFC, 1–60 characters, no control or bidi-override characters. */
export function parseAgentName(value: unknown): string | null {
  if (value === undefined) return DEFAULT_AGENT_NAME;
  if (typeof value !== "string") return null;
  const name = value.normalize("NFC").trim();
  if (name.length === 0 || [...name].length > MAX_AGENT_NAME_LENGTH) return null;
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f-\u009f‎‏‪-‮⁦-⁩]/.test(name)) return null;
  return name;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const asSet = (value: unknown): string[] | null =>
  typeof value === "string" ? [value] : Array.isArray(value) && value.length > 0 && value.every(item => typeof item === "string") ? value as string[] : null;
const isAbsoluteUrl = (value: string) => { try { return /^https?:$/.test(new URL(value).protocol); } catch { return false; } };

export interface ParsedAccessRequest {
  storage: string;
  userPath: string;
  assignee: string;
  publicKeyMultibase: string;
  actions: LwsAction[];
  name: string;
}

/**
 * An `AccessRequest` boop can act on, or why not. One `AccessPolicy` for an
 * Ed25519 did:key assignee, on the storage root of a boop storage, with no
 * constraints (boop can't enforce any, so it refuses rather than ignore them).
 */
export function parseAccessRequest(body: unknown, base: string): { ok: true; value: ParsedAccessRequest } | { ok: false; detail: string } {
  const fail = (detail: string) => ({ ok: false as const, detail });
  if (!isRecord(body)) return fail("The body is not a JSON object");
  const context = asSet(body["@context"]);
  if (!context?.includes(LWS_CONTEXT)) return fail(`@context must include ${LWS_CONTEXT}`);
  if (!asSet(body.type)?.includes("AccessRequest")) return fail("type must include AccessRequest");
  if (typeof body.storage !== "string") return fail("storage is required");
  const parsed = parseStoragePath(body.storage, base);
  if (!parsed || parsed.subpath !== "") return fail("storage is not a storage on this server");
  if (body.inbox !== undefined && (typeof body.inbox !== "string" || !isAbsoluteUrl(body.inbox))) return fail("inbox must be a URL");
  const name = parseAgentName(body.name);
  if (name === null) return fail(`name must be 1 to ${MAX_AGENT_NAME_LENGTH} characters of text`);
  if (!Array.isArray(body.access) || body.access.length !== 1 || !isRecord(body.access[0])) return fail("access must hold exactly one AccessPolicy");
  const access = body.access[0];
  if (!asSet(access.type)?.includes("AccessPolicy")) return fail("the access type must include AccessPolicy");
  const actions = parseActions(access.action);
  if (!actions) return fail(`action must be distinct values of ${LWS_ACTIONS.join(", ")}`);
  if (typeof access.assignee !== "string") return fail("assignee is required");
  const key = decodeEd25519DidKey(access.assignee);
  if (!key) return fail("assignee must be an Ed25519 did:key");
  if (access.target !== undefined) {
    const target = access.target;
    if (!isRecord(target) || typeof target.type !== "string" || !STORAGE_RESOURCE_TYPES.has(target.type)) return fail("target must be a StorageResource");
    const values = Array.isArray(target.value) ? target.value : null;
    if (!values || values.length !== 1 || values[0] !== storageRootUri(parsed.userPath, base)) return fail("target must be the storage root");
  }
  if (access.constraint !== undefined && !(Array.isArray(access.constraint) && access.constraint.length === 0)) {
    return fail("constraints are not supported");
  }
  return { ok: true, value: { storage: storageUri(parsed.userPath, base), userPath: parsed.userPath, assignee: access.assignee, publicKeyMultibase: key.multikey, actions, name } };
}

function accessPolicy(row: { storage: string; agentDidKey: string }, actions: readonly string[]) {
  return {
    type: ["AccessPolicy"],
    action: [...actions],
    assignee: row.agentDidKey,
    target: { type: "StorageResource", value: [`${row.storage}/`] },
  };
}

export interface AccessRequestView {
  requestId: string;
  storage: string;
  agentDidKey: string;
  name: string;
  actions: string[];
  status: "pending" | "approved" | "denied" | "expired";
  createdAt: number;
  expiresAt: number;
  decidedAt?: number;
}

/**
 * The stored request as the agent sees it at its URL. Once approved and while
 * the agent is active: the `AccessGrant`, and the `verificationMethod` it signs
 * with (its JWT `kid`). An approved request whose agent was revoked reads
 * `revoked`, with no grant.
 */
export function accessRequestDocument(
  row: AccessRequestView,
  url: string,
  grant?: { vmId: string; actions: string[]; revoked: boolean },
) {
  const status = row.status === "approved" && grant?.revoked ? "revoked" : row.status;
  return {
    "@context": [LWS_CONTEXT],
    id: url,
    type: ["AccessRequest"],
    storage: row.storage,
    name: row.name,
    access: [accessPolicy(row, row.actions)],
    status,
    created: new Date(row.createdAt).toISOString(),
    expires: new Date(row.expiresAt).toISOString(),
    ...(row.decidedAt !== undefined ? { decided: new Date(row.decidedAt).toISOString() } : {}),
    ...(status === "approved" && grant ? {
      grant: {
        "@context": [LWS_CONTEXT],
        type: ["AccessGrant"],
        storage: row.storage,
        access: [accessPolicy(row, grant.actions)],
      },
      verificationMethod: grant.vmId,
    } : {}),
  };
}
