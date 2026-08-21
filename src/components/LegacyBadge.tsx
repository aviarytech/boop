/**
 * Marks a list whose provenance log was sealed by the celAssetDids migration
 * rather than minted by its owner. Those lists verify, but nobody holds their
 * signing key, so they can never record another event.
 *
 * Neutral on purpose. Most existing lists are in this state and none of them is
 * broken — items, sharing and publishing all work — so an accent or warning
 * colour would either compete with real calls to action or make the app look
 * like it is failing. The border and letter-spacing do the work of making it
 * read as a deliberate chip rather than more meta text.
 */

export function LegacyBadge({ className = "" }: { className?: string }) {
  return (
    <span
      className={`inline-flex items-center px-1.5 py-[3px] rounded-md text-[9px] font-bold uppercase tracking-[0.08em] leading-none whitespace-nowrap border border-stone-300 bg-stone-100 text-stone-700 dark:border-stone-600 dark:bg-stone-700 dark:text-stone-200 ${className}`}
      title="This list's history was sealed when it was migrated, so it can't record new provenance events. Make a copy from Share → Originals Provenance to get one that can."
    >
      legacy
    </span>
  );
}
