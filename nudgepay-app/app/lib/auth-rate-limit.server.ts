export type AuthRateLimitEnv = {
  AUTH_RATE_LIMIT?: { limit: (p: { key: string }) => Promise<{ success: boolean }> };
  AUTH_RATE_LIMIT_WAF?: string;
  AUTH_RATE_LIMIT_MEMORY?: string;
  AUTH_RATE_LIMIT_REQUIRED?: string;
  BUILD_TARGET?: string;
  NODE_ENV?: string;
};

/**
 * Cloudflare: CF-Connecting-IP (authenticated by the edge).
 * Node/Render: last X-Forwarded-For hop (the one the trusted proxy appended).
 * Never trust CF-Connecting-IP on Node — Render does not set or authenticate it.
 */
export function authRateLimitKey(request: Request, env: AuthRateLimitEnv = {}): string {
  const node = env.BUILD_TARGET === "node";
  if (!node) {
    const cf = request.headers.get("CF-Connecting-IP")?.trim();
    if (cf) return cf;
  }
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) {
    const hops = forwarded.split(",").map((s) => s.trim()).filter(Boolean);
    if (hops.length) return node ? hops[hops.length - 1]! : hops[0]!;
  }
  return "unknown";
}

const MEMORY_LIMIT = 20;
const MEMORY_WINDOW_MS = 60_000;
const MEMORY_MAX_KEYS = 10_000;
const memoryHits = new Map<string, number[]>();

export function resetMemoryAuthRateLimit(): void {
  memoryHits.clear();
}

function evictOldest(): void {
  const first = memoryHits.keys().next().value;
  if (first !== undefined) memoryHits.delete(first);
}

/** Reinsert so Map iteration order is LRU. `set` on an existing key does not. */
function touch(key: string, timestamps: number[]): void {
  memoryHits.delete(key);
  memoryHits.set(key, timestamps);
}

/** In-process limiter for Node/Render (no Cloudflare ratelimit binding). */
export function memoryAuthRateLimited(key: string, now = Date.now()): boolean {
  const cutoff = now - MEMORY_WINDOW_MS;
  const prev = (memoryHits.get(key) ?? []).filter((t) => t > cutoff);
  if (prev.length >= MEMORY_LIMIT) {
    touch(key, prev);
    return true;
  }
  // Evict only when inserting a previously unseen key, and only the oldest
  // Map entry (O(1)). Do not rewrite every bucket on the hot path.
  if (!memoryHits.has(key) && memoryHits.size >= MEMORY_MAX_KEYS) {
    evictOldest();
  }
  prev.push(now);
  touch(key, prev);
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
  // Cloudflare production: wrangler [env.production.vars] sets this so a
  // missing AUTH_RATE_LIMIT binding cannot silently unlimited-allow.
  if (env.AUTH_RATE_LIMIT_REQUIRED === "true") return true;
  return false; // local/dev
}
