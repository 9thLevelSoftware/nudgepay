import { expect, test } from "vitest";
import { serviceClient } from "./helpers";

test("collection_cases stores exception_reason + note and rejects a bad reason", async () => {
  const svc = serviceClient();
  const { data: org } = await svc.from("organizations").insert({ name: `ExcOrg ${Math.random()}` }).select("id").single();
  const orgId = org!.id;
  const { data: cust } = await svc.from("customers")
    .insert({ org_id: orgId, qbo_id: `exc-${Math.random()}`, name: "Acme" }).select("id").single();

  const { data: ok, error: okErr } = await svc.from("collection_cases").insert({
    org_id: orgId, customer_id: cust!.id, status: "on_hold",
    next_action_type: "exception", next_action_at: "2026-08-01",
    exception_reason: "disputed", exception_note: "customer disputes line 3",
  }).select("exception_reason, exception_note").single();
  expect(okErr).toBeNull();
  expect(ok!.exception_reason).toBe("disputed");
  expect(ok!.exception_note).toBe("customer disputes line 3");

  const { error: badErr } = await svc.from("collection_cases").insert({
    org_id: orgId, customer_id: cust!.id, status: "on_hold", exception_reason: "nope",
  });
  expect(badErr).not.toBeNull(); // check constraint rejects an unknown reason
});
