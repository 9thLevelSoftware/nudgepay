const UNSAFE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

function originOf(value: string | null): string | null {
  if (!value) return null;
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}

export function isUnsafeMethod(method: string): boolean {
  return UNSAFE_METHODS.has(method.toUpperCase());
}

export function hasSameOriginProof(request: Request): boolean {
  if (!isUnsafeMethod(request.method)) return true;
  const expected = new URL(request.url).origin;
  const origin = originOf(request.headers.get("Origin"));
  if (origin) return origin === expected;
  const referer = originOf(request.headers.get("Referer"));
  return referer === expected;
}

export function requireSameOrigin(request: Request, headers?: Headers): void {
  if (hasSameOriginProof(request)) return;
  throw new Response("invalid request origin", { status: 403, headers });
}
