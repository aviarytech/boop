/**
 * LWS HTTP endpoints for agent enrollment and tokens (docs/lws-agent-auth.md):
 *
 *   POST B/lws-access/requests            AccessRequestService
 *   GET  B/lws-access/requests/{id}       the request, and its grant once approved
 *   POST B/oauth/token                    RFC 8693 token exchange
 *   GET  B/.well-known/lws-configuration  authorization server metadata (RFC 8414)
 *   GET  B/.well-known/oauth-protected-resource/lws/…  protected resource metadata (RFC 9728)
 *
 * Errors are RFC 9457 problem JSON, or RFC 6749 errors at the token endpoint;
 * neither carries anything from a thrown error.
 */
import { httpAction, type ActionCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import { hashApiKey } from "./lib/apiKeyHelpers";
import { getCorsHeaders } from "./lib/httpResponses";
import { LWS_JSON, parseAccessRequest } from "./lib/lwsAccess";
import { ACCESS_REQUEST_ID_PATTERN, bearerToken, generateAccessRequestId, generateAgentFragment, generateLwsAccessToken } from "./lib/lwsTokens";
import { lwsBaseUrl, parseStoragePath, PROTECTED_RESOURCE_METADATA_PATH, tokenEndpointUri } from "./lib/lwsUrls";
import type { RateLimitEndpoint } from "./rateLimits";

export const TOKEN_EXCHANGE_GRANT = "urn:ietf:params:oauth:grant-type:token-exchange";
export const JWT_TOKEN_TYPE = "urn:ietf:params:oauth:token-type:jwt";
export const ACCESS_TOKEN_TYPE = "urn:ietf:params:oauth:token-type:access_token";
const MAX_BODY_BYTES = 16 * 1024;

function cors(request: Request): Record<string, string> {
  return {
    ...getCorsHeaders(request),
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Expose-Headers": "Location, WWW-Authenticate, Link, Retry-After",
  };
}

/** RFC 9457 problem details. `detail` is ours, never an exception's. */
export function problem(request: Request, status: number, title: string, detail?: string, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify({ type: "about:blank", title, status, ...(detail ? { detail } : {}) }), {
    status,
    headers: { "Content-Type": "application/problem+json", "Cache-Control": "no-store", ...cors(request), ...headers },
  });
}

/**
 * The error codes the token endpoint uses: RFC 6749 5.2's, and RFC 8707's
 * invalid_target, which RFC 8693 2.2.2 names for an unacceptable `resource`.
 */
type OAuthErrorCode = "invalid_request" | "invalid_client" | "invalid_grant" | "unauthorized_client" | "unsupported_grant_type" | "invalid_scope" | "invalid_target";

/** RFC 6749 5.2 error. */
function oauthError(request: Request, error: OAuthErrorCode, description?: string, status = 400, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify({ error, ...(description ? { error_description: description } : {}) }), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store", Pragma: "no-cache", ...cors(request), ...headers },
  });
}

function json(request: Request, body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...cors(request), ...headers } });
}

export const lwsOptions = httpAction(async (_ctx, request) => new Response(null, { status: 204, headers: cors(request) }));

/** The caller's IP as the router sees it, hashed: rate-limit keys never hold an address. */
async function ipKey(request: Request): Promise<string> {
  const ip = request.headers.get("cf-connecting-ip")?.trim()
    || request.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
    || "unknown";
  return `ip:${await hashApiKey(ip)}`;
}

/**
 * A 429 when this IP is over its budget, else null. At the token endpoint it
 * is an RFC 6749 error: 5.2 has no rate-limit code, so `invalid_request` with
 * a description and Retry-After.
 */
async function rateLimited(ctx: ActionCtx, request: Request, endpoint: RateLimitEndpoint, asProblem = true): Promise<Response | null> {
  const result = await ctx.runMutation(internal.rateLimits.checkAndIncrementInternal, { key: await ipKey(request), endpoint });
  if (result.allowed) return null;
  const retryAfter = String(Math.max(1, Math.ceil((result.retryAfterMs ?? 60000) / 1000)));
  return asProblem
    ? problem(request, 429, "Too many requests", undefined, { "Retry-After": retryAfter })
    : oauthError(request, "invalid_request", `Too many requests: try again in ${retryAfter} seconds`, 429, { "Retry-After": retryAfter });
}

