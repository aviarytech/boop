/**
 * Card displaying a list summary — Boop design.
 *
 * Mono category line up top, big Nunito name, progress bar with
 * done count at the bottom. Matches the Boop prototype BoopListCard.
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
      className="group block relative overflow-hidden bg-white dark:bg-stone-800/70 rounded-[18px] p-[18px] border border-stone-200/70 dark:border-stone-700/50 hover:border-amber-300/60 dark:hover:border-amber-700/50 hover:-translate-y-[1px] transition-all duration-150 active:scale-[0.99]"
      aria-label={`Open list: ${list.name}`}
    >
      {/* Header: tag line + (placeholder for avatar stack) */}
      <div className="relative flex justify-between items-start mb-4">
        <div className="min-w-0">
          <div
            className="flex items-center gap-1.5 mb-1 text-[11px] text-stone-500 dark:text-stone-400 lowercase"
            style={{ fontFamily: 'Geist Mono, ui-monospace, monospace' }}
          >
            <span className="truncate">{tagParts.join(' · ')}</span>
            {isLegacy && <LegacyBadge className="flex-shrink-0" />}
          </div>
          <h3
            className="text-stone-900 dark:text-stone-50 truncate"
            style={{
              fontFamily: 'Nunito, system-ui, sans-serif',
              fontWeight: 700,
              fontSize: 20,
              letterSpacing: -0.4,
              lineHeight: 1.15,
            }}
          >
            {list.name}
          </h3>
        </div>
      </div>

      {/* Progress bar + done count */}
      <div className="relative flex items-center gap-2.5">
        <div className="flex-1 h-[4px] rounded-full overflow-hidden bg-stone-200/70 dark:bg-stone-700/60">
          <div
            className="h-full rounded-full transition-[width] duration-300"
            style={{
              width: `${pct}%`,
              background: 'var(--boop-accent)',
            }}
          />
        </div>
        <span
          className="text-[11px] text-stone-500 dark:text-stone-400 tabular-nums"
          style={{ fontFamily: 'Geist Mono, ui-monospace, monospace' }}
        >
          {items === undefined ? '…' : `${done}/${total}`}
        </span>
      </div>
    </Link>
  );
});
