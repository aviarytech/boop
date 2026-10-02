/** Compact formatters for the index cards' mono tag lines. */

export function truncateDid(did: string): string {
  if (did.length <= 24) return did;
  return `${did.slice(0, 12)}…${did.slice(-6)}`;
}

/** "just now", "5m ago", "3h ago", "2d ago", then a date. */
export function shortRelativeTime(timestamp: number): string {
  const seconds = Math.floor((Date.now() - timestamp) / 1000);
  if (seconds < 60) return 'just now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  if (seconds < 604800) return `${Math.floor(seconds / 86400)}d ago`;
  return new Date(timestamp).toLocaleDateString();
}

/** Owner tag for an index card: the owner's DID, "shared", or "personal". */
export function ownerTag(ownerDid: string, currentUserDid: string, showOwner?: boolean): string {
  if (ownerDid === currentUserDid) return 'personal';
  return showOwner ? truncateDid(ownerDid) : 'shared';
}
