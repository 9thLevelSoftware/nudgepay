// Shared display-copy helpers for enum-ish values that otherwise leak raw
// snake_case / provider taxonomy into the UI. Pure functions, no I/O, no
// node:* — safe in both the client bundle and the server.

// ─── Next action (case.nextActionType) ─────────────────────────────────────

// Single source of truth — LogContactDrawer imports NEXT_ACTION_LABEL directly
// so the drawer's dropdown and the detail-panel display never drift apart.
export const NEXT_ACTION_LABEL: Record<string, string> = {
  contact: "Contact",
  follow_up: "Follow up",
  promise: "Promise to pay",
  waiting: "Waiting on customer",
  exception: "Needs attention",
};

function humanizeSnakeCase(v: string): string {
  return v
    .split(/[_-]+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

export function nextActionLabel(v: string | null): string {
  if (!v) return "—";
  return NEXT_ACTION_LABEL[v] ?? humanizeSnakeCase(v);
}

// ─── Email delivery failures (email_messages.error_code) ───────────────────

// Resend's webhook taxonomy (see app/lib/email-events.ts) surfaces bounce
// sub-types ("hard"/"permanent" vs "soft"/"transient") plus a generic
// "bounce" fallback and "complaint". We key on both the canonical names this
// map documents and the raw values Resend actually sends, so real data always
// resolves to human copy instead of falling through to the humanized fallback.
export const EMAIL_FAILURE_LABEL: Record<string, string> = {
  hard_bounce: "Email address bounced — delivery permanently failed",
  hard: "Email address bounced — delivery permanently failed",
  permanent: "Email address bounced — delivery permanently failed",
  soft_bounce: "Delivery temporarily failed — the mailbox may be full or unavailable",
  soft: "Delivery temporarily failed — the mailbox may be full or unavailable",
  transient: "Delivery temporarily failed — the mailbox may be full or unavailable",
  bounce: "Email address bounced — delivery failed",
  complaint: "Recipient marked this email as spam",
  unknown: "Delivery failed",
};

export function emailFailureLabel(code: string | null): string {
  if (!code) return "";
  return EMAIL_FAILURE_LABEL[code.toLowerCase()] ?? humanizeSnakeCase(code);
}

// Hard-bounce detection used to gate the "last email bounced" composer
// warning (F-022). Treats both the canonical key and Resend's raw bounce
// sub-types as "hard" so the warning fires on real webhook data.
const HARD_BOUNCE_CODES = new Set(["hard_bounce", "hard", "permanent"]);

export function isHardBounce(code: string | null): boolean {
  if (!code) return false;
  return HARD_BOUNCE_CODES.has(code.toLowerCase());
}
