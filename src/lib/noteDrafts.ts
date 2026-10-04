export { randomId as draftRevision } from "./randomId";
import { randomId as draftRevision } from "./randomId";

/** Account/resource-scoped drafts. Memory also preserves SPA navigation if
 * browser storage is unavailable. A save may only clear its own revision. */
const memory = new Map<string, string>();
const prefix = "boop-note-draft:";
const released = new Set<string>();
const releasePrefix = "boop-note-draft-released:";
export function readDraft(key: string): string | null {
  try { return memory.get(key) ?? localStorage.getItem(prefix + key) ?? null; }
  catch { return memory.get(key) ?? null; }
}
export function writeDraft(key: string, text: string, base?: string): string {
  const detached = draftIsDetached(key);
  const record = JSON.stringify({ text, ...(detached ? { detached: true } : { base }), updatedAt: Date.now(), revision: draftRevision() });
  try { localStorage.setItem(prefix + key, record); memory.delete(key); }
  catch { memory.set(key, record); }
  draftChanged();
  return record;
}
export function draftText(key: string): string | null {
  try {
    const value = JSON.parse(readDraft(key) ?? "null");
    return typeof value?.text === "string" ? value.text : null;
  } catch { return null; }
}
export function clearDraft(key: string, record: string | null) {
  if (record === null || readDraft(key) !== record) return false;
  memory.delete(key);
  released.delete(key);
  try {
    localStorage.removeItem(prefix + key);
    localStorage.removeItem(releasePrefix + key);
  } catch { /* SPA fallback */ }
  draftChanged();
  return true;
}

export function draftBase(key: string): string | undefined {
  try {
    const value = JSON.parse(readDraft(key) ?? "null");
    return typeof value?.base === "string" ? value.base : undefined;
  } catch { return undefined; }
}


export type StoredDraft = { key: string; record: string; text: string; base?: string; updatedAt: number; detached?: boolean };
/** Include legacy single-slot drafts, but keep every editing session separate. */
// Aliases must come from verified identities of the current account, never
// from a shared resource owner. Writes continue under the canonical key.
export function listDrafts(documentKey: string, aliases: readonly string[] = []): StoredDraft[] {
  const documentKeys = new Set([documentKey, ...aliases]);
  const keys = new Set(memory.keys());
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key?.startsWith(prefix)) keys.add(key.slice(prefix.length));
    }
  } catch { /* memory-only browser */ }
  return [...keys].filter(key => [...documentKeys].some(documentKey => key === documentKey || key.startsWith(documentKey + ":session:")))
    .flatMap(key => {
      const record = readDraft(key);
      try {
        const value = JSON.parse(record ?? "null");
        return record && typeof value?.text === "string"
          ? [{key, record, text: value.text, base: typeof value.base === "string" ? value.base : undefined,
            detached: value.detached === true, updatedAt: typeof value.updatedAt === "number" ? value.updatedAt : 0}] : [];
      } catch { return []; }
    }).sort((a, b) => b.updatedAt - a.updatedAt);
}


/** Only the owning editor calls this, after it can no longer accept edits. */
export function releaseDraft(key: string) {
  if (readDraft(key) === null) return;
  released.add(key);
  try { localStorage.setItem(releasePrefix + key, "released"); } catch { /* conservative across tabs */ }
}

/** Unknown/crashed owners are preserved. A revision match alone is not ownership. */
export function clearRecoveredDraft(source: StoredDraft) {
  let ownerReleased = released.has(source.key);
  try { ownerReleased ||= localStorage.getItem(releasePrefix + source.key) === "released"; } catch { /* preserve */ }
  if (ownerReleased) clearDraft(source.key, source.record);
}

/** Once source editing is unavailable, retain only the independent local text.
 * The original server body is a comparison cache, not recoverable user work. */
