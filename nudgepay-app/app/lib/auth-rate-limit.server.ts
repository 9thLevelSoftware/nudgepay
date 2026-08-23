export type AuthRateLimitEnv = {
  AUTH_RATE_LIMIT?: { limit: (p: { key: string }) => Promise<{ success: boolean }> };
  AUTH_RATE_LIMIT_WAF?: string;
  AUTH_RATE_LIMIT_MEMORY?: string;
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

function pruneMemoryHits(now: number): void {
  const cutoff = now - MEMORY_WINDOW_MS;
  for (const [k, times] of memoryHits) {
    const keep = times.filter((t) => t > cutoff);
    if (keep.length === 0) memoryHits.delete(k);
    else memoryHits.set(k, keep);
  }
  while (memoryHits.size >= MEMORY_MAX_KEYS) {
    const first = memoryHits.keys().next().value;
    if (first === undefined) break;
    memoryHits.delete(first);
  }
}

/** In-process limiter for Node/Render (no Cloudflare ratelimit binding). */
export function memoryAuthRateLimited(key: string, now = Date.now()): boolean {
  const cutoff = now - MEMORY_WINDOW_MS;
  const prev = (memoryHits.get(key) ?? []).filter((t) => t > cutoff);
  if (prev.length >= MEMORY_LIMIT) {
    memoryHits.set(key, prev);
    return true;
  }
  // Evict only when inserting a previously unseen key. Updating an existing
  // Map entry does not refresh insertion order, so pruning on a known key
  // could delete the bucket currently being evaluated.
  if (!memoryHits.has(key) && memoryHits.size >= MEMORY_MAX_KEYS) {
    pruneMemoryHits(now);
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
