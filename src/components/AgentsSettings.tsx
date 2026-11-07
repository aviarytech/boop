/**
 * Settings → Agents (docs/lws-agent-auth.md, "App"): LWS agents' access
 * requests and the agents the owner approved.
 *
 * Approving adds the agent's key to the owner's did:webvh first (signed with
 * Turnkey, saved to /api/did/log), then grants access (approveAccessRequest,
 * which checks the stored DID lists the key). Revoking ends access first
 * (revokeAgent), then removes the key from the DID; a key left behind is
 * listed so it can be removed again.
 */
import { useCallback, useEffect, useState } from "react";
import { ConvexError } from "convex/values";
import { useMutation, useQuery } from "../lib/authenticatedConvex";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { useAuth } from "../hooks/useAuth";
import { getConvexHttpUrl } from "../lib/convexUrls";
import { formatRelativeTime } from "../lib/time";
import { changeAuthorAgentKey } from "../lib/authorIdentity";
import { AgentKeyError, fetchServedDidLog, servedDocument, shortKey, storageUrl, strayAgentMethods, type AgentKeyStep } from "../lib/agentKeys";
import { agentMethods, type DidDocumentLike } from "../../shared/authorDid";
import { Icon } from "./ui/Icon";

const ACTION_LABELS: Record<string, string> = { read: "Read", create: "Create", update: "Update", modify: "Update", delete: "Delete" };
const actionLabel = (action: string) => ACTION_LABELS[action] ?? action;

const button = "px-3 py-1.5 text-sm rounded-lg font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 disabled:opacity-50 disabled:cursor-not-allowed";
const primary = `${button} bg-amber-500 hover:bg-amber-600 text-white`;
const secondary = `${button} border border-[var(--boop-line)] text-[var(--boop-ink)] hover:bg-[color-mix(in_oklch,var(--boop-ink)_7%,var(--boop-panel))]`;
const danger = `${button} bg-red-500 hover:bg-red-600 text-white`;
const notice = "px-3 py-2 text-sm rounded-xl border";
const warn = `${notice} bg-amber-50 dark:bg-amber-900/20 border-amber-200 dark:border-amber-800 text-amber-800 dark:text-amber-300`;
const failure = `${notice} bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800 text-red-700 dark:text-red-400`;

function messageOf(error: unknown): string {
  if (error instanceof ConvexError && typeof error.data === "string") return error.data;
  if (error instanceof Error && error.message) return error.message;
  return "Something went wrong. Check your connection and try again.";
}

type Stage = AgentKeyStep | "granting";
const STAGES: Array<[Stage, string]> = [["signing", "Signing with Turnkey"], ["saving", "Saving your DID"], ["granting", "Granting access"]];

interface Progress {
  stage?: Stage;
  error?: string;
  /** The Turnkey session can't sign: sign in again. */
  signIn?: boolean;
  /** The DID has the key but approveAccessRequest failed: only the grant needs retrying. */
  grantFailed?: boolean;
}

interface PendingRequest {
  requestId: string;
  name: string;
  actions: string[];
  fragment: string;
  agentDidKey: string;
  agentPublicKeyMultibase: string;
  createdAt: number;
  expiresAt: number;
}

