/**
 * ProvenanceInfo - Shows Originals DID/provenance chain information
 * 
 * Displays the backing Originals identity for lists and items:
 * - List DID (assetDid), owner DID, creation timestamp
 * - Item creator, creation/modification timestamps
 * - VC proofs for ownership and actions
 * - Bitcoin anchor status and timeline
 * 
 * Makes the decentralized identity and provenance chain visible to users.
 */

import { useEffect, useState } from "react";
import { useQuery, useMutation } from "convex/react";
import { api } from "../../convex/_generated/api";
import type { Doc } from "../../convex/_generated/dataModel";
import { useNavigate } from "react-router-dom";
import { useSettings } from "../hooks/useSettings";
import { useCurrentUser } from "../hooks/useCurrentUser";
import { verifyListEnvelope, isRetroactiveGenesis, createListAsset } from "../lib/originals";

interface ListProvenanceProps {
  list: Doc<"lists">;
}

interface ItemProvenanceProps {
  item: Doc<"items">;
}

/**
 * Truncate a DID for display, keeping prefix and tail
 */
function truncateDid(did: string, prefixLen = 16, tailLen = 6): string {
  if (did.length <= prefixLen + tailLen + 3) return did;
  return `${did.slice(0, prefixLen)}...${did.slice(-tailLen)}`;
}

/**
 * Format timestamp for display
 */
function formatDate(timestamp: number): string {
  return new Date(timestamp).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/**
 * Format relative time for timeline
 */
function formatRelativeTime(timestamp: number): string {
  const now = Date.now();
  const diff = now - timestamp;
  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);

  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  if (hours < 24) return `${hours}h ago`;
  if (days < 7) return `${days}d ago`;
  return formatDate(timestamp);
}

type HapticPattern = 'light' | 'medium' | 'heavy' | 'success' | 'error' | 'warning';
type HapticFn = (pattern?: HapticPattern) => void;

/**
 * Copy text to clipboard with haptic feedback
 */
async function copyToClipboard(text: string, haptic: HapticFn): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    haptic("success");
    return true;
  } catch {
    haptic("error");
    return false;
  }
}

/**
 * Individual DID row with copy functionality
 */
function DidRow({ 
  label, 
  did, 
  displayName,
  haptic 
}: { 
  label: string; 
  did: string;
  displayName?: string | null;
  haptic: HapticFn;
}) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    const success = await copyToClipboard(did, haptic);
    if (success) {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  return (
    <div className="flex items-start justify-between gap-2 py-2">
      <div className="flex-1 min-w-0">
        <div className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-0.5">
          {label}
        </div>
        <div className="flex items-center gap-2">
          {displayName && (
            <span className="text-sm text-gray-700 dark:text-gray-200 font-medium">
              {displayName}
            </span>
          )}
          <code className="text-xs text-gray-600 dark:text-gray-300 bg-gray-100 dark:bg-gray-800 px-1.5 py-0.5 rounded font-mono break-all">
            {truncateDid(did)}
          </code>
        </div>
      </div>
      <button
        onClick={handleCopy}
        className={`flex-shrink-0 p-1.5 rounded transition-colors ${
          copied
            ? "bg-green-100 dark:bg-green-900/30 text-green-600 dark:text-green-400"
            : "hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
        }`}
        title={copied ? "Copied!" : "Copy full DID"}
        aria-label={copied ? "Copied!" : `Copy ${label}`}
      >
        {copied ? (
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
          </svg>
        ) : (
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
          </svg>
        )}
      </button>
    </div>
  );
}

/**
 * Timestamp row
 */
function TimestampRow({ label, timestamp }: { label: string; timestamp: number }) {
  return (
    <div className="py-2">
      <div className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-0.5">
        {label}
      </div>
      <div className="text-sm text-gray-700 dark:text-gray-200">
        {formatDate(timestamp)}
      </div>
    </div>
  );
}

/**
 * Collapsible wrapper for provenance info
 */
type EnvelopeState =
  | { status: "absent" }
  | { status: "checking" }
  | { status: "verified"; retroactive: boolean }
  | { status: "failed"; detail: string };

/**
 * Replays the list's signed CEL log client-side. Verification is real work
 * (signature checks + hashing), so it runs in an effect rather than on render.
 */
