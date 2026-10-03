import { openDB } from 'idb';
/** Legacy storage has no account key. Never return its contents to UI callers
 * until a fresh authenticated server identity identifies the recorded author. */
async function legacyRows(): Promise<Record<string, unknown>[]> {
  try {
    const db = await openDB('lisa-offline', undefined, { upgrade(_db, oldVersion, _newVersion, tx) { if (oldVersion === 0) tx.abort(); } });
    try { return db.objectStoreNames.contains('mutations') ? await db.getAll('mutations') : []; }
    finally { db.close(); }
  } catch { return []; }
}
export async function hasLegacyWork() { return (await legacyRows()).length > 0; }
export async function exportIdentifiedLegacyWork(identity: { did: string; legacyDid?: string }) {
  const dids = new Set([identity.did, identity.legacyDid].filter(Boolean));
  return (await legacyRows()).filter(row => {
    const p = row.payload as Record<string, unknown> | undefined;
    if (!p || typeof p !== 'object') return false;
    const authors = ['createdByDid', 'checkedByDid', 'userDid', 'ownerDid'].map(k => p[k]).filter(v => v !== undefined);
    return authors.length > 0 && authors.every(did => typeof did === 'string' && dids.has(did));
  });
}
