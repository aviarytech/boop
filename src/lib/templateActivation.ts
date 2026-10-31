// Scoped to an authenticated account and runbook. Persist the creation key before
// sending the mutation so a refresh after a lost response can safely retry the same write.
export function templateCreationKey(did: string, slug: string, fresh = false): string {
  const key = `boop:template-attempt:${did}:${slug}`;
  const saved = sessionStorage.getItem(key);
  if (saved) {
    try {
      const value = JSON.parse(saved);
      if (!(fresh && value.completed) && typeof value.creationKey === 'string') return value.creationKey;
    } catch { /* Replace corrupt local state; never interpret it as a redirect. */ }
  }
  const creationKey = crypto.randomUUID();
  sessionStorage.setItem(key, JSON.stringify({ creationKey }));
  return creationKey;
}
export function finishTemplateAttempt(did: string, slug: string) {
  const key = `boop:template-attempt:${did}:${slug}`;
  const saved = sessionStorage.getItem(key);
  if (saved) sessionStorage.setItem(key, JSON.stringify({ ...JSON.parse(saved), completed: true }));
}