function useEnvelopeVerification(
  listId: Doc<"lists">["_id"],
  listCreatedAt: number
): EnvelopeState {
  const stored = useQuery(api.lists.getListEnvelope, { listId });
  const envelope = stored?.envelope ?? null;
  // Keyed by the envelope it describes, so a stale result is never shown for a
  // newer one — that also keeps loading/absent derivable during render.
  const [result, setResult] = useState<{ envelope: string; state: EnvelopeState } | null>(null);

  useEffect(() => {
    if (!envelope) return;
    let cancelled = false;
    void verifyListEnvelope(envelope).then((verification) => {
      if (cancelled) return;
      setResult({
        envelope,
        state: verification.verified
          ? { status: "verified", retroactive: isRetroactiveGenesis(envelope, listCreatedAt) }
          : {
              status: "failed",
              detail: verification.error ?? verification.warnings.join("; "),
            },
      });
    });
    return () => {
      cancelled = true;
    };
  }, [envelope, listCreatedAt]);

  if (stored === undefined) return { status: "checking" };
  if (stored === null) return { status: "absent" };
  return result?.envelope === envelope ? result.state : { status: "checking" };
}

function EnvelopeVerificationRow({ state }: { state: EnvelopeState }) {
  // Every state says something. Rendering nothing for "absent" made a list with
  // no log indistinguishable from one whose log simply wasn't shown.
  const [icon, text, tone] =
    state.status === "absent"
      ? ["—", "No event log recorded for this list", "text-gray-500 dark:text-gray-400"]
      : state.status === "checking"
        ? ["⏳", "Verifying event log…", "text-gray-500 dark:text-gray-400"]
        : state.status === "verified"
          ? [
              "✅",
              state.retroactive
                ? "Event log verified — sealed when this list was migrated, not when it was created"
                : "Event log verified",
              "text-green-600 dark:text-green-400",
            ]
          : ["⚠️", `Event log failed verification: ${state.detail}`, "text-red-600 dark:text-red-400"];

  return (
    <div className="py-2">
      <div className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">
        🔗 Chained Event Log
      </div>
      <div className={`text-sm ${tone}`}>
        {icon} {text}
      </div>
    </div>
  );
}

/**
 * Offers an authorable copy of a list whose log was sealed by the migration.
 *
 * Those lists were given genesis server-side with an ephemeral controller, so
 * nobody holds their key and they can never record another event. A copy is
 * minted here in the browser, so its key lands in this device's keyStore.
 *
 * Owner-only: copying mints an identity naming the owner, so someone who can
 * merely view a shared list must not be able to do it. The server enforces this
 * too — this only decides whether to show the button.
 */