/** The body as text, or null if it is over the size limit. */
async function readBody(request: Request): Promise<string | null> {
  const declared = Number(request.headers.get("Content-Length") ?? "0");
  if (declared > MAX_BODY_BYTES) return null;
  const text = await request.text();
  return new TextEncoder().encode(text).length > MAX_BODY_BYTES ? null : text;
}

const mediaType = (request: Request) => (request.headers.get("Content-Type") ?? "").split(";")[0].trim().toLowerCase();
/** RFC 6750 3.1: `error="invalid_token"` only when a Bearer credential was presented. */
const unauthorized = (request: Request, detail?: string) =>
  problem(request, 401, "Authentication required", detail, { "WWW-Authenticate": bearerToken(request) === null ? "Bearer" : 'Bearer error="invalid_token"' });

/** POST B/lws-access/requests */
export const postAccessRequest = httpAction(async (ctx, request) => {
  try {
    const limited = await rateLimited(ctx, request, "lwsAccessRequest");
    if (limited) return limited;
    const jwt = bearerToken(request);
    if (!jwt) return unauthorized(request, "Sign the request with the assignee's did:key");
    if (!["application/lws+json", "application/ld+json", "application/json"].includes(mediaType(request))) {
      return problem(request, 415, "Unsupported media type", "Send application/lws+json");
    }
    const text = await readBody(request);
    if (text === null) return problem(request, 413, "Request too large");
    let body: unknown;
    try { body = JSON.parse(text); } catch { return problem(request, 400, "Invalid access request", "The body is not JSON"); }
    const parsed = parseAccessRequest(body, lwsBaseUrl());
    if (!parsed.ok) return problem(request, 400, "Invalid access request", parsed.detail);
    const { userPath, assignee, actions, name } = parsed.value;
    const result = await ctx.runMutation(internal.lwsAccess.createAccessRequestInternal, {
      jwt,
      request: { userPath, assignee, actions, name },
      requestId: generateAccessRequestId(),
      fragments: Array.from({ length: 4 }, generateAgentFragment),
    });
    if (!result.ok) {
      return result.status === 401 ? unauthorized(request, result.detail) : problem(request, result.status, result.title, result.detail);
    }
    return new Response(JSON.stringify(result.document), {
      status: result.created ? 201 : 200,
      headers: { "Content-Type": LWS_JSON, Location: result.location, "Cache-Control": "no-store", ...cors(request) },
    });
  } catch (error) {
    console.error("[lwsHttp] access request failed:", error);
    return problem(request, 500, "Internal error");
  }
});

const REQUESTS_PREFIX = "/lws-access/requests/";

/** GET B/lws-access/requests/{id} */
export const getAccessRequest = httpAction(async (ctx, request) => {
  try {
    const limited = await rateLimited(ctx, request, "lwsToken");
    if (limited) return limited;
    const path = new URL(request.url).pathname;
    const requestId = path.startsWith(REQUESTS_PREFIX) ? path.slice(REQUESTS_PREFIX.length) : "";
    if (!ACCESS_REQUEST_ID_PATTERN.test(requestId)) return problem(request, 404, "No such access request");
    const jwt = bearerToken(request);
    if (!jwt) return unauthorized(request, "Sign the request with the assignee's did:key");
    const result = await ctx.runMutation(internal.lwsAccess.pollAccessRequestInternal, { jwt, requestId });
    if (!result.ok) return result.status === 401 ? unauthorized(request, result.detail) : problem(request, result.status, result.title, result.detail);
    return new Response(JSON.stringify(result.document), {
      status: 200,
      headers: { "Content-Type": LWS_JSON, "Cache-Control": "no-store", ...cors(request) },
    });
  } catch (error) {
    console.error("[lwsHttp] access request poll failed:", error);
    return problem(request, 500, "Internal error");
  }
});

/** The single value of a form parameter; `undefined` when absent, null when repeated (RFC 6749 3.2). */
function single(form: URLSearchParams, name: string): string | undefined | null {
  const values = form.getAll(name);
  return values.length === 0 ? undefined : values.length === 1 ? values[0] : null;
}

