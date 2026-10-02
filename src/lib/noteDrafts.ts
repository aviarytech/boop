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
  const record = JSON.stringify({ text, base, updatedAt: Date.now(), revision: crypto.randomUUID() });
  try { localStorage.setItem(prefix + key, record); memory.delete(key); }
  catch { memory.set(key, record); }
  return record;
}
export function draftText(key: string): string | null {
  try {
    const value = JSON.parse(readDraft(key) ?? "null");
    return typeof value?.text === "string" ? value.text : null;
  } catch { return null; }
}
export function clearDraft(key: string, record: string | null) {
  if (record === null || readDraft(key) !== record) return;
  memory.delete(key);
  released.delete(key);
  try {
    localStorage.removeItem(prefix + key);
    localStorage.removeItem(releasePrefix + key);
  } catch { /* SPA fallback */ }
}

export function draftBase(key: string): string | undefined {
  try {
    const value = JSON.parse(readDraft(key) ?? "null");
    return typeof value?.base === "string" ? value.base : undefined;
  } catch { return undefined; }
}


export type StoredDraft = { key: string; record: string; text: string; base?: string; updatedAt: number };
/** Include legacy single-slot drafts, but keep every editing session separate. */
export function listDrafts(documentKey: string): StoredDraft[] {
  const keys = new Set(memory.keys());
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key?.startsWith(prefix)) keys.add(key.slice(prefix.length));
    }
  } catch { /* memory-only browser */ }
  return [...keys].filter(key => key === documentKey || key.startsWith(documentKey + ":session:"))
    .flatMap(key => {
      const record = readDraft(key);
      try {
        const value = JSON.parse(record ?? "null");
        return record && typeof value?.text === "string"
          ? [{key, record, text: value.text, base: typeof value.base === "string" ? value.base : undefined,
            updatedAt: typeof value.updatedAt === "number" ? value.updatedAt : 0}] : [];
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