function CopyForProvenance({ list }: { list: Doc<"lists"> }) {
  const { did } = useCurrentUser();
  const copyList = useMutation(api.lists.copyList);
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!did || did !== list.ownerDid) return null;

  const handleCopy = async () => {
    setBusy(true);
    setError(null);
    try {
      const name = `${list.name} (copy)`;
      const asset = await createListAsset(name, did);
      const { listId } = await copyList({
        sourceListId: list._id,
        assetDid: asset.assetDid,
        celEnvelope: asset.envelope,
        name,
        ownerDid: did,
        createdAt: Date.now(),
      });
      navigate(`/list/${listId}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not copy this list");
      setBusy(false);
    }
  };

  return (
    <div className="pb-2">
      <button
        onClick={() => void handleCopy()}
        disabled={busy}
        className="text-sm px-3 py-1.5 rounded bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-200 hover:bg-gray-200 dark:hover:bg-gray-700 disabled:opacity-50"
      >
        {busy ? "Copying…" : "Make an authorable copy"}
      </button>
      <div className="text-xs text-gray-500 dark:text-gray-400 mt-1">
        Copies the items into a new list that can record its own history. This
        list is left as it is.
      </div>
      {error && (
        <div className="text-xs text-red-600 dark:text-red-400 mt-1">{error}</div>
      )}
    </div>
  );
}

function ProvenanceSection({
  title,
  children,
  defaultOpen = false
}: { 
  title: string; 
  children: React.ReactNode;
  defaultOpen?: boolean;
}) {
  const [isOpen, setIsOpen] = useState(defaultOpen);

  return (
    <div className="border border-gray-200 dark:border-gray-700 rounded-xl overflow-hidden">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="w-full flex items-center justify-between px-4 py-3 bg-gray-50 dark:bg-gray-800/50 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
        aria-expanded={isOpen}
      >
        <div className="flex items-center gap-2">
          <svg 
            className="w-5 h-5 text-amber-500" 
            fill="none" 
            stroke="currentColor" 
            viewBox="0 0 24 24"
          >
            <path 
              strokeLinecap="round" 
              strokeLinejoin="round" 
              strokeWidth={2} 
              d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" 
            />
          </svg>
          <span className="text-sm font-medium text-gray-700 dark:text-gray-200">
            {title}
          </span>
        </div>
        <svg
          className={`w-5 h-5 text-gray-400 transition-transform ${isOpen ? "rotate-180" : ""}`}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      {isOpen && (
        <div className="px-4 py-2 divide-y divide-gray-100 dark:divide-gray-700/50">
          {children}
        </div>
      )}
    </div>
  );
}

/**
 * Bitcoin anchor status badge
 */
function AnchorStatusBadge({ status }: { status: "pending" | "inscribed" | "confirmed" | "failed" }) {
  const statusConfig = {
    pending: {
      bg: "bg-yellow-100 dark:bg-yellow-900/30",
      text: "text-yellow-700 dark:text-yellow-400",
      icon: "⏳",
      label: "Pending",
    },
    inscribed: {
      bg: "bg-amber-100 dark:bg-amber-900/30",
      text: "text-amber-800 dark:text-amber-400",
      icon: "📝",
      label: "Inscribed",
    },
    failed: {
      bg: "bg-red-100 dark:bg-red-900/30",
      text: "text-red-700 dark:text-red-400",
      icon: "❌",
      label: "Failed",
    },
    confirmed: {
      bg: "bg-green-100 dark:bg-green-900/30",
      text: "text-green-700 dark:text-green-400",
      icon: "✅",
      label: "Confirmed",
    },
  };

  const config = statusConfig[status];

  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${config.bg} ${config.text}`}>
      <span>{config.icon}</span>
      <span>{config.label}</span>
    </span>
  );
}

/**
 * Bitcoin anchor row with link to block explorer
 */
