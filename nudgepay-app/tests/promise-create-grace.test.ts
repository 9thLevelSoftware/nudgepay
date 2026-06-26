import { expect, test } from "vitest";
import { serviceClient } from "./helpers";
import { createPromiseForLog } from "../app/lib/promise-create.server";

test("grace_until uses the org's configured grace days", async () => {
  const svc = serviceClient();
  const rnd = Math.random().toString(36).slice(2, 8);
  const { data: org } = await svc.from("organizations").insert({ name: `C7 Grace ${rnd}` }).select("id").single();
  const orgId = org!.id as string;
  const { data: cust } = await svc.from("customers")
    .insert({ org_id: orgId, qbo_id: `c7g-${rnd}`, name: "Acme" }).select("id").single();
  const customerId = cust!.id as string;
  await svc.from("invoices").insert({
    org_id: orgId, qbo_id: `c7gi-${rnd}`, customer_id: customerId,
    amount: 100, balance: 100, due_date: "2026-06-01", status: "overdue",
  });
  const { data: cse } = await svc.from("collection_cases")
    .insert({ org_id: orgId, customer_id: customerId, status: "working" }).select("id").single();
  const caseId = cse!.id as string;
  await svc.from("org_settings").insert({ org_id: orgId, promise_grace_days: 5 });

  const res = await createPromiseForLog(svc, {
    orgId, caseId, customerId,
    userId: null as unknown as string,
    contactLogId: null, promisedAmount: 100, promisedDate: "2026-06-22", // Monday
  });
  expect(res.ok).toBe(true);

  const { data: prom } = await svc.from("promises")
    .select("grace_until").eq("case_id", caseId).single();
  // Mon 2026-06-22 + 5 business days = Mon 2026-06-29.
  expect(prom!.grace_until).toBe("2026-06-29");
});

test("grace_until skips a configured holiday", async () => {
  const svc = serviceClient();
  const rnd = Math.random().toString(36).slice(2, 8);
  const { data: org } = await svc.from("organizations").insert({ name: `C7 Holiday ${rnd}` }).select("id").single();
  const orgId = org!.id as string;
  const { data: cust } = await svc.from("customers")
    .insert({ org_id: orgId, qbo_id: `c7h-${rnd}`, name: "Acme" }).select("id").single();
  const customerId = cust!.id as string;
  await svc.from("invoices").insert({
    org_id: orgId, qbo_id: `c7hi-${rnd}`, customer_id: customerId,
    amount: 100, balance: 100, due_date: "2026-06-01", status: "overdue",
  });
  const { data: cse } = await svc.from("collection_cases")
    .insert({ org_id: orgId, customer_id: customerId, status: "working" }).select("id").single();
  const caseId = cse!.id as string;
  await svc.from("org_settings").insert({ org_id: orgId, promise_grace_days: 2 });
  await svc.from("org_holidays").insert({ org_id: orgId, holiday_date: "2026-06-24" });

  const res = await createPromiseForLog(svc, {
    orgId, caseId, customerId,
    userId: null as unknown as string,
    contactLogId: null, promisedAmount: 100, promisedDate: "2026-06-22", // Monday
  });
  expect(res.ok).toBe(true);

  const { data: prom } = await svc.from("promises")
    .select("grace_until").eq("case_id", caseId).single();
  // Mon 2026-06-22 + 2 business days, skipping Wed 2026-06-24 (holiday): Tue=1, Thu=2 -> 2026-06-25.
  expect(prom!.grace_until).toBe("2026-06-25");
});
