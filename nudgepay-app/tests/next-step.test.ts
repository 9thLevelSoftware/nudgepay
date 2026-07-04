import { beforeAll, expect, test } from "vitest";
import { serviceClient, makeUserClient } from "./helpers";
import { applyNextStep } from "../app/lib/next-step.server";

let client: any;
let userId: string;
let orgId: string;

beforeAll(async () => {
  ({ client, userId } = await makeUserClient("next-step@example.com"));
  const svc = serviceClient();
  const { data: org } = await svc.from("organizations").insert({ name: `NS Org ${Math.random()}` }).select("id").single();
  orgId = org!.id;
  await svc.from("memberships").insert({ org_id: orgId, user_id: userId, role: "member" });
});

async function seedCase(): Promise<string> {
  const svc = serviceClient();
  const { data: cust } = await svc.from("customers")
    .insert({ org_id: orgId, qbo_id: `ns-${Math.random()}`, name: "Acme" }).select("id").single();
  const { data: cse } = await svc.from("collection_cases")
    .insert({ org_id: orgId, customer_id: cust!.id, status: "working" }).select("id").single();
  return cse!.id as string;
}

test("applyNextStep with a review-dated exception stores the review date", async () => {
  const caseId = await seedCase();
  const res = await applyNextStep(client, orgId, caseId, {
    nextStep: "exception", followUpAt: null, promisedAmount: null, promisedDate: null,
    reviewAt: "2026-09-01", exceptionReason: "disputed", exceptionNote: "line 3",
  });
  expect(res.ok).toBe(true);
  const { data } = await serviceClient().from("collection_cases")
    .select("status, exception_reason, next_action_at").eq("id", caseId).single();
  expect(data!.status).toBe("on_hold");
  expect(data!.exception_reason).toBe("disputed");
  expect(data!.next_action_at).toBe("2026-09-01");
});

test("applyNextStep with a terminal exception nulls next_action_at even if a review date is supplied", async () => {
  const caseId = await seedCase();
  // Pass a non-null reviewAt: the OLD code would persist it; the NEW code must
  // force null for terminal states. This makes the test fail before the fix.
  const res = await applyNextStep(client, orgId, caseId, {
    nextStep: "exception", followUpAt: null, promisedAmount: null, promisedDate: null,
    reviewAt: "2026-09-01", exceptionReason: "do_not_contact", exceptionNote: null,
  });
  expect(res.ok).toBe(true);
  const { data } = await serviceClient().from("collection_cases")
    .select("status, exception_reason, next_action_at").eq("id", caseId).single();
  expect(data!.status).toBe("on_hold");
  expect(data!.exception_reason).toBe("do_not_contact");
  expect(data!.next_action_at).toBeNull();
});