export function detachDraftBases(documentKey: string, aliases: readonly string[] = []): boolean {
  for (const key of [documentKey, ...aliases]) {
    const previous = accessFor(key);
    const denied = { canEdit: false, checkedAt: previous?.checkedAt ?? -1 };
    accessMemory.set(key, denied);
    try { localStorage.setItem(accessPrefix + key, JSON.stringify(denied)); accessMemory.delete(key); } catch { /* memory fallback */ }
  }
  let changed = false;
  for (const draft of listDrafts(documentKey, aliases)) {
    if (draft.detached || readDraft(draft.key) !== draft.record) continue;
    const value = JSON.parse(draft.record);
    delete value.base;
    value.detached = true;
    const record = JSON.stringify(value);
    try { localStorage.setItem(prefix + draft.key, record); memory.delete(draft.key); }
    catch { memory.set(draft.key, record); }
    changed = true;
  }
  if (changed) draftChanged();
  return changed;
}

const accessPrefix = 'boop-note-access:';
const accessMemory = new Map<string, { canEdit: boolean; checkedAt: number }>();
const draftEvent = 'boop-note-drafts-changed';
function documentOf(key: string) { return key.split(':session:')[0]; }
function accessFor(key: string): { canEdit: boolean; checkedAt: number } | undefined {
  // Quota failures can reject writes while reads still return an older grant.
  const pending = accessMemory.get(documentOf(key));
  if (pending) return pending;
  try { return JSON.parse(localStorage.getItem(accessPrefix + documentOf(key)) ?? 'null') ?? undefined; }
  catch { return accessMemory.get(documentOf(key)); }
}
function draftChanged() { if (typeof window !== 'undefined') window.dispatchEvent(new Event(draftEvent)); }
export function subscribeDrafts(listener: () => void) {
  if (typeof window === 'undefined') return () => {};
  window.addEventListener(draftEvent, listener); window.addEventListener('storage', listener);
  return () => { window.removeEventListener(draftEvent, listener); window.removeEventListener('storage', listener); };
}
export function draftIsDetached(key: string): boolean {
  try { return accessFor(key)?.canEdit === false || JSON.parse(readDraft(key) ?? 'null')?.detached === true; }
  catch { return accessFor(key)?.canEdit === false; }
}
export function sameDraftRevision(left: string | null, right: string | null): boolean {
  if (left === right) return true;
  try { const a = JSON.parse(left ?? 'null'), b = JSON.parse(right ?? 'null'); return !!a?.revision && a.revision === b?.revision; }
  catch { return false; }
}
/** Server timestamps fence stale tabs. Previously detached drafts remain
 * export-only even after a later grant; newly authored sessions can edit. */
export function reconcileDraftAccess(documentKey: string, canEdit: boolean, checkedAt: number) {
  const prior = accessFor(documentKey);
  if (prior && (prior.checkedAt > checkedAt || (prior.checkedAt === checkedAt && !prior.canEdit && canEdit))) return;
  const next = { canEdit, checkedAt };
  accessMemory.set(documentKey, next);
  try { localStorage.setItem(accessPrefix + documentKey, JSON.stringify(next)); accessMemory.delete(documentKey); } catch { /* memory fallback */ }
  if (!canEdit) detachDraftBases(documentKey);
}
export function draftResources(dids: string[]): Array<{ documentKey: string; kind: 'note' | 'item'; id: string }> {
  const keys = new Set(memory.keys());
  try { for (let i = 0; i < localStorage.length; i++) { const key = localStorage.key(i); if (key?.startsWith(prefix)) keys.add(key.slice(prefix.length)); } } catch { /* memory */ }
  const documents = new Set([...keys].map(documentOf));
  return [...documents].flatMap(documentKey => {
    for (const did of dids) for (const kind of ['note', 'item'] as const) {
      const start = `${did}:${kind}:`;
      if (documentKey.startsWith(start)) return [{ documentKey, kind, id: documentKey.slice(start.length) }];
    }
    return [];
  });
}
