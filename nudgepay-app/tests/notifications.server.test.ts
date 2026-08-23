import { describe, it, expect, vi, beforeEach } from "vitest";
import { sendBrokenPromiseAlerts, runDailyDigest } from "../app/lib/notifications.server";

vi.mock("../app/lib/orgs.server", () => ({
  listOrgMembers: vi.fn(async () => [
    { userId: "u1", email: "owner@example.com", label: "Owner", role: "owner" },
  ]),
}));

function mockFetch(status: number, body: unknown) {
  return vi.fn(async () => new Response(JSON.stringify(body), { status }));
}

function qb(result: Record<string, unknown>) {
  const q: any = {
    select: vi.fn(() => q),
    eq: vi.fn(() => q),
    neq: vi.fn(() => q),
    lte: vi.fn(() => q),
    gt: vi.fn(() => q),
    lt: vi.fn(() => q),
    in: vi.fn(() => q),
    maybeSingle: vi.fn(async () => result),
    insert: vi.fn(async () => ({ error: null })),
    then(onFulfilled: any, onRejected: any) {
      return Promise.resolve(result).then(onFulfilled, onRejected);
    },
  };
  return q;
}

function serviceForAlerts(opts: {
  fromAddress: string | null;
  fromName?: string;
  customerId?: string;
  ownerId?: string | null;
  logCount?: number;
}) {
  const emailConfig = qb({
    data: opts.fromAddress
      ? { from_address: opts.fromAddress, from_name: opts.fromName ?? "" }
      : null,
    error: null,
  });
  return {
    emailConfig,
    service: {
      from: vi.fn((table: string) => {
        switch (table) {
          case "email_config":
            return emailConfig;
          case "user_notification_prefs":
            return qb({ data: [], error: null });
          case "collection_cases":
            return qb({ data: { customer_id: opts.customerId ?? "cust-1" }, error: null });
          case "customers":
            return qb({
              data: { name: "Acme Corp", owner: opts.ownerId === undefined ? "u1" : opts.ownerId },
              error: null,
            });
          case "notification_log":
            return qb({ data: null, count: opts.logCount ?? 0, error: null });
          default:
            throw new Error(`unexpected table ${table}`);
        }
      }),
    } as any,
  };
}

function serviceForDigest(opts: { fromAddress: string | null; fromName?: string; cases?: unknown[] }) {
  const emailConfig = qb({
    data: opts.fromAddress
      ? { from_address: opts.fromAddress, from_name: opts.fromName ?? "NudgePay" }
      : null,
    error: null,
  });
  return {
    emailConfig,
    service: {
      from: vi.fn((table: string) => {
        switch (table) {
          case "email_config":
            return emailConfig;
          case "collection_cases":
            return qb({
              data: opts.cases ?? [{
                id: "case-1",
                customer_id: "cust-1",
                status: "working",
                next_action_type: "follow_up",
                next_action_at: "2026-07-02",
                exception_reason: null,
              }],
              error: null,
            });
          case "customers":
            return qb({
              data: [{ id: "cust-1", name: "Acme Corp", owner: "u1" }],
              error: null,
            });
          case "invoices":
            return qb({
              data: [{ customer_id: "cust-1", balance: 500, due_date: "2026-06-01" }],
              error: null,
            });
          case "user_notification_prefs":
            return qb({ data: [], error: null });
          case "memberships":
            return qb({ data: [{ user_id: "u1", role: "owner" }], error: null });
          case "notification_log":
            return qb({ data: null, count: 0, error: null });
          default:
            throw new Error(`unexpected table ${table}`);
        }
      }),
    } as any,
  };
}

const broken = [{
  promiseId: "p1",
  caseId: "case-1",
  promisedAmount: 1500,
  promisedDate: "2026-07-01",
}];

