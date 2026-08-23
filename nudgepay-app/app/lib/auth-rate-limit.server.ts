export type AuthRateLimitEnv = {
  AUTH_RATE_LIMIT?: { limit: (p: { key: string }) => Promise<{ success: boolean }> };
  AUTH_RATE_LIMIT_WAF?: string;
  AUTH_RATE_LIMIT_MEMORY?: string;
  BUILD_TARGET?: string;
  NODE_ENV?: string;
};

/** CF-Connecting-IP, else first X-Forwarded-For hop. */
export function authRateLimitKey(request: Request): string {
  const cf = request.headers.get("CF-Connecting-IP")?.trim();
  if (cf) return cf;
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim();
    if (first) return first;
  }
  return "unknown";
}

const MEMORY_LIMIT = 20;
const MEMORY_WINDOW_MS = 60_000;
const memoryHits = new Map<string, number[]>();

export function resetMemoryAuthRateLimit(): void {
  memoryHits.clear();
}

/** In-process limiter for Node/Render (no Cloudflare ratelimit binding). */
export function memoryAuthRateLimited(key: string, now = Date.now()): boolean {
  const cutoff = now - MEMORY_WINDOW_MS;
  const prev = (memoryHits.get(key) ?? []).filter((t) => t > cutoff);
  if (prev.length >= MEMORY_LIMIT) {
    memoryHits.set(key, prev);
    return true;
  }
  prev.push(now);
  memoryHits.set(key, prev);
  return false;
}

function useMemoryLimiter(env: AuthRateLimitEnv): boolean {
  return env.AUTH_RATE_LIMIT_MEMORY === "true"
    || env.BUILD_TARGET === "node"
    || env.NODE_ENV === "production";
}

/** true = reject this attempt. Never throw a raw Response (breaks PublicLayout). */
export async function authRateLimited(env: AuthRateLimitEnv, key: string): Promise<boolean> {
  if (env.AUTH_RATE_LIMIT) {
    const { success } = await env.AUTH_RATE_LIMIT.limit({ key });
    return !success;
  }
  // WAF substitute: set AUTH_RATE_LIMIT_WAF=true after runbook evidence.
  if (env.AUTH_RATE_LIMIT_WAF === "true") return false;
  // Node/Render has no CF binding. Do not use QBO_SANDBOX as a production probe
  // (Render sets it false for the Intuit API URL and would 429 every login).
  if (useMemoryLimiter(env)) return memoryAuthRateLimited(key);
  return false; // local/dev
}
