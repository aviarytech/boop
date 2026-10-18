/**
 * Component showing who added/checked an item and when.
 */

import { useState } from "react";
import { useQuery } from "../lib/authenticatedConvex";
import { api } from "../../convex/_generated/api";
import type { Doc } from "../../convex/_generated/dataModel";
import { formatRelativeTime } from "../lib/time";
import { Stamp } from "./Stamp";

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
    return <span className="text-[13px] text-[var(--boop-dim)]">Loading…</span>;
  }

  if (item.checked && item.checkedByDid && item.checkedAt) {
    const checkerName = users[item.checkedByDid]?.displayName || "Unknown";
    const timeAgo = formatRelativeTime(item.checkedAt);
    return (
      <span className="text-[13px] text-[var(--boop-muted)] truncate">
        Checked by {checkerName}, {timeAgo}
      </span>
    );
  }

  const creatorName = users[item.createdByDid]?.displayName || "Unknown";
  const timeAgo = formatRelativeTime(item.createdAt);
  return (
    <span className="text-[13px] text-[var(--boop-muted)] truncate">
      Added by {creatorName}, {timeAgo}
    </span>
  );
}

/** The checker's stamp for a checked item: who made the tick, and when. */
export function ItemStamp({ item }: ItemAttributionProps) {
  const users = useQuery(api.users.getUsersByDids, item.checkedByDid ? { dids: [item.checkedByDid] } : "skip");
  // Animate only a tick made moments ago (checked while this row was on screen).
  const [mountedAt] = useState(() => Date.now());
  // Ring text needs 56px; phones keep the compact 40px stamp.
  const [size] = useState(() => (window.matchMedia('(min-width: 640px)').matches ? 56 : 40));
  if (!item.checked) return null;
  if (!item.checkedByDid || !item.checkedAt) {
    // Ticked before checkers were recorded: an empty outline, not a blank.
    return (
      <span role="img" aria-label="No stamp recorded" title="Checked before stamps were recorded"
        className="mr-1 inline-block w-10 h-10 flex-none rounded-full border-2 border-dashed border-[var(--boop-line)]" />
    );
  }
  if (users === undefined) return null;
  const name = users[item.checkedByDid]?.displayName || "Unknown";
  const time = new Date(item.checkedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false });
  const fresh = item.checkedAt > mountedAt - 1000;
  return <Stamp name={name} time={time} size={size} fresh={fresh} className="mr-1" />;
}
