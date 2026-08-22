export type AuthRateLimitEnv = {
  AUTH_RATE_LIMIT?: { limit: (p: { key: string }) => Promise<{ success: boolean }> };
  QBO_SANDBOX?: string;
  AUTH_RATE_LIMIT_WAF?: string;
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

/** true = reject this attempt. Never throw a raw Response (breaks PublicLayout). */
export async function authRateLimited(env: AuthRateLimitEnv, key: string): Promise<boolean> {
  if (env.AUTH_RATE_LIMIT) {
    const { success } = await env.AUTH_RATE_LIMIT.limit({ key });
    return !success;
  }
  // Production without a binding must not silently unlimited-login.
  // WAF substitute: set AUTH_RATE_LIMIT_WAF=true after runbook evidence.
  if (env.QBO_SANDBOX === "false" && env.AUTH_RATE_LIMIT_WAF !== "true") {
    console.error({ event: "auth_rate_limit_unbound" });
    return true;
  }
  return false; // local/dev
}
