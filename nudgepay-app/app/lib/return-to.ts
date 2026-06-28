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

// Append an sms-result code onto an already-validated return path.
export function withSms(returnTo: string, code: string): string {
  const sep = returnTo.includes("?") ? "&" : "?";
  return `${returnTo}${sep}sms=${code}`;
}

// Append an email-result code onto an already-validated return path.
export function withEmail(returnTo: string, code: string): string {
  const sep = returnTo.includes("?") ? "&" : "?";
  return `${returnTo}${sep}email=${code}`;
}
