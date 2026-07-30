/**
 * Shared HTTP utilities for Vernal API Worker.
 */

/** CORS headers — allow Vernal web app origin only */
export function corsHeaders(request: Request): HeadersInit {
  const origin = request.headers.get('Origin') ?? '';
  const allowed = /^https:\/\/(sow-now\.uk|[a-z0-9-]+\.sow-now\.uk|[a-z0-9-]+\.pages\.dev)$/.test(origin)
    ? origin
    : 'https://sow-now.uk';

  return {
    'Access-Control-Allow-Origin': allowed,
    'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Max-Age': '86400',
  };
}

/** Standard JSON response with CORS headers */
export function jsonResponse(
  body: unknown,
  status = 200,
  request?: Request,
): Response {
  const headers: HeadersInit = {
    'Content-Type': 'application/json',
    ...(request ? corsHeaders(request) : {}),
  };
  return new Response(JSON.stringify(body), { status, headers });
}

/**
 * Generic error response.
 * Returns a safe, generic message to the client — never stack traces or
 * internal details.
 */
export function errorResponse(status: number, message: string): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
