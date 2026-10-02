/** Account/resource-scoped drafts. Memory also preserves SPA navigation if
 * browser storage is unavailable. A save may only clear its own revision. */
const memory = new Map<string, string>();
const prefix = "boop-note-draft:";
export function readDraft(key: string): string | null {
  try { return memory.get(key) ?? localStorage.getItem(prefix + key) ?? null; }
  catch { return memory.get(key) ?? null; }
}
export function writeDraft(key: string, text: string): string {
  const record = JSON.stringify({ text, revision: crypto.randomUUID() });
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
  try { localStorage.removeItem(prefix + key); } catch { /* SPA fallback */ }
}
