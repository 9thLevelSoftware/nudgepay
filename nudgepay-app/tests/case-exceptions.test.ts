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

test("collection_cases accepts the new C2 taxonomy values and a terminal hold with null review", async () => {
  const svc = serviceClient();
  const { data: org } = await svc.from("organizations").insert({ name: `ExcOrg2 ${Math.random()}` }).select("id").single();
  const orgId = org!.id;
  const { data: cust } = await svc.from("customers")
    .insert({ org_id: orgId, qbo_id: `exc2-${Math.random()}`, name: "Beta" }).select("id").single();

  // A review-dated new value.
  const { data: c1, error: e1 } = await svc.from("collection_cases").insert({
    org_id: orgId, customer_id: cust!.id, status: "on_hold",
    next_action_type: "exception", next_action_at: "2026-09-01", exception_reason: "incorrect_amount",
  }).select("id").single();
  expect(e1).toBeNull();

  // Close the first case so the unique-open-per-customer index allows a second.
  await svc.from("collection_cases").update({ closed_at: new Date().toISOString() }).eq("id", c1!.id);

  // A terminal value with NO review date (next_action_at null).
  const { data: c2, error: e2 } = await svc.from("collection_cases").insert({
    org_id: orgId, customer_id: cust!.id, status: "on_hold",
    next_action_type: "exception", next_action_at: null, exception_reason: "do_not_contact",
  }).select("exception_reason, next_action_at").single();
  expect(e2).toBeNull();
  expect(c2!.exception_reason).toBe("do_not_contact");
  expect(c2!.next_action_at).toBeNull();

  // An out-of-taxonomy value is still rejected.
  const { error: e3 } = await svc.from("collection_cases").insert({
    org_id: orgId, customer_id: cust!.id, status: "on_hold", exception_reason: "totally_bogus",
  });
  expect(e3).not.toBeNull();
});
