import { expect, test } from "vitest";
import {
  mapQboCustomer, mapQboInvoice, invoiceStatus,
} from "../app/lib/qbo-mappers.server";

const NOW = new Date("2026-06-22T12:00:00Z");

test("mapQboCustomer pulls name/email/phone and omits sms_consent", () => {
  const row = mapQboCustomer({
    Id: "5", DisplayName: "Acme HVAC",
    PrimaryEmailAddr: { Address: "ar@acme.test" },
    PrimaryPhone: { FreeFormNumber: "229-555-0101" },
  }, "org-1");
  expect(row).toEqual({
    org_id: "org-1", qbo_id: "5", name: "Acme HVAC",
    email: "ar@acme.test", phone: "229-555-0101",
  });
  expect("sms_consent" in row).toBe(false); // upsert must not clobber consent
});

test("mapQboCustomer falls back when optional fields are missing", () => {
  const row = mapQboCustomer({ Id: 9, FullyQualifiedName: "Fallback Co" }, "org-1");
  expect(row.qbo_id).toBe("9"); // coerced to string
  expect(row.name).toBe("Fallback Co");
  expect(row.email).toBeNull();
  expect(row.phone).toBeNull();
});

test("invoiceStatus: paid when balance <= 0, overdue when past due, else open", () => {
  expect(invoiceStatus(0, "2026-01-01", NOW)).toBe("paid");
  expect(invoiceStatus(100, "2026-06-01", NOW)).toBe("overdue"); // due before now
  expect(invoiceStatus(100, "2026-12-01", NOW)).toBe("open");    // due after now
  expect(invoiceStatus(100, null, NOW)).toBe("open");            // no due date
});

test("mapQboInvoice maps money with NaN guard and anchors status on due date", () => {
  const row = mapQboInvoice({
    Id: "77", DocNumber: "1042", TotalAmt: "350.50", Balance: "120.00",
    DueDate: "2026-06-01", TxnDate: "2026-05-01", CustomerRef: { value: "5" },
  }, "org-1", "cust-uuid", NOW);
  expect(row.qbo_id).toBe("77");
  expect(row.qbo_doc_number).toBe("1042");
  expect(row.amount).toBe(350.5);
  expect(row.balance).toBe(120);
  expect(row.due_date).toBe("2026-06-01");
  expect(row.invoice_date).toBe("2026-05-01");
  expect(row.customer_id).toBe("cust-uuid");
  expect(row.status).toBe("overdue");
  expect(row.qbo_sync_at).toBe(NOW.toISOString());
});

test("mapQboInvoice coerces unparseable money to 0 (never NaN into numeric column)", () => {
  const row = mapQboInvoice({ Id: "1", TotalAmt: "n/a", Balance: undefined }, "org-1", null, NOW);
  expect(row.amount).toBe(0);
  expect(row.balance).toBe(0);
  expect(row.customer_id).toBeNull();
  expect(row.qbo_doc_number).toBeNull();
  expect(row.due_date).toBeNull();
});