function PendingRow({ request, inDid, onApprove, onDeny, progress, onSignIn }: {
  request: PendingRequest;
  inDid: boolean;
  onApprove: (actions: string[]) => void;
  onDeny: () => void;
  progress: Progress | undefined;
  onSignIn: () => void;
}) {
  const [selected, setSelected] = useState<string[]>(request.actions);
  const busy = progress?.stage !== undefined && !progress.error;
  const labelId = `agent-request-${request.requestId}`;
  return (
    <li className="p-4 bg-[var(--boop-panel)] rounded-xl space-y-3" aria-labelledby={labelId}>
      <div className="flex items-start gap-3">
        <span className="flex items-center justify-center w-9 h-9 rounded-xl shrink-0 bg-[var(--boop-card)] text-[var(--boop-muted)] shadow-[0_0_0_1px_var(--boop-line)]">
          <Icon name="key" className="w-[18px] h-[18px]" />
        </span>
        <div className="min-w-0">
          <p id={labelId} className="font-medium text-[var(--boop-ink)] break-words">{request.name}</p>
          <p className="text-sm text-[var(--boop-muted)]">
            Key <span className="font-mono" title={request.agentDidKey}>{shortKey(request.agentDidKey)}</span>
            {" · "}asked {formatRelativeTime(request.createdAt)}
          </p>
        </div>
      </div>
      <fieldset>
        <legend className="text-sm text-[var(--boop-muted)] mb-1">It asks to (untick to allow less):</legend>
        <div className="flex flex-wrap gap-x-4 gap-y-1">
          {request.actions.map(action => (
            <label key={action} className="flex items-center gap-2 text-sm text-[var(--boop-ink)]">
              <input
                type="checkbox"
                className="w-4 h-4 accent-amber-500 focus-visible:ring-2 focus-visible:ring-amber-500"
                disabled={busy}
                checked={selected.includes(action)}
                onChange={e => setSelected(current => e.target.checked ? request.actions.filter(a => a === action || current.includes(a)) : current.filter(a => a !== action))}
              />
              {actionLabel(action)} items{action === "read" ? " and lists" : ""}
            </label>
          ))}
        </div>
      </fieldset>
      {inDid && !progress && (
        <p className={warn}>This agent's key is already in your DID, but access wasn't granted. Approve to finish.</p>
      )}
      {progress?.stage && !progress.error && (
        <ol className="text-sm text-[var(--boop-muted)] space-y-0.5" role="status" aria-live="polite">
          {STAGES.map(([stage, label]) => {
            const index = STAGES.findIndex(([s]) => s === progress.stage);
            const at = STAGES.findIndex(([s]) => s === stage);
            return (
              <li key={stage} className={at === index ? "text-[var(--boop-ink)] font-medium" : at < index ? "" : "opacity-60"}>
                {at < index ? "✓ " : at === index ? "… " : ""}{label}
              </li>
            );
          })}
        </ol>
      )}
      {progress?.error && (
        <div className={progress.signIn ? warn : failure} role="alert">
          <p>{progress.error}</p>
          {progress.grantFailed && <p className="mt-1">Your DID already has the key, so trying again only grants access.</p>}
          {progress.signIn && (
            <button type="button" className={`${secondary} mt-2`} onClick={onSignIn}>Sign in again</button>
          )}
        </div>
      )}
      <div className="flex gap-2">
        <button
          type="button"
          className={primary}
          disabled={busy || selected.length === 0}
          onClick={() => onApprove(selected)}
          aria-label={`${progress?.error ? "Try approving" : "Approve"} ${request.name}`}
        >
          {progress?.error ? "Try again" : busy ? "Approving…" : "Approve"}
        </button>
        <button type="button" className={secondary} disabled={busy} onClick={onDeny} aria-label={`Deny ${request.name}`}>
          Deny
        </button>
      </div>
    </li>
  );
}

