import { expect, test, beforeAll } from "vitest";
import { serviceClient, makeUserClient } from "./helpers";
import { buildCaseData } from "../app/routes/dashboard";
import type { CaseRow } from "../app/lib/cases";

const TODAY = "2026-06-22";

test("buildCaseData composes case items, metrics, viewCounts, and selection", () => {
  const cases: CaseRow[] = [
    { id: "case-1", customerId: "c1", status: "working", nextActionType: "follow_up", nextActionAt: "2026-06-20" },
  ];
  const invoices = [
    { id: "i1", qbo_doc_number: "1001", customer_id: "c1", balance: 6000, due_date: "2026-03-01" },
    { id: "i2", qbo_doc_number: "1002", customer_id: "c1", balance: 300, due_date: "2026-06-18" },
  ];
  const customers = [{ id: "c1", name: "Acme", phone: null, email: null, owner: "u1" }];
  const data = buildCaseData(cases, invoices, customers, [],
    { view: "all-open", sort: "recommended", q: "", caseId: "case-1" }, "2026-06-22",
    new Map([["u1", "diskin"]]), "u1");

  expect(data.metrics.allOpen.count).toBe(1);
  expect(data.viewCounts["my-work"]).toBe(1);
  expect(data.items.map((i) => i.caseId)).toEqual(["case-1"]);
  expect(data.selected?.caseId).toBe("case-1");
  expect(data.selected?.totalOverdue).toBe(6300);
});

// DB-backed: proves the RLS-scoped read shape the loader relies on.
let user: Awaited<ReturnType<typeof makeUserClient>>;
let orgId: string;
beforeAll(async () => {
  const svc = serviceClient();
  user = await makeUserClient("worklist-reader@example.com");
  const { data: org } = await svc.from("organizations").insert({ name: "Worklist Org" }).select("id").single();
  orgId = org!.id;
  await svc.from("memberships").insert({ org_id: orgId, user_id: user.userId, role: "owner" });
  const { data: cust } = await svc.from("customers")
    .insert({ org_id: orgId, qbo_id: "wl-c1", name: "Riverside", phone: "+13105559001", sms_consent: true })
    .select("id").single();
  await svc.from("invoices").insert({
    org_id: orgId, qbo_id: "wl-i1", qbo_doc_number: "9001", customer_id: cust!.id,
    amount: 4850, balance: 4850, due_date: "2026-03-01", status: "overdue",
  });
});

test("RLS user client reads only the member's past-due invoices with customer embed", async () => {
  const today = TODAY;
  const { data: rows, error } = await user.client
    .from("invoices")
    .select("id, qbo_doc_number, balance, due_date, customer_id, customers(name, phone, email)")
    .eq("org_id", orgId).gt("balance", 0).lt("due_date", today);
  expect(error).toBeNull();
  expect(rows!.length).toBe(1);
  expect((rows![0] as any).customers.name).toBe("Riverside");
});

test("RLS user client reads an invoice thread ascending with consent embed", async () => {
  const svc = serviceClient();
  // Add a customer + invoice + two outbound/one inbound message in the existing org.
  const { data: cust } = await svc.from("customers")
    .insert({ org_id: orgId, qbo_id: "thread-c1", name: "Thread Co", phone: "+13105559100", sms_consent: true })
    .select("id").single();
  const { data: inv } = await svc.from("invoices")
    .insert({ org_id: orgId, qbo_id: "thread-i1", qbo_doc_number: "9100", customer_id: cust!.id, amount: 1200, balance: 1200, due_date: "2026-02-01", status: "overdue" })
    .select("id").single();
  await svc.from("text_messages").insert([
    { org_id: orgId, invoice_id: inv!.id, customer_id: cust!.id, direction: "outbound", body: "first", status: "sent", created_at: "2026-06-20T10:00:00Z" },
    { org_id: orgId, invoice_id: inv!.id, customer_id: cust!.id, direction: "inbound", body: "reply", created_at: "2026-06-20T11:00:00Z" },
  ]);

  const { data: msgs, error } = await user.client
    .from("text_messages")
    .select("id, direction, body, status, error_code, created_at")
    .eq("org_id", orgId).eq("invoice_id", inv!.id)
    .order("created_at", { ascending: true });
  expect(error).toBeNull();
  expect(msgs!.map((m) => m.body)).toEqual(["first", "reply"]);

  const { data: invRow } = await user.client
    .from("invoices").select("customers(phone, sms_consent)").eq("id", inv!.id).maybeSingle();
  expect((invRow as any).customers.sms_consent).toBe(true);
  expect((invRow as any).customers.phone).toBe("+13105559100");
});
