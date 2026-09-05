import { expect, test } from "vitest";
import { makeUserClient, serviceClient } from "./helpers";

test("system job health is service-only and event timestamps remain monotonic", async () => {
  const service = serviceClient();
  const viewer = await makeUserClient(`system-health-${crypto.randomUUID()}@example.com`);
  const job = "retention";
  const t1 = "2026-09-05T10:00:00.000Z";
  const t2 = "2026-09-05T11:00:00.000Z";
  const t3 = "2026-09-05T11:01:00.000Z";
  const t4 = "2026-09-05T11:02:00.000Z";
  const t5 = "2026-09-05T11:03:00.000Z";
  const destinationHash = "a".repeat(64);

  try {
    const forbiddenTable = await viewer.client.from("system_job_health").select("job");
    expect(forbiddenTable.error).not.toBeNull();
    const forbiddenRpc = await viewer.client.rpc("record_system_job_event", {
      p_job: job, p_event: "started", p_at: t1,
    });
    expect(forbiddenRpc.error).not.toBeNull();

    const events = [
      { p_job: job, p_event: "started", p_at: t2 },
      { p_job: job, p_event: "started", p_at: t1 },
      { p_job: job, p_event: "succeeded", p_at: t3 },
      { p_job: job, p_event: "failed", p_at: t1 },
      { p_job: job, p_event: "alert_failed", p_at: t4 },
      { p_job: job, p_event: "alert_succeeded", p_at: t5, p_alert_destination_hash: destinationHash },
      { p_job: job, p_event: "alert_failed", p_at: t3 },
    ];
    for (const args of events) {
      const result = await service.rpc("record_system_job_event", args);
      expect(result.error).toBeNull();
    }

    const { data, error } = await service.from("system_job_health")
      .select("last_started_at, last_succeeded_at, last_failed_at, last_alert_attempted_at, last_alert_succeeded_at, last_alert_failed_at, last_alert_succeeded_destination_hash")
      .eq("job", job)
      .single();
    expect(error).toBeNull();
    expect(Date.parse(data!.last_started_at)).toBe(Date.parse(t2));
    expect(Date.parse(data!.last_succeeded_at)).toBe(Date.parse(t3));
    expect(Date.parse(data!.last_failed_at)).toBe(Date.parse(t1));
    expect(Date.parse(data!.last_alert_attempted_at)).toBe(Date.parse(t5));
    expect(Date.parse(data!.last_alert_succeeded_at)).toBe(Date.parse(t5));
    expect(Date.parse(data!.last_alert_failed_at)).toBe(Date.parse(t4));
    expect(data!.last_alert_succeeded_destination_hash).toBe(destinationHash);

    const invalid = await service.rpc("record_system_job_event", {
      p_job: "unknown", p_event: "started", p_at: t5,
    });
    expect(invalid.error).not.toBeNull();
  } finally {
    await service.from("system_job_health").delete().eq("job", job);
  }
}, 30_000);
