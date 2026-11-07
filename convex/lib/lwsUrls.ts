/**
 * LWS URLs (docs/lws-agent-auth.md "URLs"). `B` is LWS_BASE_URL, else the
 * Convex site URL, without a trailing slash; `{u}` is the user's DID path.
 * Pure apart from reading the environment, so tests import it directly.
 */

/** A did:webvh path boop serves (convex/lib/didLogAuth.ts didLogPathForSubOrg). */
export const USER_PATH_PATTERN = /^user-[A-Za-z0-9-]{1,32}$/;

export const LWS_STORAGE_REL = "https://www.w3.org/ns/lws#storage";

/** `B`. Throws when neither variable is set: no URL is better than a wrong one. */
export function lwsBaseUrl(): string {
  const base = process.env.LWS_BASE_URL || process.env.CONVEX_SITE_URL;
  if (!base) throw new Error("LWS_BASE_URL or CONVEX_SITE_URL must be set");
  return base.replace(/\/+$/, "");
}

/** `B/lws/{u}`: the storage, and its description. */
export function storageUri(userPath: string, base = lwsBaseUrl()): string {
  if (!USER_PATH_PATTERN.test(userPath)) throw new Error("Not a user path");
  return `${base}/lws/${userPath}`;
}

/** `B/lws/{u}/`: the storage root container. */
export function storageRootUri(userPath: string, base = lwsBaseUrl()): string {
  return `${storageUri(userPath, base)}/`;
}

export const accessRequestsUri = (base = lwsBaseUrl()) => `${base}/lws-access/requests`;
export const accessRequestUri = (requestId: string, base = lwsBaseUrl()) => `${accessRequestsUri(base)}/${requestId}`;
export const tokenEndpointUri = (base = lwsBaseUrl()) => `${base}/oauth/token`;
export const PROTECTED_RESOURCE_METADATA_PATH = "/.well-known/oauth-protected-resource";

/**
 * A URL under `B/lws/` → its user path and what follows it: `""` for the
 * storage itself, `"/"` for the root container, `"/{listId}/…"` below it.
 * Null for anything else, including a query or fragment, an empty or `.`/`..`
 * segment, or a user path that isn't one boop serves.
 */
export function parseStoragePath(url: string, base = lwsBaseUrl()): { userPath: string; subpath: string } | null {
  const prefix = `${base}/lws/`;
  if (!url.startsWith(prefix) || /[?#]/.test(url)) return null;
  const rest = url.slice(prefix.length);
  const slash = rest.indexOf("/");
  const userPath = slash < 0 ? rest : rest.slice(0, slash);
  const subpath = slash < 0 ? "" : rest.slice(slash);
  if (!USER_PATH_PATTERN.test(userPath)) return null;
  const segments = subpath.split("/").slice(1);
  // Only the last segment may be empty (a container's trailing slash).
  if (segments.slice(0, -1).some(segment => segment === "") || segments.some(segment => segment === "." || segment === "..")) return null;
  return { userPath, subpath };
}

/** The resource a request names, at `B` (the router may see another origin than clients use), without its query. */
export function canonicalRequestUrl(requestUrl: string, base = lwsBaseUrl()): string {
  return `${base}${new URL(requestUrl).pathname}`;
}

/** RFC 9728 metadata URL for a resource at `B`: the well-known path inserted before the resource's path. */
export function protectedResourceMetadataUri(resourceUrl: string, base = lwsBaseUrl()): string {
  if (!resourceUrl.startsWith(`${base}/`)) throw new Error("Not a resource at the LWS base URL");
  return `${base}${PROTECTED_RESOURCE_METADATA_PATH}${resourceUrl.slice(base.length)}`;
}

/**
 * Headers for a storage server's 401 (LWS Authorization "Authorization Server
 * Discovery"): a Bearer challenge naming the resource's metadata, and the
 * Link to the storage holding it, which the client passes as `resource`.
 * Throws for a URL that isn't a storage resource.
 */
export function lwsChallenge(
  requestUrl: string,
  options: { error?: "invalid_token" | "invalid_request" | "insufficient_scope"; base?: string } = {},
): Record<string, string> {
  const base = options.base ?? lwsBaseUrl();
  const resource = canonicalRequestUrl(requestUrl, base);
  const parsed = parseStoragePath(resource, base);
  if (!parsed) throw new Error("Not an LWS storage resource");
  const challenge = `Bearer resource_metadata="${protectedResourceMetadataUri(resource, base)}"${options.error ? `, error="${options.error}"` : ""}`;
  return {
    "WWW-Authenticate": challenge,
    Link: `<${storageUri(parsed.userPath, base)}>; rel="${LWS_STORAGE_REL}"`,
  };
}
