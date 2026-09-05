import { expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  settingsReads: 0,
  retry: vi.fn(),
  recordSyncError: vi.fn(),
  service: {
    from(table: string) {
      if (table !== "org_settings") throw new Error(`unexpected table ${table}`);
      const builder: any = {
        select: () => builder,
        eq: () => builder,
        async maybeSingle() {
          mocks.settingsReads += 1;
          if (mocks.settingsReads === 1) return { data: null, error: { code: "DB_READ_FAILED" } };
          return { data: { timezone: "UTC", digest_hour_local: 8, last_digest_date: null }, error: null };
        },
      };
      return builder;
    },
  },
}));

vi.mock("../app/lib/env.server", () => ({
  getEnv: () => ({ SUPABASE_URL: "https://db.example", SUPABASE_ANON_KEY: "anon", SUPABASE_SERVICE_KEY: "service" }),
  getEmailEnvOrNull: () => ({
    RESEND_API_KEY: "key", APP_PUBLIC_BASE_URL: "https://app.example",
    UNSUBSCRIBE_SECRET: "unsubscribe", RESEND_WEBHOOK_SECRET: "webhook", RESEND_ALLOWED_FROM: "alerts@example.com",
  }),
  resendTransport: () => ({ apiKey: "key", allowedFrom: "alerts@example.com" }),
}));

vi.mock("../app/lib/page-all", () => ({
  PAGE_ALL_MAX_ROWS: 10_000,
  orderPage: (value: unknown) => value,
  pageAll: async () => ({ rows: [{ org_id: "org-a" }, { org_id: "org-b" }], truncated: false }),
}));

vi.mock("../app/lib/notifications.server", () => ({
  retryUnsentBrokenPromiseAlerts: mocks.retry,
  runDailyDigest: vi.fn(),
}));

vi.mock("../app/lib/sync-errors.server", () => ({
  recordSyncError: mocks.recordSyncError,
}));

vi.mock("../app/lib/tz", () => ({
  todayInTz: () => "2026-09-05",
  shouldSendDigestNow: () => false,
}));

vi.mock("../app/lib/supabase.server", () => ({
  createSupabaseServiceClient: () => mocks.service,
}));

import { runScheduledDigest } from "../app/lib/digest-cron.server";

test("digest counts a settings read failure and continues with later orgs", async () => {
  mocks.settingsReads = 0;
  mocks.retry.mockReset().mockResolvedValue(undefined);
  mocks.recordSyncError.mockReset().mockResolvedValue(undefined);
  vi.spyOn(console, "error").mockImplementation(() => {});
  const result = await runScheduledDigest({}, new Date("2026-09-05T12:00:00Z"));
  expect(result).toMatchObject({ orgs: 2, failures: 1, configured: true });
  expect(mocks.settingsReads).toBe(2);
  expect(mocks.retry).toHaveBeenCalledTimes(1);
  expect(mocks.recordSyncError).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
    orgId: "org-a", source: "cron", scope: "digest",
  }));
  vi.restoreAllMocks();
});
