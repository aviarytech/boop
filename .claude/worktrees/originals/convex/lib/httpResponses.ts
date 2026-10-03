/**
 * Shared HTTP response helpers for Convex HTTP actions.
 *
 * IMPORTANT: Browsers require CORS headers on the *actual* response, not just
 * the OPTIONS preflight. These helpers ensure all JSON/error responses include
 * the correct CORS headers for the requesting Origin.
 */
type HeaderMap = Record<string, string>;

/**
 * Compute CORS headers for a request.
 *
 * - If an Origin is present (browser requests), echo it back and allow credentials.
 * - If no Origin is present (non-browser), omit credential headers.
 * - For preflight, echo requested headers when provided.
 */
export function getCorsHeaders(request: Request): HeaderMap {
  const origin = request.headers.get("Origin");
  const requestedHeaders = request.headers.get("Access-Control-Request-Headers");

  const headers: HeaderMap = {
    "Access-Control-Allow-Origin": origin ?? "*",
    "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
    "Access-Control-Allow-Headers":
      requestedHeaders ?? "Content-Type, Authorization, X-API-Key",
  };

  // Only allow credentials when we can echo a concrete Origin.
  if (origin) {
    headers["Access-Control-Allow-Credentials"] = "true";
    // Prevent caches from reusing a response across different origins.
    headers["Vary"] = "Origin";
  }

  return headers;
}

export function jsonResponse(
  request: Request,
  data: unknown,
  status = 200,
  extraHeaders: HeaderMap = {}
): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      ...getCorsHeaders(request),
      ...extraHeaders,
    },
  });
}

export function errorResponse(
  request: Request,
  message: string,
  status = 400,
  extraHeaders: HeaderMap = {}
): Response {
  return jsonResponse(request, { error: message }, status, extraHeaders);
}

/**
 * Turn a thrown mutation/query error into a client response.
 *
 * Convex wraps handler throws with a stack trace naming internal source files,
 * so never echo the raw message to an API client: authorization failures become
 * a clean 403, everything else a generic 500 (details go to the server log).
 */
export function handlerErrorResponse(
  request: Request,
  error: unknown,
  fallbackMessage: string
): Response {
  const message = error instanceof Error ? error.message : "";
  if (/not authorized/i.test(message)) {
    return errorResponse(request, "Not authorized", 403);
  }
  return errorResponse(request, fallbackMessage, 500);
}

export function emptyResponse(
  request: Request,
  status = 204,
  extraHeaders: HeaderMap = {}
): Response {
  return new Response(null, {
    status,
    headers: {
      ...getCorsHeaders(request),
      ...extraHeaders,
    },
  });
}
