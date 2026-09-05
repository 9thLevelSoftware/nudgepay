import { expect, test } from "vitest";
import { loadPersonalDataExport } from "../app/lib/personal-data-export.server";

type LogRow = {
  id: string;
  created_at: string;
  method: string;
  outcome: string | null;
};

function personalExportClient(logs: LogRow[], failFrom: number | null = null) {
  return {
    from(table: string) {
      if (table === "memberships") {
        let orderCalls = 0;
        const query = {
          select() { return query; },
          eq() { return query; },
          order() {
            orderCalls += 1;
            return orderCalls === 2
              ? Promise.resolve({ data: [], error: null })
              : query;
          },
        };
        return query;
      }
      if (table === "contact_logs") {
        const query = {
          select() { return query; },
          eq() { return query; },
          order() { return query; },
          async limit() {
            return { data: logs.slice(0, 1_000), error: null };
          },
          async range(from: number, to: number) {
            if (failFrom !== null && from >= failFrom) {
              return { data: null, count: logs.length, error: { message: "second page failed" } };
            }
            return { data: logs.slice(from, to + 1), count: logs.length, error: null };
          },
        };
        return query;
      }
      throw new Error(`unexpected table: ${table}`);
    },
  } as any;
}

function exportUser() {
  return {
    id: "user-1",
    email: "person@example.com",
    created_at: "2026-01-01T00:00:00.000Z",
    user_metadata: {},
  } as any;
}

test("personal export fails instead of returning an incomplete payload when memberships cannot be loaded", async () => {
  const membershipError = new Error("membership query failed");
  let orderCalls = 0;
  const query = {
    select() { return this; },
    eq() { return this; },
    order() {
      orderCalls += 1;
      return orderCalls === 2
        ? Promise.resolve({ data: null, error: membershipError })
        : this;
    },
  };
  const service = { from: () => query } as any;

  await expect(loadPersonalDataExport(
    service,
    exportUser(),
    "2026-09-05T00:00:00.000Z",
  )).rejects.toBe(membershipError);
});

test("personal export returns the bounded 5,000 contact logs and marks a larger history truncated", async () => {
  const logs = Array.from({ length: 5_001 }, (_, index) => ({
    id: `log-${String(index).padStart(4, "0")}`,
    created_at: "2026-09-05T00:00:00.000Z",
    method: "call",
    outcome: index % 2 === 0 ? "answered" : null,
  }));

  const payload = await loadPersonalDataExport(
    personalExportClient(logs),
    exportUser(),
    "2026-09-05T00:00:00.000Z",
  );

  expect(payload.contactLogs).toHaveLength(5_000);
  expect(payload.contactLogs[0]?.id).toBe("log-0000");
  expect(payload.contactLogs.at(-1)?.id).toBe("log-4999");
  expect(payload.truncated).toBe(true);
});

test("personal export fails instead of returning first-page logs when a later page errors", async () => {
  const logs = Array.from({ length: 1_500 }, (_, index) => ({
    id: `log-${index}`,
    created_at: "2026-09-05T00:00:00.000Z",
    method: "call",
    outcome: null,
  }));

  await expect(loadPersonalDataExport(
    personalExportClient(logs, 1_000),
    exportUser(),
    "2026-09-05T00:00:00.000Z",
  )).rejects.toEqual({ message: "second page failed" });
});
