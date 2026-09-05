// Pure send-budget helpers. No I/O — routes/server modules count rows, then
// call these to decide whether a send is allowed.

export const SMS_ORG_HOUR_CAP = 120;
export const SMS_CUSTOMER_DAY_CAP = 8;
export const EMAIL_ORG_HOUR_CAP = 120;
export const EMAIL_CUSTOMER_DAY_CAP = 8;
export const TEST_HOUR_CAP = 5;

export type BudgetVerdict =
  | { ok: true }
  | { ok: false; reason: "org_cap" | "customer_cap" | "test_cap" };

export function evaluateSendBudget(args: {
  orgCount: number;
  customerCount: number;
  orgCap: number;
  customerCap: number;
}): BudgetVerdict {
  if (args.orgCount >= args.orgCap) return { ok: false, reason: "org_cap" };
  if (args.customerCount >= args.customerCap) return { ok: false, reason: "customer_cap" };
  return { ok: true };
}

export function evaluateTestBudget(count: number, cap = TEST_HOUR_CAP): BudgetVerdict {
  if (count >= cap) return { ok: false, reason: "test_cap" };
  return { ok: true };
}

/** FNV-1a 64-bit so long bodies fit the 128-char provider key without a time bucket. */
function fnv1a64Hex(input: string): string {
  let h = 0xcbf29ce484222325n;
  for (let i = 0; i < input.length; i++) {
    h ^= BigInt(input.charCodeAt(i));
    h = (h * 0x100000001b3n) & 0xffffffffffffffffn;
  }
  return h.toString(16).padStart(16, "0");
}

/** Stable key `kind:org:invoice:hash(body)` — no minute bucket. */
export function sendIdempotencyKey(kind: string, parts: string[]): string {
  const org = parts[0] ?? "";
  const invoice = parts[1] ?? "";
  const bodyHash = fnv1a64Hex(parts.slice(2).join("\n"));
  return `${kind}:${org}:${invoice}:${bodyHash}`.slice(0, 128);
}

export function sendAttemptIdentity(
  kind: string,
  parts: string[],
  submissionId: string,
): { fingerprint: string; dedupeKey: string } {
  const fingerprint = sendIdempotencyKey(kind, parts);
  return {
    fingerprint,
    // Provider idempotency headers are deliberately short even when the
    // route accepts the maximum 128-character submission identity.
    dedupeKey: `${kind}:${fnv1a64Hex(`${parts[0] ?? ""}\n${submissionId}`)}`,
  };
}

/** Rollback compatibility for internal callers that predate submission IDs. */
export function legacySendAttemptIdentity(
  kind: string,
  parts: string[],
  now: Date,
): { fingerprint: string; dedupeKey: string } {
  const fingerprint = sendIdempotencyKey(kind, parts);
  return {
    fingerprint,
    dedupeKey: `${fingerprint.slice(0, 117)}:${now.toISOString().slice(0, 10)}`,
  };
}

export function hourAgoIso(now = new Date()): string {
  return new Date(now.getTime() - 60 * 60_000).toISOString();
}

export function dayAgoIso(now = new Date()): string {
  return new Date(now.getTime() - 24 * 60 * 60_000).toISOString();
}
