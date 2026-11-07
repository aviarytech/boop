/**
 * LWS storage resources over HTTP (docs/lws-agent-auth.md "Storage"), routed
 * at `B/lws/` for GET, HEAD, POST, PUT, PATCH, DELETE and OPTIONS:
 *
 *   B/lws/{u}                     storage description (application/lws+cid), public
 *   B/lws/{u}/                    storage root: the user's own lists
 *   B/lws/{u}/{listId}/           a list, as a container of its items
 *   B/lws/{u}/{listId}/{itemId}   an item (application/json)
 *   ….meta                        a resource's linkset (application/linkset+json)
 *
 * Everything but the description takes `Authorization: Bearer lwsat_…`, and
 * this is the only place one is accepted (lib/actor.ts requestCredentials).
 * Operations, authorization and preconditions are in lwsStorage.ts; this file
 * maps HTTP to them. Errors are RFC 9457 problem JSON with nothing from a
 * thrown error in them.
 */
import { httpAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { authErrorData } from "./lib/authError";
import { planErrorData } from "./lib/planError";
import { getCorsHeaders } from "./lib/httpResponses";
import { LWS_ACCESS_TOKEN_PREFIX, bearerToken } from "./lib/lwsTokens";
import { canonicalRequestUrl, LWS_STORAGE_REL, lwsBaseUrl, lwsChallenge, parseStoragePath, storageUri, USER_PATH_PATTERN } from "./lib/lwsUrls";
import {
  allowedMethods, evaluatePreconditions, lwsFailureData, parsePageParam, parseTarget, resourceLinks, selectRange,
  JSON_MEDIA, JSON_PATCH, MAX_STORAGE_BODY_BYTES, MERGE_PATCH, LWS_NS,
  type Preconditions, type StorageTarget,
} from "./lib/lwsStorage";
import type { Representation, WriteResult } from "./lwsStorage";

type Headers = Record<string, string>;

function cors(request: Request): Headers {
  return {
    ...getCorsHeaders(request),
    "Access-Control-Allow-Methods": "GET, HEAD, POST, PUT, PATCH, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": request.headers.get("Access-Control-Request-Headers")
      ?? "Authorization, Content-Type, If-Match, If-None-Match, If-Modified-Since, If-Unmodified-Since, If-Range, Range, Link, Slug, Prefer",
    "Access-Control-Expose-Headers": "ETag, Last-Modified, Link, Location, Content-Location, WWW-Authenticate, Allow, Accept-Patch, Accept-Post, Accept-Ranges, Content-Range, Retry-After",
  };
}

/** Headers that say what a resource accepts: Allow always, and the patch and post formats where they apply. */
function capabilityHeaders(target: StorageTarget): Headers {
  const headers: Headers = { Allow: allowedMethods(target).join(", "), "Accept-Ranges": isContainer(target) ? "none" : "bytes" };
  if (target.kind !== "description" && target.linkset) headers["Accept-Patch"] = JSON_PATCH;
  else if (target.kind === "item") headers["Accept-Patch"] = `${MERGE_PATCH}, ${JSON_PATCH}`;
  if (target.kind === "list" && !target.linkset) headers["Accept-Post"] = JSON_MEDIA;
  return headers;
}

/** Containers have listings; everything else (items, linksets, the description) is a byte sequence with ranges. */
const isContainer = (target: StorageTarget) => (target.kind === "root" || target.kind === "list") && !target.linkset;

/**
 * RFC 9457 problem details; `detail` is ours, never an exception's. One that
 * carries an ETag (412, 416) is no-transform too, so the edge keeps it strong
 * (representationCacheControl).
 */
function problem(request: Request, status: number, title: string, detail?: string, headers: Headers = {}): Response {
  return new Response(JSON.stringify({ type: "about:blank", title, status, ...(detail ? { detail } : {}) }), {
    status,
    headers: {
      "Content-Type": "application/problem+json", "Cache-Control": headers.ETag ? "no-store, no-transform" : "no-store",
      ...cors(request), ...headers,
    },
  });
}

const mediaType = (request: Request) => (request.headers.get("Content-Type") ?? "").split(";")[0].trim().toLowerCase();

/**
 * Cache-Control for a representation with a strong ETag. `no-transform`
 * keeps the edge in front of convex.site from compressing it: Cloudflare
 * gzips `application/json` and then weakens the ETag to `W/"…"`, which
 * If-Match (strong comparison, RFC 9110 13.1.1) can never match, so every
 * conditional write after a GET would be a 412.
 */
function representationCacheControl(target: StorageTarget | "created"): string {
  if (target === "created") return "no-store, no-transform";
  return target.kind === "description" ? "public, max-age=300, no-transform" : "private, no-cache, no-transform";
}

function requestPreconditions(request: Request): Preconditions {
  const header = (name: string) => request.headers.get(name) ?? undefined;
  return {
    ifMatch: header("If-Match"), ifNoneMatch: header("If-None-Match"),
    ifModifiedSince: header("If-Modified-Since"), ifUnmodifiedSince: header("If-Unmodified-Since"),
  };
}

/** The body as text, or null if it is over the size limit. */
async function readBody(request: Request): Promise<string | null> {
  const declared = Number(request.headers.get("Content-Length") ?? "0");
  if (declared > MAX_STORAGE_BODY_BYTES) return null;
  const text = await request.text();
  return new TextEncoder().encode(text).length > MAX_STORAGE_BODY_BYTES ? null : text;
}

/** Does a POST ask for a container (create-resource.md: `Link: <…lws#Container>; rel="type"`)? */
function asksForContainer(request: Request): boolean {
  const link = request.headers.get("Link") ?? "";
  return link.split(/,(?=\s*<)/).some(value => value.trim().startsWith(`<${LWS_NS}Container>`) && /;\s*rel\s*=\s*"?([^";]*\s)?type(\s[^";]*)?"?\s*(;|$)/i.test(value));
}

export const lwsStorage = httpAction(async (ctx, request) => {
  let base: string;
  try { base = lwsBaseUrl(); } catch (error) {
    console.error("[lwsStorageHttp] no base URL:", error);
    return problem(request, 500, "Internal error");
  }
  const canonical = canonicalRequestUrl(request.url, base);
  const parsed = parseStoragePath(canonical, base);
  if (!parsed) {
    // A malformed path (say, an empty segment) under a storage still names that storage.
    const userPath = canonical.slice(`${base}/lws/`.length).split("/")[0];
    const under = canonical.startsWith(`${base}/lws/`) && USER_PATH_PATTERN.test(userPath);
    return problem(request, 404, "Not found", undefined, under ? { Link: `<${storageUri(userPath, base)}>; rel="${LWS_STORAGE_REL}"` } : {});
  }
  const { userPath, subpath } = parsed;
  const storage = storageUri(userPath, base);
  const storageLink = { Link: `<${storage}>; rel="${LWS_STORAGE_REL}"` };
  const target = parseTarget(subpath);
  // Under a storage, even a path that names nothing says which storage it is in.
  if (!target) return problem(request, 404, "Not found", undefined, storageLink);
  const capabilities = capabilityHeaders(target);
  const method = request.method.toUpperCase();

  if (method === "OPTIONS") return new Response(null, { status: 204, headers: { ...cors(request), ...capabilities, ...storageLink } });
  if (!allowedMethods(target).includes(method)) {
    return problem(request, 405, "Method not allowed", `Allowed: ${capabilities.Allow}`, { ...capabilities, ...storageLink });
  }

  /** A representation as a response, honouring GET/HEAD conditionals and, on GET of a non-container, Range. */
  const respond = (representation: Representation, status = 200, extra: Headers = {}): Response => {
    const read = method === "GET" || method === "HEAD";
    const headers: Headers = {
      ...cors(request),
      ...capabilities,
      "Content-Type": representation.contentType,
      ETag: representation.etag,
      "Last-Modified": new Date(representation.lastModified).toUTCString(),
      // A linkset is metadata about another resource: it gets no linkset, up or
      // type links of its own (they would point at itself), only its storage.
      Link: target.kind === "description" || target.linkset ? storageLink.Link : [...resourceLinks(storage, target), ...(representation.links ?? [])].join(", "),
      "Cache-Control": representationCacheControl(target),
      Vary: [getCorsHeaders(request).Vary, target.kind === "description" ? undefined : "Authorization"].filter(Boolean).join(", "),
      ...extra,
    };
    if (!headers.Vary) delete headers.Vary;
    if (read) {
      const outcome = evaluatePreconditions(requestPreconditions(request), representation, true);
      if (outcome === "not-modified") {
        const { "Content-Type": _type, ...rest } = headers;
        void _type;
        return new Response(null, { status: 304, headers: rest });
      }
      if (outcome === "failed") return problem(request, 412, "Precondition failed", undefined, { ETag: representation.etag, Link: headers.Link });
    }
    let body: BodyInit | null = representation.body;
    let responseStatus = status;
    // RFC 9110 14.2: Range applies to GET only; HEAD answers as an unranged GET would.
    if (method === "GET" && !isContainer(target)) {
      const bytes = new TextEncoder().encode(representation.body);
      const range = selectRange(request.headers.get("Range") ?? undefined, request.headers.get("If-Range") ?? undefined, representation, bytes.length);
      if (range === "unsatisfiable") {
        return problem(request, 416, "Range not satisfiable", undefined, { "Content-Range": `bytes */${bytes.length}`, ETag: representation.etag, Link: headers.Link });
      }
      if (range) {
        body = bytes.slice(range.start, range.end + 1);
        responseStatus = 206;
        headers["Content-Range"] = `bytes ${range.start}-${range.end}/${bytes.length}`;
      }
    }
    return new Response(method === "HEAD" ? null : body, { status: responseStatus, headers });
  };

  try {
    if (target.kind === "description") {
      const description = await ctx.runQuery(internal.lwsStorage.describeStorage, { userPath });
      return description ? respond(description) : problem(request, 404, "No such storage", undefined, storageLink);
    }

    const agentToken = bearerToken(request);
    if (!agentToken?.startsWith(LWS_ACCESS_TOKEN_PREFIX)) {
      // RFC 6750 3.1: no error code unless a Bearer credential was presented.
      const presented = agentToken !== null;
      return problem(request, 401, "Authentication required", "Send Authorization: Bearer with an LWS access token",
        lwsChallenge(request.url, { base, ...(presented ? { error: "invalid_token" as const } : {}) }));
    }

    if (method === "GET" || method === "HEAD") {
      // A list container's later pages (lws-media-type.md "Pagination"): `?page=n`, from its Link headers.
      const page = target.kind === "list" && !target.linkset ? parsePageParam(new URL(request.url).searchParams.get("page")) : 1;
      if (page === null) return problem(request, 404, "No such page", undefined, storageLink);
      return respond(await ctx.runQuery(internal.lwsStorage.read, { agentToken, userPath, subpath, page }));
    }
    if (method === "DELETE") {
      await ctx.runMutation(internal.lwsStorage.deleteItem, { agentToken, userPath, subpath, preconditions: requestPreconditions(request) });
      return new Response(null, { status: 204, headers: { ...cors(request), ...storageLink } });
    }

    // POST, PUT and PATCH carry a body.
    if (method === "POST" && asksForContainer(request)) {
      return problem(request, 409, "Lists hold items only", "boop doesn't create containers inside a list", capabilities);
    }
    const type = mediaType(request);
    const expected = method === "PATCH" ? (target.linkset ? [JSON_PATCH] : [MERGE_PATCH, JSON_PATCH]) : [JSON_MEDIA];
    if (!expected.includes(type)) {
      return problem(request, 415, "Unsupported media type", `Send ${expected.join(" or ")}`, capabilities);
    }
    const body = await readBody(request);
    if (body === null) return problem(request, 413, "Request too large");
    const preconditions = requestPreconditions(request);

    if (method === "POST") {
      const created = await ctx.runMutation(internal.lwsStorage.createItem, { agentToken, userPath, subpath, body, preconditions });
      const itemTarget = { kind: "item" as const, listId: created.listId, itemId: created.itemId, linkset: false };
      // Without `read`, the agent gets where the item is and its validators, not its content.
      return new Response(created.readable ? created.body : null, {
        status: 201,
        headers: {
          ...cors(request),
          ...capabilityHeaders(itemTarget),
          ...(created.readable ? { "Content-Type": created.contentType } : {}),
          Location: created.location,
          "Content-Location": created.location,
          ETag: created.etag,
          "Last-Modified": new Date(created.lastModified).toUTCString(),
          Link: resourceLinks(storage, itemTarget).join(", "),
          "Cache-Control": representationCacheControl("created"),
        },
      });
    }
    if (target.linkset) {
      await ctx.runQuery(internal.lwsStorage.patchLinkset, { agentToken, userPath, subpath, patch: body, preconditions });
      return new Response(null, { status: 204, headers: { ...cors(request), ...capabilities, ...storageLink } });
    }
    const mode = method === "PUT" ? "put" as const : type === MERGE_PATCH ? "merge-patch" as const : "json-patch" as const;
    const written: WriteResult = await ctx.runMutation(internal.lwsStorage.writeItem, { agentToken, userPath, subpath, mode, body, preconditions });
    if (written.readable) return respond(written);
    // Without `read`: 204 with the new validators, so a later write can be conditional.
    return new Response(null, {
      status: 204,
      headers: {
        ...cors(request), ...capabilities, ETag: written.etag, "Last-Modified": new Date(written.lastModified).toUTCString(),
        Link: resourceLinks(storage, target).join(", "), "Cache-Control": representationCacheControl(target),
      },
    });
  } catch (error) {
    const lws = lwsFailureData(error);
    if (lws) {
      const challenge = lws.challenge ? lwsChallenge(request.url, { base, error: lws.challenge }) : storageLink;
      return problem(request, lws.status, lws.title, lws.detail, { ...(lws.status === 404 ? {} : capabilities), ...challenge });
    }
    // A shared operation's own refusal: unavailable reads as not found.
    const auth = authErrorData(error);
    if (auth) {
      return auth.code === "FORBIDDEN"
        ? problem(request, 404, "Not found", undefined, storageLink)
        : problem(request, 401, "Authentication required", undefined, lwsChallenge(request.url, { base, error: "invalid_token" }));
    }
    const plan = planErrorData(error);
    if (plan) return problem(request, 403, "Plan limit", plan.message, storageLink);
    console.error("[lwsStorageHttp] request failed:", error);
    return problem(request, 500, "Internal error", undefined, storageLink);
  }
});
