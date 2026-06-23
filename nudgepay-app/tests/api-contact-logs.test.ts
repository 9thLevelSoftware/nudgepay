import { expect, test, beforeAll } from "vitest";
import { serviceClient, makeUserClient } from "./helpers";

// ── Task 1: migration columns exist and accept promise data ──────────────────
test("contact_logs accepts promised_amount and promised_date", async () => {
  const svc = serviceClient();
  const { data: org } = await svc.from("organizations").insert({ name: "Promise Cols Org" }).select("id").single();
  const orgId = org!.id;
  const { data: cust } = await svc.from("customers")
    .insert({ org_id: orgId, qbo_id: "pc-c1", name: "Promise Co" }).select("id").single();
  const { data: inv } = await svc.from("invoices")
    .insert({ org_id: orgId, qbo_id: "pc-i1", customer_id: cust!.id, amount: 1000, balance: 1000, due_date: "2026-03-01", status: "overdue" })
    .select("id").single();
  const user = await makeUserClient("promise-cols@example.com");
  await svc.from("memberships").insert({ org_id: orgId, user_id: user.userId, role: "owner" });

  const { data: row, error } = await svc.from("contact_logs").insert({
    org_id: orgId, invoice_id: inv!.id, customer_id: cust!.id, user_id: user.userId,
    method: "call", outcome: "promise-to-pay", notes: "spoke with AP",
    promised_amount: 500.5, promised_date: "2026-07-01",
  }).select("promised_amount, promised_date").single();

  expect(error).toBeNull();
  expect(Number(row!.promised_amount)).toBe(500.5);
  expect(row!.promised_date).toBe("2026-07-01");
});
