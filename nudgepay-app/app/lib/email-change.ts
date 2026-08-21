// Pure email-change validation. No I/O — the route calls GoTrue updateUser
// only after this helper accepts a different, well-formed address.

// Conservative RFC-5322-lite: non-empty local + "@" + dotted domain.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export type EmailChangeDecision =
  | { ok: true; noop: true }
  | { ok: true; noop: false; email: string }
  | { ok: false; error: "email" };

function normalizeEmail(value: unknown): string | null {
  if (typeof value !== "string") return null;
  return value.trim().toLowerCase();
}

export function emailChangeDecision(
  newEmail: unknown,
  currentEmail: string,
): EmailChangeDecision {
  const email = normalizeEmail(newEmail);
  if (email === null || !email || !EMAIL_RE.test(email)) {
    return { ok: false, error: "email" };
  }
  const current = normalizeEmail(currentEmail) ?? "";
  if (email === current) return { ok: true, noop: true };
  return { ok: true, noop: false, email };
}
