const MESSAGE = "Cross-origin requests are not allowed.";

function forbidden(): Response {
  return Response.json(
    { error: { code: "forbidden_origin", message: MESSAGE } },
    { status: 403 },
  );
}

/**
 * Reject state-changing requests sent from another origin.
 *
 * A missing Origin header is allowed: non-browser clients (curl, native
 * fetch, the test suite) do not send one, and the app already binds to
 * 127.0.0.1. A present Origin must match the request URL's host (host +
 * port) exactly; unparseable values such as the literal `null` are rejected.
 */
export function crossOriginRejection(request: Request): Response | null {
  const origin = request.headers.get("Origin");
  if (origin === null) return null;

  let originHost: string;
  try {
    originHost = new URL(origin).host;
  } catch {
    return forbidden();
  }

  let requestHost: string;
  try {
    requestHost = new URL(request.url).host;
  } catch {
    return forbidden();
  }

  return originHost === requestHost ? null : forbidden();
}