describe("sendBrokenPromiseAlerts operator gate (NP-AUD-2026-049)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("sends when from_address exists even if email_enabled is unset/false", async () => {
    const fetchFn = mockFetch(200, { id: "re_1" });
    const { service, emailConfig } = serviceForAlerts({ fromAddress: "alerts@x.com", fromName: "Ops" });
    await sendBrokenPromiseAlerts(
      { fetchFn: fetchFn as any, service, email: { apiKey: "key", allowedFrom: "alerts@x.com" }, appUrl: "https://app.nudgepay.test" },
      "org-1",
      broken,
      "2026-07-02",
    );
    expect(emailConfig.select.mock.calls[0][0]).not.toMatch(/email_enabled/);
    expect(fetchFn).toHaveBeenCalledTimes(1);
    const payload = JSON.parse((fetchFn.mock.calls[0][1] as any).body);
    expect(payload.from).toBe("Ops <alerts@x.com>");
    expect(payload.to).toBe("owner@example.com");
    expect(payload).not.toHaveProperty("reply_to");
  });

  it("skips when from_address is missing", async () => {
    const fetchFn = mockFetch(200, { id: "re_1" });
    const { service } = serviceForAlerts({ fromAddress: null });
    await sendBrokenPromiseAlerts(
      { fetchFn: fetchFn as any, service, email: { apiKey: "key", allowedFrom: "alerts@x.com" }, appUrl: "https://app.nudgepay.test" },
      "org-1",
      broken,
      "2026-07-02",
    );
    expect(fetchFn).not.toHaveBeenCalled();
  });
});

describe("runDailyDigest operator gate (NP-AUD-2026-049)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("sends when from_address exists without consulting email_enabled", async () => {
    const fetchFn = mockFetch(200, { id: "re_d" });
    const { service, emailConfig } = serviceForDigest({ fromAddress: "alerts@x.com" });
    await runDailyDigest(
      { fetchFn: fetchFn as any, service, email: { apiKey: "key", allowedFrom: "alerts@x.com" }, appUrl: "https://app.nudgepay.test" },
      "org-1",
      "2026-07-02",
    );
    expect(emailConfig.select.mock.calls[0][0]).not.toMatch(/email_enabled/);
    expect(fetchFn).toHaveBeenCalledTimes(1);
    const payload = JSON.parse((fetchFn.mock.calls[0][1] as any).body);
    expect(payload.to).toBe("owner@example.com");
    expect(payload.subject).toMatch(/Follow-ups due today/);
  });

  it("skips when from_address is missing", async () => {
    const fetchFn = mockFetch(200, { id: "re_d" });
    const { service } = serviceForDigest({ fromAddress: null });
    await runDailyDigest(
      { fetchFn: fetchFn as any, service, email: { apiKey: "key", allowedFrom: "alerts@x.com" }, appUrl: "https://app.nudgepay.test" },
      "org-1",
      "2026-07-02",
    );
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("throws when the from address is off the allowlist so the cron can release the claim", async () => {
    const fetchFn = mockFetch(200, { id: "re_d" });
    const { service } = serviceForDigest({ fromAddress: "alerts@x.com" });
    await expect(runDailyDigest(
      { fetchFn: fetchFn as any, service, email: { apiKey: "key", allowedFrom: "other@x.com" }, appUrl: "https://app.nudgepay.test" },
      "org-1",
      "2026-07-02",
    )).rejects.toThrow(/RESEND_ALLOWED_FROM/);
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("does not throw on an off-allowlist sender when there is nothing to send", async () => {
    const fetchFn = mockFetch(200, { id: "re_d" });
    const { service } = serviceForDigest({ fromAddress: "alerts@x.com", cases: [] });
    await expect(runDailyDigest(
      { fetchFn: fetchFn as any, service, email: { apiKey: "key", allowedFrom: "other@x.com" }, appUrl: "https://app.nudgepay.test" },
      "org-1",
      "2026-07-02",
    )).resolves.toBeUndefined();
    expect(fetchFn).not.toHaveBeenCalled();
  });
});