/** POST B/oauth/token */
export const tokenEndpoint = httpAction(async (ctx, request) => {
  try {
    const limited = await rateLimited(ctx, request, "lwsToken", false);
    if (limited) return limited;
    if (mediaType(request) !== "application/x-www-form-urlencoded") return oauthError(request, "invalid_request", "Send application/x-www-form-urlencoded");
    const text = await readBody(request);
    if (text === null) return oauthError(request, "invalid_request", "Request too large");
    const form = new URLSearchParams(text);
    for (const name of new Set(form.keys())) {
      if (single(form, name) === null) return oauthError(request, "invalid_request", `${name} is repeated`);
    }
    const grantType = single(form, "grant_type");
    if (grantType !== TOKEN_EXCHANGE_GRANT) return oauthError(request, grantType ? "unsupported_grant_type" : "invalid_request", "Use token exchange");
    const subjectToken = single(form, "subject_token");
    if (!subjectToken) return oauthError(request, "invalid_request", "subject_token is required");
    if (single(form, "subject_token_type") !== JWT_TOKEN_TYPE) return oauthError(request, "invalid_request", `subject_token_type must be ${JWT_TOKEN_TYPE}`);
    const requested = single(form, "requested_token_type");
    if (requested !== undefined && requested !== ACCESS_TOKEN_TYPE) return oauthError(request, "invalid_request", "Only access tokens are issued");
    if (single(form, "actor_token") !== undefined) return oauthError(request, "invalid_request", "actor_token is not supported");
    const resource = single(form, "resource");
    if (!resource) return oauthError(request, "invalid_target", "resource is required");
    const audience = single(form, "audience");
    if (audience !== undefined && audience !== resource) return oauthError(request, "invalid_target", "audience must be the resource");
    const scope = single(form, "scope") ?? undefined;

    const result = await ctx.runMutation(internal.lwsAccess.exchangeTokenInternal, {
      subjectToken, resource, scope, accessToken: generateLwsAccessToken(),
    });
    if (!result.ok) return oauthError(request, result.error, result.description);
    return new Response(JSON.stringify({
      access_token: result.accessToken,
      issued_token_type: ACCESS_TOKEN_TYPE,
      token_type: "Bearer",
      expires_in: result.expiresIn,
      scope: result.scope,
    }), { status: 200, headers: { "Content-Type": "application/json", "Cache-Control": "no-store", Pragma: "no-cache", ...cors(request) } });
  } catch (error) {
    console.error("[lwsHttp] token exchange failed:", error);
    // server_error is an authorization-endpoint code (RFC 6749 4.1.2.1), not a token-endpoint one.
    return oauthError(request, "invalid_request", "Internal error: try again later", 500);
  }
});

/** Authorization server metadata at `B` (RFC 8414; LWS Authorization). */
export function lwsConfiguration(base: string) {
  return {
    issuer: base,
    token_endpoint: tokenEndpointUri(base),
    grant_types_supported: [TOKEN_EXCHANGE_GRANT],
    subject_token_types_supported: [JWT_TOKEN_TYPE],
    subject_identifier_types_supported: ["did:webvh"],
    // Kept: RFC 8414 2 makes it REQUIRED, LWS Authorization requires RFC 8414
    // metadata, and its example lists ["token"]. No authorization endpoint
    // exists; tokens come only from token exchange.
    response_types_supported: ["token"],
    token_endpoint_auth_methods_supported: ["none"],
    claims_supported: ["sub", "iss", "client_id", "aud", "exp", "iat", "jti"],
  };
}

export const getLwsConfiguration = httpAction(async (_ctx, request) => {
  try {
    return json(request, lwsConfiguration(lwsBaseUrl()), 200, { "Cache-Control": "public, max-age=300" });
  } catch (error) {
    console.error("[lwsHttp] configuration failed:", error);
    return problem(request, 500, "Internal error");
  }
});

/**
 * Protected resource metadata (RFC 9728) for `B/lws/…`, mounted at
 * `B/.well-known/oauth-protected-resource/lws/…`. `resource` is the exact
 * requested URI, not the storage (LWS Authorization).
 */
export function protectedResourceMetadata(requestUrl: string, base: string) {
  const path = new URL(requestUrl).pathname;
  if (!path.startsWith(`${PROTECTED_RESOURCE_METADATA_PATH}/lws/`)) return null;
  const resource = `${base}${path.slice(PROTECTED_RESOURCE_METADATA_PATH.length)}`;
  if (!parseStoragePath(resource, base)) return null;
  return { resource, authorization_servers: [base], bearer_methods_supported: ["header"] };
}

export const getProtectedResourceMetadata = httpAction(async (_ctx, request) => {
  try {
    const metadata = protectedResourceMetadata(request.url, lwsBaseUrl());
    if (!metadata) return problem(request, 404, "Not found");
    return json(request, metadata, 200, { "Cache-Control": "public, max-age=300" });
  } catch (error) {
    console.error("[lwsHttp] resource metadata failed:", error);
    return problem(request, 500, "Internal error");
  }
});
