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

/** Minute-bucket key so a double-click within 60s is treated as one send. */
export function sendIdempotencyKey(kind: string, parts: string[], now = new Date()): string {
  const bucket = Math.floor(now.getTime() / 60_000);
  return `${kind}:${parts.join(":")}:${bucket}`.slice(0, 128);
}

export function hourAgoIso(now = new Date()): string {
  return new Date(now.getTime() - 60 * 60_000).toISOString();
}

export function dayAgoIso(now = new Date()): string {
  return new Date(now.getTime() - 24 * 60 * 60_000).toISOString();
}
