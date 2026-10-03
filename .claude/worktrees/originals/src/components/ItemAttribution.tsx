/**
 * Component showing who added/checked an item and when.
 */

import { useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import type { Doc } from "../../convex/_generated/dataModel";
import { formatRelativeTime } from "../lib/time";

interface ItemAttributionProps {
  item: Doc<"items">;
}

export function ItemAttribution({ item }: ItemAttributionProps) {
  // Collect DIDs we need to look up
  const dids = [item.createdByDid];
  if (item.checkedByDid) {
    dids.push(item.checkedByDid);
  }

  const users = useQuery(api.users.getUsersByDids, { dids });

  if (users === undefined) {
    return <span className="text-xs text-gray-400">Loading...</span>;
  }

  if (item.checked && item.checkedByDid && item.checkedAt) {
    const checkerName = users[item.checkedByDid]?.displayName || "Unknown";
    const timeAgo = formatRelativeTime(item.checkedAt);
    return (
      <span className="text-xs text-gray-400">
        Checked by {checkerName}, {timeAgo}
      </span>
    );
  }

  const creatorName = users[item.createdByDid]?.displayName || "Unknown";
  const timeAgo = formatRelativeTime(item.createdAt);
  return (
    <span className="text-xs text-gray-400">
      Added by {creatorName}, {timeAgo}
    </span>
  );
}
