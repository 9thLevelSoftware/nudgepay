import { expect, test } from "vitest";
import { mapQboPayment } from "../app/lib/qbo-mappers.server";

const NOW = new Date("2026-06-23T12:00:00Z");

test("maps a QBO Payment with amount and txn date", () => {
  const raw = { Id: "501", TotalAmt: 250.5, TxnDate: "2026-06-20", CustomerRef: { value: "9" } };
  expect(mapQboPayment(raw, "payment", "org-1", "cust-uuid", NOW)).toEqual({
    org_id: "org-1", qbo_id: "501", type: "payment", customer_id: "cust-uuid",
    amount: 250.5, txn_date: "2026-06-20", qbo_sync_at: NOW.toISOString(),
  });
});

test("maps a CreditMemo and NaN-guards a missing amount", () => {
  const raw = { Id: "777", CustomerRef: { value: "9" } };
  const row = mapQboPayment(raw, "credit_memo", "org-1", null, NOW);
  expect(row.type).toBe("credit_memo");
  expect(row.amount).toBe(0);       // NaN-guarded
  expect(row.txn_date).toBeNull();
  expect(row.customer_id).toBeNull();
});
