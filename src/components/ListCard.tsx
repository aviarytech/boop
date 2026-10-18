/**
 * Card displaying a list summary — Boop design.
 *
 * Owner and age up top, the name, then progress with the done count.
 */

import { memo } from "react";
import { useQuery } from "../lib/authenticatedConvex";
import { Link } from "react-router-dom";
import type { Doc } from "../../convex/_generated/dataModel";
import { api } from "../../convex/_generated/api";
import { useSettings } from "../hooks/useSettings";
import { LegacyBadge } from "./LegacyBadge";
import { ownerTag, shortRelativeTime } from "../lib/format";

interface ListCardProps {
  list: Doc<"lists">;
  currentUserDid: string;
  showOwner?: boolean;
  /** Provenance sealed by the migration — passed in so the index queries once,
   *  not once per card. */
  isLegacy?: boolean;
}

export const ListCard = memo(function ListCard({ list, currentUserDid, showOwner, isLegacy }: ListCardProps) {
  const { haptic } = useSettings();

  // Pull item counts so the card can show progress. `skip` when we don't need it.
  const items = useQuery(api.items.getListItems, { listId: list._id });
  const total = items?.length ?? 0;
  const done = items?.filter(i => i.checked).length ?? 0;
  const pct = total ? Math.round((done / total) * 100) : 0;

  const tagParts = [ownerTag(list.ownerDid, currentUserDid, showOwner), shortRelativeTime(list.createdAt)];

  return (
    <Link
      to={`/list/${list._id}`}
      onClick={() => haptic('light')}
      className="group block relative overflow-hidden bg-[var(--boop-card)] rounded-[18px] px-5 py-[18px] shadow-[0_0_0_1px_var(--boop-line)] hover:shadow-[0_0_0_1.5px_var(--boop-accent)] transition-shadow duration-150 active:scale-[0.99]"
      aria-label={`Open list: ${list.name}`}
    >
      {/* Header: tag line + (placeholder for avatar stack) */}
      <div className="relative flex justify-between items-start mb-4">
        <div className="min-w-0">
          <div
            className="flex items-center gap-1.5 mb-1 text-[13px] text-[var(--boop-muted)]"
          >
            <span className="truncate">{tagParts.join(' · ')}</span>
            {isLegacy && <LegacyBadge className="flex-shrink-0" />}
          </div>
          <h3
            className="text-[var(--boop-ink)] truncate"
            style={{
              fontWeight: 700,
              fontSize: 21,
              letterSpacing: '-0.02em',
              lineHeight: 1.15,
            }}
          >
            {list.name}
          </h3>
        </div>
      </div>

      {/* Progress bar + done count */}
      <div className="relative flex items-center gap-2.5">
        <div className="flex-1 h-[4px] rounded-full overflow-hidden bg-[var(--boop-line)]">
          <div
            className="h-full rounded-full transition-[width] duration-300"
            style={{
              width: `${pct}%`,
              background: 'var(--boop-accent)',
            }}
          />
        </div>
        <span
          className="text-[13px] text-[var(--boop-muted)] tabular-nums"
        >
          {items === undefined ? '…' : total ? `${done} of ${total}` : 'Empty'}
        </span>
      </div>
    </Link>
  );
});
