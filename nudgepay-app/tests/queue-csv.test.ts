import { expect, test } from "vitest";
import { queueItemsToCsv } from "../app/lib/queue-csv";

test("queueItemsToCsv writes a header and one row per case", () => {
  const csv = queueItemsToCsv([
    {
      customerName: "Acme, Inc",
      status: "working",
      totalOverdue: 1200.5,
      oldestAgeDays: 40,
      invoiceCount: 2,
      lastContactDate: "2026-06-01",
      lastContactChannel: "Call",
      owner: "Pat",
    },
  ]);
  const lines = csv.trimEnd().split("\n");
  expect(lines[0]).toContain("customer");
  expect(lines[1]).toContain("\"Acme, Inc\"");
  expect(lines[1]).toContain("1200.5");
  expect(lines[1]).toContain("Pat");
});
