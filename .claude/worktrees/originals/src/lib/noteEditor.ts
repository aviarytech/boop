/**
 * Pure helpers for the item-notes markdown editor. No imports on purpose:
 * shared between the React page and the Node test harness.
 */

/** Max length of an item's markdown notes/body. Kept in sync with the
 *  server-side guard in convex/items.ts (updateItem). */
export const MAX_NOTE_LENGTH = 50000;

/** Truncate note text to the maximum length. */
export function clampNote(text: string): string {
  return text.length > MAX_NOTE_LENGTH ? text.slice(0, MAX_NOTE_LENGTH) : text;
}

/** Decide whether a debounced autosave should fire. */
export function shouldPersist(opts: { draft: string; saved: string; canEdit: boolean }): boolean {
  return opts.canEdit && opts.draft !== opts.saved;
}
