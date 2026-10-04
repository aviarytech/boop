/** Downloads and API responses must never be served from the app shell cache. */
export function isUncacheableResource(url: URL): boolean {
  return url.pathname.startsWith('/api/') || url.pathname.startsWith('/attachments/') ||
    /\/resources\//.test(url.pathname) || url.searchParams.has('X-Amz-Signature');
}
export async function purgeAppDownloadCaches(storage: CacheStorage | undefined = globalThis.caches): Promise<void> {
  if (!storage) return;
  for (const name of await storage.keys()) {
    if (!name.startsWith('lisa-')) continue;
    const cache = await storage.open(name);
    for (const request of await cache.keys()) if (isUncacheableResource(new URL(request.url))) await cache.delete(request);
  }
}
