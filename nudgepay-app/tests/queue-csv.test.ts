import { expect, test } from "vitest";
import { readFileSync } from "node:fs";
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
      entity: "customers",
      docNumber: null,
      payerBand: "fair",
      daysToPay: 32,
      replyRate: 0.5,
    },
  ]);
  const lines = csv.trimEnd().split("\n");
  expect(lines[0]).toBe(
    "customer,status,total_overdue,oldest_age_days,invoice_count,last_contact_date,last_contact_channel,owner,entity,doc_number,payer_band,days_to_pay,reply_rate",
  );
  expect(lines[1]).toContain("\"Acme, Inc\"");
  expect(lines[1]).toContain("1200.5");
  expect(lines[1]).toContain("Pat");
  expect(lines[1]).toContain("customers");
  expect(lines[1]).toContain("fair");
  expect(lines[1]).toContain("32");
  expect(lines[1]).toContain("0.5");
});

test("queueItemsToCsv appends invoice extra columns after the original set", () => {
  const csv = queueItemsToCsv([
    {
      customerName: "Acme",
      status: "working",
      totalOverdue: 6000,
      oldestAgeDays: 113,
      invoiceCount: 1,
      lastContactDate: null,
      lastContactChannel: null,
      owner: "Pat",
      entity: "invoices",
      docNumber: "1001",
      payerBand: "good",
      daysToPay: 21,
      replyRate: null,
    },
  ]);
  const header = csv.trimEnd().split("\n")[0];
  expect(header.startsWith("customer,status,total_overdue")).toBe(true);
  expect(header.endsWith("entity,doc_number,payer_band,days_to_pay,reply_rate")).toBe(true);
  expect(csv).toContain("invoices,1001,good,21,");
});

test("queue.csv loader attaches payer stats instead of an empty map", () => {
  const src = readFileSync(new URL("../app/routes/queue.csv.tsx", import.meta.url), "utf8");
  expect(src).toContain("loadPayerSource");
  expect(src).toContain("loadReplySource");
  expect(src).toContain("payerByCustomer");
  expect(src).not.toContain("payerByCustomer: new Map()");
});
