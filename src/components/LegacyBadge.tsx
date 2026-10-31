/**
 * Marks a list made before Originals 5. Its did:cel history can no longer be
 * read, so its owner re-mints it as a new Original the next time they open it.
 *
 * Neutral on purpose: the list itself works — items, sharing and publishing —
 * and the re-mint happens on open, so a warning colour would only alarm.
 */

export function LegacyBadge({ className = "" }: { className?: string }) {
  return (
    <span
      className={`inline-flex items-center px-1.5 py-[3px] rounded-md text-[9px] font-bold uppercase tracking-[0.08em] leading-none whitespace-nowrap border border-stone-300 bg-stone-100 text-stone-700 dark:border-stone-600 dark:bg-stone-700 dark:text-stone-200 ${className}`}
      title="Made before Originals 5. Open it to re-mint it as a new Original."
    >
      legacy
    </span>
  );
}
