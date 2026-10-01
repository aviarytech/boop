/**
 * Index card for a note: the ListCard shell, with an excerpt and word count
 * where the list's progress bar sits.
 */

import { memo } from "react";
import { Link } from "react-router-dom";
import type { Doc } from "../../convex/_generated/dataModel";
import type { NoteCardSummary } from "../../convex/lib/noteBody";
import { useSettings } from "../hooks/useSettings";
import { ownerTag, shortRelativeTime } from "../lib/format";

const MONO = 'Geist Mono, ui-monospace, monospace';

interface NoteCardProps {
  list: Doc<"lists">;
  /** Absent while the batched summary query loads, or offline. */
  summary?: NoteCardSummary;
  currentUserDid: string;
  showOwner?: boolean;
}

export const NoteCard = memo(function NoteCard({ list, summary, currentUserDid, showOwner }: NoteCardProps) {
  const { haptic } = useSettings();
  const tag = ["note", ownerTag(list.ownerDid, currentUserDid, showOwner), shortRelativeTime(list.createdAt)].join(" · ");

  return (
    <Link
      to={`/n/${list._id}`}
      onClick={() => haptic('light')}
      className="group block relative overflow-hidden bg-white dark:bg-stone-800/70 rounded-[18px] p-[18px] border border-stone-200/70 dark:border-stone-700/50 hover:border-amber-300/60 dark:hover:border-amber-700/50 hover:-translate-y-[1px] transition-all duration-150 active:scale-[0.99]"
      aria-label={`Open note: ${list.name}`}
    >
      <div className="relative mb-2 min-w-0">
        <div
          className="mb-1 text-[11px] text-stone-500 dark:text-stone-400 lowercase truncate"
          style={{ fontFamily: MONO }}
        >
          {tag}
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

      {summary?.excerpt ? (
        <p className="text-[13.5px] leading-snug text-stone-600 dark:text-stone-300 line-clamp-2 mb-3">
          {summary.excerpt}
        </p>
      ) : (
        <p className="text-[13.5px] leading-snug text-stone-400 dark:text-stone-500 italic mb-3">
          {summary ? "Nothing written yet" : " "}
        </p>
      )}

      <div
        className="flex items-center gap-2 text-[11px] text-stone-500 dark:text-stone-400 tabular-nums"
        style={{ fontFamily: MONO }}
      >
        {summary ? (
          <>
            <span>{summary.wordCount} {summary.wordCount === 1 ? "word" : "words"}</span>
            <span className="text-stone-300 dark:text-stone-600">·</span>
            <span>edited {shortRelativeTime(summary.updatedAt)}</span>
          </>
        ) : (
          <span>…</span>
        )}
      </div>
    </Link>
  );
});
