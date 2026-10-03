/** Content revisions cover every writer, including older/native and HTTP entry
 * points. Hash the complete persisted document, never client wall-clock time. */
export function canonical(value: unknown): string {
  if (value === undefined) return 'null';
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  return `{${Object.entries(value).filter(([, v]) => v !== undefined).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(',')}}`;
}
export async function revision(value: unknown): Promise<string> {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonical(value)));
  return Array.from(new Uint8Array(bytes), b => b.toString(16).padStart(2, '0')).join('');
}
export type ExpectedRevision = { id: string; revision: string; predecessor?: string };
export type ReplayAck = { operationId: string; sequence?: number; result: unknown; revisions: Record<string, string> };
export function replayTargets(type: string, payload: Record<string, unknown>): string[] {
  if (type === 'addItem' || type === 'createList') return [];
  if (typeof payload.itemId === 'string') return [payload.itemId];
  if (Array.isArray(payload.itemIds)) return [...new Set(payload.itemIds as string[])];
  if (typeof payload.listId === 'string') return [payload.listId];
  return [];
}
