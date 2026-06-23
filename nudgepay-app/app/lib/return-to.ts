// Pure guard for redirect targets. We only accept an app-relative path (must
// start with a single "/", not "//") to avoid open redirects. A query-only
// string ("?x=1") is rejected on purpose — callers must pass a full path
// ("/dashboard?x=1") so the redirect lands on a real route.
export function safeReturnTo(
  value: FormDataEntryValue | null,
  fallback = "/dashboard",
): string {
  if (typeof value === "string" && value.startsWith("/") && !value.startsWith("//")) {
    return value;
  }
  return fallback;
}
