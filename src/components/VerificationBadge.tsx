/**
 * VerificationBadge - Shows identifier presence and separate anchor status
 * 
 * Displays visual indicators for:
 * - DID present (unverified identifier, not ownership/authorship proof)
 * - ⚓ Anchored to Bitcoin (if anchor proof exists)
 * 
 * Used on both list headers and individual items.
 */

import { useState } from "react";

export type VerificationState = "verified" | "pending" | "none";

export interface VerificationStatus {
  /** Anchor status: verified (confirmed on chain), pending (submitted), or none */
  anchorStatus: VerificationState;
  /** Optional: An identifier associated with this data; presence is not verification */
  did?: string;
  /** Optional: Block height where anchor was confirmed */
  anchorBlockHeight?: number;
  /** Optional: Transaction ID for the anchor */
  anchorTxId?: string;
}

interface VerificationBadgeProps {
  status: VerificationStatus;
  /** Compact mode shows just icons, full mode shows labels */
  compact?: boolean;
  /** Size variant */
  size?: "sm" | "md";
}

/**
 * Neutral information icon for identifier metadata
 */
function IdentifierIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M12 16v-4m0-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0"
      />
    </svg>
  );
}

/**
 * Icon component for the anchor symbol
 */
function AnchorIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M12 8V4m0 4a4 4 0 110 8 4 4 0 010-8zm0 8v4m-6-4h1m10 0h1M7 12a5 5 0 0110 0"
      />
    </svg>
  );
}

/**
 * Tooltip wrapper with explanation
 */
function BadgeTooltip({
  children,
  content,
}: {
  children: React.ReactNode;
  content: React.ReactNode;
}) {
  const [isVisible, setIsVisible] = useState(false);

  return (
    <div
      className="relative inline-flex"
      onMouseEnter={() => setIsVisible(true)}
      onMouseLeave={() => setIsVisible(false)}
      onTouchStart={() => setIsVisible(true)}
      onTouchEnd={() => setTimeout(() => setIsVisible(false), 2000)}
    >
      {children}
      {isVisible && (
        <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 z-50 animate-fade-in">
          <div className="bg-gray-900 dark:bg-gray-700 text-white text-xs rounded-lg px-3 py-2 shadow-lg whitespace-nowrap max-w-xs">
            {content}
            <div className="absolute top-full left-1/2 -translate-x-1/2 border-4 border-transparent border-t-gray-900 dark:border-t-gray-700" />
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Individual badge indicator
 */
function BadgeIndicator({
  icon,
  label,
  state,
  compact,
  size,
  tooltip,
}: {
  icon: React.ReactNode;
  label: string;
  state: VerificationState | "unverified";
  compact?: boolean;
  size?: "sm" | "md";
  tooltip: React.ReactNode;
}) {
  const sizeClasses = size === "sm" 
    ? "text-[10px] px-1.5 py-0.5" 
    : "text-xs px-2 py-1";
  
  const iconSize = size === "sm" ? "w-3 h-3" : "w-3.5 h-3.5";

  const stateStyles = {
    verified: "bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400 border-gray-200 dark:border-gray-700",
    unverified: "bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400 border-gray-200 dark:border-gray-700",
    pending: "bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400 border-amber-200 dark:border-amber-800",
    none: "bg-gray-100 dark:bg-gray-800 text-gray-400 dark:text-gray-500 border-gray-200 dark:border-gray-700",
  };

  if (state === "none" && compact) {
    return null; // Hide "none" badges in compact mode
  }

  return (
    <BadgeTooltip content={tooltip}>
      <span
        aria-label={label}
        className={`inline-flex items-center gap-1 rounded-full border font-medium ${sizeClasses} ${stateStyles[state]}`}
      >
        <span className={iconSize}>{icon}</span>
        {!compact && <span>{label}</span>}
      </span>
    </BadgeTooltip>
  );
}

/**
 * Main VerificationBadge component
 */
export function VerificationBadge({
  status,
  compact = false,
  size = "sm",
}: VerificationBadgeProps) {
  const hasDid = Boolean(status.did);
  
  const identifierTooltip = hasDid ? (
    <div>
      <div className="font-semibold mb-1">DID (unverified)</div>
      <div className="text-gray-300">
        An identifier is recorded for this data. Its presence does not verify authenticity, ownership, or authorship.
      </div>
      {status.did && (
        <div className="mt-1 text-gray-400 text-[10px] font-mono truncate max-w-[200px]">
          {status.did}
        </div>
      )}
    </div>
  ) : (
    <div>
      <div className="font-semibold mb-1">No DID</div>
      <div className="text-gray-300">
        No decentralized identifier is recorded for this data.
      </div>
    </div>
  );

  const anchorTooltip = {
    verified: (
      <div>
        <div className="font-semibold mb-1">⚓ Anchored to Bitcoin</div>
        <div className="text-gray-300">
          This data is timestamped and anchored to the Bitcoin blockchain, providing immutable proof of existence.
        </div>
        {status.anchorBlockHeight && (
          <div className="mt-1 text-gray-400 text-[10px]">
            Block: {status.anchorBlockHeight.toLocaleString()}
          </div>
        )}
        {status.anchorTxId && (
          <div className="text-gray-400 text-[10px] font-mono truncate max-w-[200px]">
            Tx: {status.anchorTxId}
          </div>
        )}
      </div>
    ),
    pending: (
      <div>
        <div className="font-semibold mb-1">⏳ Anchor Pending</div>
        <div className="text-gray-300">
          This data has been submitted for anchoring to Bitcoin and is awaiting confirmation.
        </div>
      </div>
    ),
    none: (
      <div>
        <div className="font-semibold mb-1">Not Anchored</div>
        <div className="text-gray-300">
          This data has not been anchored to Bitcoin.
        </div>
      </div>
    ),
  };

  // In compact mode with nothing to show, return null
  if (compact && !hasDid && status.anchorStatus === "none") {
    return null;
  }

  return (
    <div className="inline-flex items-center gap-1">
      <BadgeIndicator
        icon={<IdentifierIcon className="w-full h-full" />}
        label={hasDid ? "DID (unverified)" : "No DID"}
        state={hasDid ? "unverified" : "none"}
        compact={compact}
        size={size}
        tooltip={identifierTooltip}
      />
      <BadgeIndicator
        icon={<AnchorIcon className="w-full h-full" />}
        label={status.anchorStatus === "verified" ? "Anchored" : status.anchorStatus === "pending" ? "Pending" : "Not anchored"}
        state={status.anchorStatus}
        compact={compact}
        size={size}
        tooltip={anchorTooltip[status.anchorStatus]}
      />
    </div>
  );
}

/**
 * Compact inline badge for items - shows identifier metadata or anchor status
 */
export function ItemVerificationBadge({
  anchorStatus = "none",
  did,
}: {
  anchorStatus?: VerificationState;
  did?: string;
}) {
  // Only show if identifier metadata or anchor status is available
  if (!did && anchorStatus === "none") {
    return null;
  }

  return (
    <VerificationBadge
      status={{ anchorStatus, did }}
      compact
      size="sm"
    />
  );
}

/**
 * Full badge for list headers - always shows status
 */
export function ListVerificationBadge({
  anchorStatus = "none",
  did,
  anchorBlockHeight,
  anchorTxId,
}: {
  anchorStatus?: VerificationState;
  did?: string;
  anchorBlockHeight?: number;
  anchorTxId?: string;
}) {
  return (
    <VerificationBadge
      status={{ anchorStatus, did, anchorBlockHeight, anchorTxId }}
      compact={false}
      size="md"
    />
  );
}
