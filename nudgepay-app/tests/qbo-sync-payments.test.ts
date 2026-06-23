import { expect, test } from "vitest";
import { serviceClient } from "./helpers";
import { upsertPayments } from "../app/lib/qbo-sync.server";

test("upsertPayments is idempotent on (org_id, qbo_id, type)", async () => {
  const svc = serviceClient();
  const { data: org } = await svc.from("organizations").insert({ name: `PaySync ${Math.random()}` }).select("id").single();
  const orgId = org!.id;
  const row = {
    org_id: orgId, qbo_id: "501", type: "payment" as const, customer_id: null,
    amount: 100, txn_date: "2026-06-20", qbo_sync_at: new Date().toISOString(),
  };
  await upsertPayments(svc, [row]);
  await upsertPayments(svc, [{ ...row, amount: 150 }]); // same key — updates, no dup
  const { data } = await svc.from("payments").select("amount").eq("org_id", orgId).eq("qbo_id", "501");
  expect(data!.length).toBe(1);
  expect(Number(data![0].amount)).toBe(150);
});
