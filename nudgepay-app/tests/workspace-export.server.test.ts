import { expect, test } from "vitest";
import { makeUserClient, serviceClient } from "./helpers";
import { loadWorkspaceDataExport } from "../app/lib/workspace-export.server";

test("loadWorkspaceDataExport includes customers and invoices for the org", async () => {
  const svc = serviceClient();
  const owner = await makeUserClient(`ws-exp-${Math.random()}@example.com`);
  const { data: org, error: orgErr } = await svc.from("organizations")
    .insert({ name: "Export Workspace Co" }).select("id").single();
  expect(orgErr).toBeNull();
  const orgId = org!.id as string;
  const { error: memErr } = await svc.from("memberships").insert({
    org_id: orgId, user_id: owner.userId, role: "owner",
  });
  expect(memErr).toBeNull();
  const { data: cust } = await svc.from("customers").insert({
    org_id: orgId, name: "Acme Heating", email: "ap@acme.test", qbo_id: `c-${Math.random()}`,
  }).select("id").single();
  const { error: invErr } = await svc.from("invoices").insert({
    org_id: orgId, customer_id: cust!.id, qbo_id: `inv-${Math.random()}`,
    qbo_doc_number: "1001", amount: 250, balance: 250, status: "overdue",
  });
  expect(invErr).toBeNull();
  const { data: cse, error: caseErr } = await svc.from("collection_cases").insert({
    org_id: orgId, customer_id: cust!.id, status: "working",
  }).select("id").single();
  expect(caseErr).toBeNull();
  const { error: promErr } = await svc.from("promises").insert({
    org_id: orgId, case_id: cse!.id, customer_id: cust!.id, status: "pending",
    promised_amount: 250, promised_date: "2026-09-15", grace_until: "2026-09-17",
    baseline_balance: 250,
  });
  expect(promErr).toBeNull();

  const payload = await loadWorkspaceDataExport(svc, orgId, "Export Workspace Co", "2026-08-31T12:00:00.000Z");
  expect(payload.workspace).toEqual({ id: orgId, name: "Export Workspace Co" });
  expect(payload.memberships.rows).toEqual([{ userId: owner.userId, role: "owner" }]);
  expect(payload.customers.rows).toHaveLength(1);
  expect(payload.customers.rows[0]).toMatchObject({
    id: cust!.id,
    name: "Acme Heating",
    email: "ap@acme.test",
    erasedAt: null,
  });
  expect(payload.invoices.rows).toHaveLength(1);
  expect(payload.invoices.rows[0]).toMatchObject({
    customerId: cust!.id,
    docNumber: "1001",
    amount: 250,
    balance: 250,
  });
  expect(payload.promises.rows).toHaveLength(1);
  expect(payload.promises.rows[0]).toMatchObject({
    customerId: cust!.id,
    caseId: cse!.id,
    status: "pending",
    promisedAmount: 250,
    promisedDate: "2026-09-15",
  });
  expect(payload.truncated).toBe(false);
});
