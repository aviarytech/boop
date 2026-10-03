/**
 * Publication utilities for did:webvh list publishing.
 *
 * Phase 4: Provides URL utilities for published lists.
 * DID creation is now handled server-side via Convex actions.
 */

/**
 * Get the public URL for a published list.
 *
 * @param webvhDid - The did:webvh DID of the published list
 * @returns The public URL for viewing the list
 */
export function getPublicListUrl(webvhDid: string): string {
  // Extract the DID identifier (everything after did:webvh:)
  const didId = webvhDid.replace("did:webvh:", "");
  // URL encode in case of special characters
  const encodedId = encodeURIComponent(didId);
  return `${window.location.origin}/public/${encodedId}`;
}

/**
 * Extract the DID from a public list URL.
 *
 * @param url - The public list URL
 * @returns The did:webvh DID, or null if invalid URL
 */
export function getDIDFromPublicUrl(url: string): string | null {
  try {
    const urlObj = new URL(url);
    const match = urlObj.pathname.match(/^\/public\/(.+)$/);
    if (!match) return null;
    const didId = decodeURIComponent(match[1]);
    return `did:webvh:${didId}`;
  } catch {
    return null;
  }
}
