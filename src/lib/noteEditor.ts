/**
 * Pure helpers for the markdown editors. Only imports pure modules, so the
 * Node test harness can bundle it.
 */
import { MAX_NOTE_LENGTH } from "../../convex/lib/noteBody";

export { MAX_NOTE_LENGTH };

/** Decide whether a debounced autosave should fire. */
export function shouldPersist(opts: { draft: string; saved: string; canEdit: boolean }): boolean {
  return opts.canEdit && opts.draft !== opts.saved;
}