export function AgentsSettings() {
  const { user, token, logout } = useAuth();
  const pending = useQuery(api.lwsAccess.pendingAccessRequests, {});
  const active = useQuery(api.lwsAccess.activeAgents, {});
  const approveAccess = useMutation(api.lwsAccess.approveAccessRequest);
  const denyAccess = useMutation(api.lwsAccess.denyAccessRequest);
  const revokeAccess = useMutation(api.lwsAccess.revokeAgent);

  const subOrgId = user?.turnkeySubOrgId;
  const [served, setServed] = useState<DidDocumentLike | null>(null);
  const [progress, setProgress] = useState<Record<string, Progress>>({});
  const [confirmRevoke, setConfirmRevoke] = useState<Id<"lwsAgents"> | null>(null);
  const [revokeBusy, setRevokeBusy] = useState<string | null>(null);
  const [revokeNote, setRevokeNote] = useState<{ error: boolean; text: string; signIn?: boolean } | null>(null);
  const [copied, setCopied] = useState(false);

  // The served DID, to tell keys whose removal failed from agents' keys.
  const refreshServed = useCallback(async () => {
    if (!subOrgId) return;
    try {
      const log = await fetchServedDidLog({ fetch: (...args) => fetch(...args), httpUrl: getConvexHttpUrl() }, subOrgId);
      setServed(servedDocument(log));
    } catch {
      setServed(null);
    }
  }, [subOrgId]);
  const activeCount = active?.length;
  const pendingCount = pending?.length;
  useEffect(() => { void refreshServed(); }, [refreshServed, activeCount, pendingCount]);

  const setFor = (key: string, next: Progress | undefined) =>
    setProgress(current => {
      const copy = { ...current };
      if (next) copy[key] = next; else delete copy[key];
      return copy;
    });

  const handleApprove = async (request: PendingRequest, actions: string[]) => {
    if (!token) return;
    const narrowed = actions.length === request.actions.length ? undefined : actions;
    let keyAdded = false;
    setFor(request.requestId, { stage: "signing" });
    try {
      await changeAuthorAgentKey(
        { add: { fragment: request.fragment, publicKeyMultibase: request.agentPublicKeyMultibase } },
        token,
        stage => setFor(request.requestId, { stage }),
      );
      keyAdded = true;
      setFor(request.requestId, { stage: "granting" });
      await approveAccess({ requestId: request.requestId, ...(narrowed ? { actions: narrowed } : {}) });
      setFor(request.requestId, undefined);
    } catch (error) {
      const signIn = error instanceof AgentKeyError && error.code === "not-ready";
      setFor(request.requestId, { stage: "signing", error: messageOf(error), signIn, grantFailed: keyAdded });
    } finally {
      void refreshServed();
    }
  };

  const handleDeny = async (request: PendingRequest) => {
    try {
      await denyAccess({ requestId: request.requestId });
      setFor(request.requestId, undefined);
    } catch (error) {
      setFor(request.requestId, { stage: "signing", error: messageOf(error) });
    }
  };

  /** Remove a key from the DID; access has already ended. */
  const removeKey = async (fragment: string, name: string) => {
    if (!token) return;
    setRevokeBusy(fragment);
    try {
      await changeAuthorAgentKey({ remove: fragment }, token);
      setRevokeNote({ error: false, text: `${name} no longer has access, and its key is gone from your DID.` });
    } catch (error) {
      const signIn = error instanceof AgentKeyError && error.code === "not-ready";
      setRevokeNote({ error: true, signIn, text: `${name} no longer has access, but its key is still in your DID: ${messageOf(error)} You can remove it below.` });
    } finally {
      setRevokeBusy(null);
      void refreshServed();
    }
  };

  const handleRevoke = async (agentId: Id<"lwsAgents">, name: string) => {
    setConfirmRevoke(null);
    setRevokeBusy(agentId);
    setRevokeNote(null);
    let fragment: string;
    // Access ends first, whatever happens to the DID update.
    try {
      ({ fragment } = await revokeAccess({ agentId }));
    } catch (error) {
      setRevokeBusy(null);
      setRevokeNote({ error: true, text: `Couldn't revoke ${name}: ${messageOf(error)}` });
      return;
    }
    await removeKey(fragment, name);
  };

  const handleCopy = async (url: string) => {
    try { await navigator.clipboard.writeText(url); } catch { return; }
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  if (!subOrgId) return null;
  const url = storageUrl(subOrgId);
  const inDid = new Set(served ? agentMethods(served).map(m => m.fragment) : []);
  const stray = active && pending ? strayAgentMethods(served, active, pending) : [];

  return (
    <section aria-labelledby="agents-title">
      <h3 id="agents-title" className="text-[13px] font-semibold text-[var(--boop-muted)] mb-2">Agents</h3>
      <div className="space-y-3">
        <p className="text-sm text-[var(--boop-muted)]">
          An agent is an app or assistant that reads and edits your lists for you. Approving one adds its key to your
          public identity (your <span className="font-mono">did:webvh</span>), so anyone can see how many agents you
          have, but not their names or what they may do. Your other devices need the latest version of boop to sign in
          once you have an agent.
        </p>

        <div className="p-4 bg-[var(--boop-panel)] rounded-xl">
          <p className="font-medium text-[var(--boop-ink)]">Your storage URL</p>
          <p className="text-sm text-[var(--boop-muted)] mb-2">Give this to an agent so it can ask for access.</p>
          <div className="flex items-center gap-2">
            <code className="flex-1 min-w-0 truncate text-xs font-mono px-2 py-1.5 bg-[var(--boop-card)] rounded-lg text-[var(--boop-ink)]" title={url}>{url}</code>
            <button type="button" className={secondary} onClick={() => handleCopy(url)} aria-label="Copy storage URL">
              <span className="flex items-center gap-1"><Icon name={copied ? "check" : "copy"} className="w-4 h-4" />{copied ? "Copied" : "Copy"}</span>
            </button>
          </div>
        </div>

        <div>
          <p className="text-sm font-medium text-[var(--boop-ink)] mb-2">Requests</p>
          {pending === undefined ? (
            <p className="text-sm text-[var(--boop-muted)]" role="status">Loading…</p>
          ) : pending.length === 0 ? (
            <p className="text-sm text-[var(--boop-muted)]">No agent is asking for access.</p>
          ) : (
            <ul className="space-y-2">
              {pending.map(request => (
                <PendingRow
                  key={request.requestId}
                  request={request}
                  inDid={inDid.has(request.fragment)}
                  progress={progress[request.requestId]}
                  onApprove={actions => handleApprove(request, actions)}
                  onDeny={() => handleDeny(request)}
                  onSignIn={() => void logout()}
                />
              ))}
            </ul>
          )}
        </div>

        <div>
          <p className="text-sm font-medium text-[var(--boop-ink)] mb-2">Approved agents</p>
          {revokeNote && (
            <div className={`${revokeNote.error ? (revokeNote.signIn ? warn : failure) : notice + " border-[var(--boop-line)] text-[var(--boop-ink)]"} mb-2`} role={revokeNote.error ? "alert" : "status"}>
              <p>{revokeNote.text}</p>
              {revokeNote.signIn && <button type="button" className={`${secondary} mt-2`} onClick={() => void logout()}>Sign in again</button>}
            </div>
          )}
          {active === undefined ? (
            <p className="text-sm text-[var(--boop-muted)]" role="status">Loading…</p>
          ) : active.length === 0 ? (
            <p className="text-sm text-[var(--boop-muted)]">No agents yet.</p>
          ) : (
            <ul className="space-y-2">
              {active.map(agent => (
                <li key={agent.agentId} className="p-4 bg-[var(--boop-panel)] rounded-xl">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-medium text-[var(--boop-ink)] break-words">{agent.name}</p>
                      <p className="text-sm text-[var(--boop-muted)]">{agent.actions.map(actionLabel).filter((a, i, all) => all.indexOf(a) === i).join(", ")}</p>
                      <p className="text-sm text-[var(--boop-muted)]">
                        Added {formatRelativeTime(agent.createdAt)} · {agent.lastUsedAt ? `last used ${formatRelativeTime(agent.lastUsedAt)}` : "not used yet"}
                      </p>
                    </div>
                    {confirmRevoke !== agent.agentId && (
                      <button
                        type="button"
                        className={secondary}
                        disabled={revokeBusy !== null}
                        onClick={() => setConfirmRevoke(agent.agentId)}
                        aria-label={`Revoke ${agent.name}`}
                      >
                        {revokeBusy === agent.agentId ? "Revoking…" : "Revoke"}
                      </button>
                    )}
                  </div>
                  {confirmRevoke === agent.agentId && (
                    <div className="mt-3 space-y-2" role="group" aria-label={`Confirm revoking ${agent.name}`}>
                      <p className="text-sm text-[var(--boop-ink)]">
                        {agent.name} loses access now. Its key is then removed from your DID, which needs your signing session.
                      </p>
                      <div className="flex gap-2">
                        <button type="button" className={danger} onClick={() => handleRevoke(agent.agentId, agent.name)}>Confirm revoke</button>
                        <button type="button" className={secondary} onClick={() => setConfirmRevoke(null)}>Cancel</button>
                      </div>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>

        {stray.length > 0 && (
          <div className={warn}>
            <p className="font-medium">Keys still in your DID</p>
            <p className="mb-2">
              {stray.length === 1 ? "A revoked agent's key is" : `${stray.length} revoked agents' keys are`} still listed in your
              public identity. They can't get access, but you can tidy them away.
            </p>
            <ul className="space-y-1">
              {stray.map(method => (
                <li key={method.fragment} className="flex items-center justify-between gap-2">
                  <span className="font-mono text-xs" title={method.publicKeyMultibase}>#{method.fragment}</span>
                  <button
                    type="button"
                    className={secondary}
                    disabled={revokeBusy !== null}
                    onClick={() => removeKey(method.fragment, "The revoked agent")}
                    aria-label={`Remove key #${method.fragment} from your DID`}
                  >
                    {revokeBusy === method.fragment ? "Removing…" : "Remove key from DID"}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </section>
  );
}
