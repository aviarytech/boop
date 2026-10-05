import { createListAsset } from './originals';

// Scoped to an authenticated account and runbook. Persist the asset before sending
// the mutation so a refresh after a lost response can safely retry the same write.
const inFlight = new Map<string, ReturnType<typeof createListAsset>>();
export async function templateAsset(did: string, slug: string, name: string, fresh = false) {
  const key = `boop:template-attempt:${did}:${slug}`;
  const saved = sessionStorage.getItem(key);
  if (saved) {
    try {
      const value = JSON.parse(saved);
      if (!(fresh && value.completed) && typeof value.assetDid === 'string' && typeof value.envelope === 'string') return value as Awaited<ReturnType<typeof createListAsset>>;
    } catch { /* Replace corrupt local state; never interpret it as a redirect. */ }
  }
  let pending = inFlight.get(key);
  if (!pending) {
    pending = createListAsset(name, did).then(asset => {
      sessionStorage.setItem(key, JSON.stringify(asset));
      return asset;
    }).finally(() => inFlight.delete(key));
    inFlight.set(key, pending);
  }
  return pending;
}
export function finishTemplateAttempt(did: string, slug: string) {
  const key = `boop:template-attempt:${did}:${slug}`;
  const saved = sessionStorage.getItem(key);
  if (saved) sessionStorage.setItem(key, JSON.stringify({ ...JSON.parse(saved), completed: true }));
}
