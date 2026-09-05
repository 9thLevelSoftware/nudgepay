import { beforeEach, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({ load: vi.fn(), createService: vi.fn() }));

vi.mock("../app/lib/env.server", () => ({
  getEnv: () => ({ SUPABASE_URL: "https://db.example", SUPABASE_ANON_KEY: "anon", SUPABASE_SERVICE_KEY: "service" }),
}));

vi.mock("../app/lib/supabase.server", () => ({
  createSupabaseServiceClient: mocks.createService,
}));

vi.mock("../app/lib/system-health.server", () => ({
  loadSystemMonitorBody: mocks.load,
}));

import { loader } from "../app/routes/monitorz";

const token = "test-monitor-token-".repeat(3);
const checks = {
  database: "ok", provider_monitor: "ok", cdc: "ok", digest: "ok", retention: "ok",
  cdc_checkpoint: "ok", qbo_sync: "ok", operator_alert: "ok",
};

function request() {
  return {
    request: new Request("https://app.example/monitorz", { headers: { Authorization: `Bearer ${token}` } }),
    context: { cloudflare: { env: { MONITOR_TOKEN: token } } },
    params: {},
  } as never;
}

beforeEach(() => {
  mocks.load.mockReset();
  mocks.createService.mockReset().mockReturnValue({});
});

test("authorized monitor maps a healthy body to 200", async () => {
  mocks.load.mockResolvedValue({ ok: true, checks });
  const response = await loader(request());
  expect(response.status).toBe(200);
  expect(response.headers.get("Cache-Control")).toBe("no-store");
  expect(await response.json()).toEqual({ ok: true, checks });
  expect(mocks.createService).toHaveBeenCalledOnce();
});

test("authorized monitor maps an unhealthy body to 503", async () => {
  mocks.load.mockResolvedValue({ ok: false, checks: { ...checks, cdc: "fail" } });
  const response = await loader(request());
  expect(response.status).toBe(503);
  expect(await response.json()).toMatchObject({ ok: false, checks: { cdc: "fail" } });
});

test("authorized monitor maps query failures to a content-free 503", async () => {
  mocks.load.mockRejectedValue(new Error("customer@example.com token=secret"));
  const response = await loader(request());
  expect(response.status).toBe(503);
  const body = await response.json();
  expect(body.ok).toBe(false);
  expect(JSON.stringify(body)).not.toMatch(/customer@example\.com|token=secret/);
});
