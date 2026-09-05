import { beforeEach, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({ recordAlert: vi.fn() }));

vi.mock("../app/lib/env.server", () => ({
  getEnv: () => ({ SUPABASE_URL: "https://db.example", SUPABASE_ANON_KEY: "anon", SUPABASE_SERVICE_KEY: "service" }),
}));

vi.mock("../app/lib/system-health.server", () => ({
  recordOperatorAlertResult: mocks.recordAlert,
}));

function fakeService() {
  return {
    async rpc(name: string) {
      if (name === "list_provider_monitor_candidates") {
        return { data: [{ channel: "sms", attempt_id: "00000000-0000-4000-8000-000000000001", observed_at: "2026-09-05T11:00:00Z" }], error: null };
      }
      if (name === "claim_provider_monitor_alert") return { data: true, error: null };
      if (name === "complete_provider_monitor_alert") return { data: true, error: null };
      throw new Error(`unexpected RPC ${name}`);
    },
    from() {
      const builder: any = { delete: () => builder, lt: async () => ({ error: null }) };
      return builder;
    },
  };
}

vi.mock("../app/lib/supabase.server", () => ({
  createSupabaseServiceClient: () => fakeService(),
}));

import { runScheduledProviderMonitor } from "../app/lib/provider-monitor.server";

beforeEach(() => {
  mocks.recordAlert.mockReset().mockResolvedValue(undefined);
});

test("scheduled provider monitor rejects and records a failed pager post", async () => {
  const fetchFn = vi.fn(async () => new Response("down", { status: 503 }));
  await expect(runScheduledProviderMonitor(
    { OPERATOR_ALERT_WEBHOOK: "https://pager.example/hook" },
    fetchFn,
    new Date("2026-09-05T12:00:00Z"),
  )).rejects.toThrow("operator alert delivery failed");
  expect(mocks.recordAlert).toHaveBeenCalledWith(expect.anything(), "provider_monitor", false);
});

test("a confirmed provider alert records pager recovery", async () => {
  const fetchFn = vi.fn(async () => new Response("ok", { status: 200 }));
  await expect(runScheduledProviderMonitor(
    { OPERATOR_ALERT_WEBHOOK: "https://pager.example/hook" },
    fetchFn,
    new Date("2026-09-05T12:00:00Z"),
  )).resolves.toMatchObject({ sent: 1, postFailed: 0 });
  expect(mocks.recordAlert).toHaveBeenCalledWith(expect.anything(), "provider_monitor", true);
});
