import { afterEach, describe, expect, it, vi } from "vitest";
import { withUnhandledLogging } from "../app/lib/worker-observability";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("withUnhandledLogging", () => {
  it("returns the handler result when it succeeds", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(
      withUnhandledLogging("fetch", { url: "https://app.example/healthz" }, async () => 7),
    ).resolves.toBe(7);
    expect(error).not.toHaveBeenCalled();
  });

  it("logs url context then rethrows fetch failures", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const boom = new Error("boom");
    await expect(
      withUnhandledLogging("fetch", { url: "https://app.example/healthz" }, async () => {
        throw boom;
      }),
    ).rejects.toBe(boom);
    expect(error).toHaveBeenCalledTimes(1);
    expect(error.mock.calls[0][0]).toMatchObject({
      event: "unhandled_worker_error",
      handler: "fetch",
      url: "https://app.example/healthz",
      message: "boom",
    });
  });

  it("logs cron context then rethrows scheduled failures", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(
      withUnhandledLogging("scheduled", { cron: "*/30 * * * *" }, async () => {
        throw "cdc down";
      }),
    ).rejects.toBe("cdc down");
    expect(error.mock.calls[0][0]).toMatchObject({
      event: "unhandled_worker_error",
      handler: "scheduled",
      cron: "*/30 * * * *",
      message: "cdc down",
    });
  });

  it("awaits onError then still rethrows the original error", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const onError = vi.fn(async () => {});
    const boom = new Error("cdc down");
    await expect(
      withUnhandledLogging("scheduled", { cron: "*/30 * * * *" }, async () => {
        throw boom;
      }, { onError }),
    ).rejects.toBe(boom);
    expect(onError).toHaveBeenCalledWith(boom);
    expect(error).toHaveBeenCalledTimes(1);
  });

  it("swallows onError failures so the original error remains", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const boom = new Error("cdc down");
    await expect(
      withUnhandledLogging("scheduled", { cron: "*/30 * * * *" }, async () => {
        throw boom;
      }, { onError: async () => { throw new Error("pager down"); } }),
    ).rejects.toBe(boom);
  });
});