function BitcoinAnchorRow({ anchor }: { anchor: Doc<"bitcoinAnchors"> }) {
  const explorerUrl = anchor.txid 
    ? `https://mempool.space/tx/${anchor.txid}`
    : null;

  return (
    <div className="py-3">
      <div className="flex items-center justify-between mb-2">
        <div className="text-xs font-medium text-gray-500 dark:text-gray-400">
          ₿ Bitcoin Anchor
        </div>
        <AnchorStatusBadge status={anchor.status} />
      </div>
      
      {anchor.txid && (
        <div className="mb-2">
          <div className="text-xs text-gray-500 dark:text-gray-400 mb-0.5">
            Transaction ID
          </div>
          <div className="flex items-center gap-2">
            <code className="text-xs text-gray-600 dark:text-gray-300 bg-gray-100 dark:bg-gray-800 px-1.5 py-0.5 rounded font-mono">
              {truncateDid(anchor.txid, 12, 8)}
            </code>
            {explorerUrl && (
              <a
                href={explorerUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs text-amber-600 dark:text-amber-400 hover:underline flex items-center gap-1"
              >
                View on Mempool
                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                </svg>
              </a>
            )}
          </div>
        </div>
      )}

      {anchor.blockHeight && (
        <div className="mb-2">
          <div className="text-xs text-gray-500 dark:text-gray-400 mb-0.5">
            Block Height
          </div>
          <div className="text-sm text-gray-700 dark:text-gray-200">
            #{anchor.blockHeight.toLocaleString()}
            {anchor.confirmations !== undefined && (
              <span className="text-xs text-gray-500 dark:text-gray-400 ml-2">
                ({anchor.confirmations} confirmations)
              </span>
            )}
          </div>
        </div>
      )}

      <div className="text-xs text-gray-500 dark:text-gray-400">
        Requested {formatRelativeTime(anchor.createdAt)}
        {anchor.confirmedAt && (
          <span> • Confirmed {formatRelativeTime(anchor.confirmedAt)}</span>
        )}
      </div>
    </div>
  );
}

/**
 * VC Proof display
 */
function VcProofRow({ 
  label, 
  issuer, 
  issuanceDate,
  displayName,
  haptic 
}: { 
  label: string; 
  issuer: string;
  issuanceDate: number;
  displayName?: string | null;
  haptic: HapticFn;
}) {
  return (
    <div className="py-3">
      <div className="flex items-center gap-2 mb-2">
        <svg className="w-4 h-4 text-purple-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
        <span className="text-xs font-medium text-gray-700 dark:text-gray-200">
          {label}
        </span>
      </div>
      <DidRow 
        label="Issued by" 
        did={issuer} 
        displayName={displayName}
        haptic={haptic} 
      />
      <div className="text-xs text-gray-500 dark:text-gray-400 mt-1">
        Issued {formatDate(issuanceDate)}
      </div>
    </div>
  );
}

/**
 * Provenance Timeline - shows the chain of events
 */
function ProvenanceTimeline({ 
  events 
}: { 
  events: Array<{
    type: "created" | "vc_issued" | "anchored" | "confirmed" | "completed";
    label: string;
    timestamp: number;
    actor?: string;
    actorName?: string | null;
  }>;
}) {
  // Sort events by timestamp
  const sortedEvents = [...events].sort((a, b) => a.timestamp - b.timestamp);

  const typeIcons = {
    created: "🆕",
    vc_issued: "📜",
    anchored: "⚓",
    confirmed: "✅",
    completed: "☑️",
  };

  return (
    <div className="py-3">
      <div className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-3">
        📅 Provenance Timeline
      </div>
      <div className="space-y-3">
        {sortedEvents.map((event, idx) => (
          <div key={idx} className="flex items-start gap-3">
            <div className="flex-shrink-0 w-6 h-6 flex items-center justify-center bg-gray-100 dark:bg-gray-800 rounded-full text-sm">
              {typeIcons[event.type]}
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-sm text-gray-700 dark:text-gray-200">
                {event.label}
                {event.actor && (
                  <span className="text-gray-500 dark:text-gray-400">
                    {" by "}
                    <span className="font-medium text-gray-600 dark:text-gray-300">
                      {event.actorName || truncateDid(event.actor)}
                    </span>
                  </span>
                )}
              </div>
              <div className="text-xs text-gray-500 dark:text-gray-400">
                {formatDate(event.timestamp)}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * Provenance info for a list - shows asset DID, owner, creation time, VCs, and Bitcoin anchors
 */
export function ListProvenanceInfo({ list }: ListProvenanceProps) {
  const { haptic } = useSettings();
  
  // Look up the owner's display name
  const userInfo = useQuery(api.users.getUsersByDids, { 
    dids: [list.ownerDid] 
  });
  
  // Fetch Bitcoin anchors for this list
  const anchors = useQuery(api.bitcoinAnchors.getListAnchors, { 
    listId: list._id 
  });
  
  const ownerName = userInfo?.[list.ownerDid]?.displayName ?? null;

  const envelopeState = useEnvelopeVerification(list._id, list.createdAt);

  // Build timeline events
  const timelineEvents: Array<{
    type: "created" | "vc_issued" | "anchored" | "confirmed" | "completed";
    label: string;
    timestamp: number;
    actor?: string;
    actorName?: string | null;
  }> = [
    {
      type: "created",
      label: "List created",
      timestamp: list.createdAt,
      actor: list.ownerDid,
      actorName: ownerName,
    },
  ];

  // Add VC issuance event if present
  if (list.vcProof) {
    timelineEvents.push({
      type: "vc_issued",
      label: "Ownership VC issued",
      timestamp: list.vcProof.issuanceDate,
      actor: list.vcProof.issuer,
    });
  }

  // Add anchor events
  anchors?.forEach((anchor) => {
    if (anchor.inscribedAt) {
      timelineEvents.push({
        type: "anchored",
        label: "Anchored to Bitcoin",
        timestamp: anchor.inscribedAt,
        actor: anchor.requestedByDid,
      });
    }
    if (anchor.confirmedAt && anchor.status === "confirmed") {
      timelineEvents.push({
        type: "confirmed",
        label: "Bitcoin anchor confirmed",
        timestamp: anchor.confirmedAt,
      });
    }
  });

  return (
    <ProvenanceSection title="Originals Provenance">
      <DidRow 
        label="📋 List DID (Asset)" 
        did={list.assetDid} 
        haptic={haptic} 
      />
      <DidRow 
        label="👤 Created By" 
        did={list.ownerDid} 
        displayName={ownerName}
        haptic={haptic} 
      />
      <TimestampRow
        label="📅 Created"
        timestamp={list.createdAt}
      />

      <EnvelopeVerificationRow state={envelopeState} />
      {envelopeState.status === "verified" && envelopeState.retroactive && (
        <CopyForProvenance list={list} />
      )}

      {/* Ownership VC */}
      {list.vcProof && (
        <VcProofRow
          label="Ownership Verifiable Credential"
          issuer={list.vcProof.issuer}
          issuanceDate={list.vcProof.issuanceDate}
          haptic={haptic}
        />
      )}

      {/* Bitcoin Anchors */}
      {anchors && anchors.length > 0 && (
        <div className="py-2">
          <div className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-2">
            ₿ Bitcoin Anchors ({anchors.length})
          </div>
          <div className="space-y-2">
            {anchors.map((anchor) => (
              <BitcoinAnchorRow key={anchor._id} anchor={anchor} />
            ))}
          </div>
        </div>
      )}

      {/* Provenance Timeline */}
      {timelineEvents.length > 1 && (
        <ProvenanceTimeline events={timelineEvents} />
      )}
      
      {/* Info footer */}
      <div className="py-3">
        <p className="text-xs text-gray-500 dark:text-gray-400 leading-relaxed">
          This list is backed by a decentralized identifier (DID) through{" "}
          <a 
            href="https://originalsprotocol.com" 
            target="_blank" 
            rel="noopener noreferrer"
            className="text-amber-600 dark:text-amber-400 hover:underline"
          >
            Originals Protocol
          </a>
          , providing cryptographic proof of ownership and authenticity.
          {anchors && anchors.length > 0 && (
            <span>
              {" "}This list has been anchored to Bitcoin for immutable timestamping.
            </span>
          )}
        </p>
      </div>
    </ProvenanceSection>
  );
}

/**
 * Provenance info for an item - shows creator, timestamps, VCs, and Bitcoin anchors
 */
export function ItemProvenanceInfo({ item }: ItemProvenanceProps) {
  const { haptic } = useSettings();
  
  // Collect all DIDs we need to look up
  const didsToLookup = [item.createdByDid];
  if (item.checkedByDid && item.checkedByDid !== item.createdByDid) {
    didsToLookup.push(item.checkedByDid);
  }
  
  // Add VC issuers to lookup
  item.vcProofs?.forEach((vc) => {
    if (!didsToLookup.includes(vc.issuer)) {
      didsToLookup.push(vc.issuer);
    }
    if (!didsToLookup.includes(vc.actorDid)) {
      didsToLookup.push(vc.actorDid);
    }
  });
  
  const userInfo = useQuery(api.users.getUsersByDids, { 
    dids: didsToLookup 
  });

  // Fetch Bitcoin anchors for this item
  const anchors = useQuery(api.bitcoinAnchors.getItemAnchors, { 
    itemId: item._id 
  });
  
  const creatorName = userInfo?.[item.createdByDid]?.displayName ?? null;
  const checkerName = item.checkedByDid 
    ? userInfo?.[item.checkedByDid]?.displayName ?? null 
    : null;

  // Build timeline events
  const timelineEvents: Array<{
    type: "created" | "vc_issued" | "anchored" | "confirmed" | "completed";
    label: string;
    timestamp: number;
    actor?: string;
    actorName?: string | null;
  }> = [
    {
      type: "created",
      label: "Item created",
      timestamp: item.createdAt,
      actor: item.createdByDid,
      actorName: creatorName,
    },
  ];

  // Add VC events
  item.vcProofs?.forEach((vc) => {
    const actorName = userInfo?.[vc.actorDid]?.displayName ?? null;
    let label = "VC issued";
    if (vc.action === "created") label = "Creation VC issued";
    else if (vc.action === "completed") label = "Completion VC issued";
    else if (vc.action === "modified") label = "Modification VC issued";
    
    timelineEvents.push({
      type: "vc_issued",
      label,
      timestamp: vc.issuanceDate,
      actor: vc.actorDid,
      actorName,
    });
  });

  // Add completion event
  if (item.checked && item.checkedAt && item.checkedByDid) {
    timelineEvents.push({
      type: "completed",
      label: "Item completed",
      timestamp: item.checkedAt,
      actor: item.checkedByDid,
      actorName: checkerName,
    });
  }

  // Add anchor events
  anchors?.forEach((anchor) => {
    if (anchor.inscribedAt) {
      timelineEvents.push({
        type: "anchored",
        label: "Anchored to Bitcoin",
        timestamp: anchor.inscribedAt,
        actor: anchor.requestedByDid,
      });
    }
    if (anchor.confirmedAt && anchor.status === "confirmed") {
      timelineEvents.push({
        type: "confirmed",
        label: "Bitcoin anchor confirmed",
        timestamp: anchor.confirmedAt,
      });
    }
  });

  return (
    <ProvenanceSection title="Originals Provenance">
      <DidRow 
        label="👤 Created By" 
        did={item.createdByDid}
        displayName={creatorName}
        haptic={haptic} 
      />
      <TimestampRow 
        label="📅 Created" 
        timestamp={item.createdAt} 
      />
      
      {item.updatedAt && item.updatedAt !== item.createdAt && (
        <TimestampRow 
          label="✏️ Last Modified" 
          timestamp={item.updatedAt} 
        />
      )}
      
      {item.checked && item.checkedByDid && item.checkedAt && (
        <>
          <DidRow 
            label="✅ Completed By" 
            did={item.checkedByDid}
            displayName={checkerName}
            haptic={haptic} 
          />
          <TimestampRow 
            label="✅ Completed" 
            timestamp={item.checkedAt} 
          />
        </>
      )}

      {/* Item VCs */}
      {item.vcProofs && item.vcProofs.length > 0 && (
        <div className="py-2">
          <div className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-2">
            📜 Verifiable Credentials ({item.vcProofs.length})
          </div>
          <div className="space-y-2">
            {item.vcProofs.map((vc, idx) => {
              const issuerName = userInfo?.[vc.issuer]?.displayName ?? null;
              let actionLabel = "Action VC";
              if (vc.action === "created") actionLabel = "Creation VC";
              else if (vc.action === "completed") actionLabel = "Completion VC";
              else if (vc.action === "modified") actionLabel = "Modification VC";
              
              return (
                <VcProofRow
                  key={idx}
                  label={actionLabel}
                  issuer={vc.issuer}
                  issuanceDate={vc.issuanceDate}
                  displayName={issuerName}
                  haptic={haptic}
                />
              );
            })}
          </div>
        </div>
      )}

      {/* Bitcoin Anchors */}
      {anchors && anchors.length > 0 && (
        <div className="py-2">
          <div className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-2">
            ₿ Bitcoin Anchors ({anchors.length})
          </div>
          <div className="space-y-2">
            {anchors.map((anchor) => (
              <BitcoinAnchorRow key={anchor._id} anchor={anchor} />
            ))}
          </div>
        </div>
      )}

      {/* Provenance Timeline */}
      {timelineEvents.length > 1 && (
        <ProvenanceTimeline events={timelineEvents} />
      )}
      
      {/* Info footer */}
      <div className="py-3">
        <p className="text-xs text-gray-500 dark:text-gray-400 leading-relaxed">
          Item actions are attributed to decentralized identifiers (DIDs) for transparency and accountability.
          {item.vcProofs && item.vcProofs.length > 0 && (
            <span>
              {" "}Each action is backed by a Verifiable Credential for cryptographic proof.
            </span>
          )}
          {anchors && anchors.length > 0 && (
            <span>
              {" "}This item has been anchored to Bitcoin for immutable timestamping.
            </span>
          )}
        </p>
      </div>
    </ProvenanceSection>
  );
}
