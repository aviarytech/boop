/** Do not leak sessions to mixed-version signed storage URLs or redirects.
 * The configured HTTP origin is trusted; server-returned locators are not. */
export async function fetchAttachment(url: string, httpOrigin: string, token: string | null, signal?: AbortSignal): Promise<Blob> {
  const target = new URL(url);
  const trusted = new URL(httpOrigin);
  if (target.origin !== trusted.origin || target.pathname !== '/api/attachments/download' ||
      target.username || target.password || target.hash ||
      (target.protocol !== 'https:' && !(target.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(target.hostname)))) {
    throw new Error('Attachment service needs an update. Reload after the update.');
  }
  const response = await fetch(target.href, { headers: token ? { Authorization: `Bearer ${token}` } : {},
    cache: 'no-store', redirect: 'error', credentials: 'omit', signal });
  if (!response.ok) throw new Error('Attachment unavailable');
  return response.blob();
}
