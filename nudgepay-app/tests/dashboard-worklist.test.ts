import { expect, test, beforeAll } from "vitest";
import { serviceClient, makeUserClient } from "./helpers";
import { buildDashboardData } from "../app/routes/dashboard";

const TODAY = "2026-06-22";

test("buildDashboardData composes items, metrics, viewCounts, and selection", () => {
  const invoices = [
    { id: "i1", qbo_doc_number: "1001", customer_id: "c1", balance: 6000, due_date: "2026-03-01" },
    { id: "i2", qbo_doc_number: "1002", customer_id: "c1", balance: 300, due_date: "2026-06-18" },
  ];
  const customers = [{ id: "c1", name: "Acme", phone: "+13105550101", email: "ap@acme.test" }];
  const lastContacts = [{ invoiceId: "i2", date: "2026-06-19T00:00:00Z", channel: "Text" }];
  const data = buildDashboardData(invoices, customers, lastContacts,
    { view: "30-plus", sort: "recommended", q: "", invoice: "i1" }, TODAY);

  expect(data.metrics.allOpen.count).toBe(2);
  expect(data.viewCounts["30-plus"]).toBe(1);
  expect(data.items.map((i) => i.invoiceId)).toEqual(["i1"]); // 30-plus view
  expect(data.selected?.invoiceId).toBe("i1");
  expect(data.selected?.heat.band).toBe("hot");
});

test("buildDashboardData search filters across customer/invoice/contact text", () => {
  const invoices = [
    { id: "i1", qbo_doc_number: "1001", customer_id: "c1", balance: 6000, due_date: "2026-03-01" },
    { id: "i2", qbo_doc_number: "2002", customer_id: "c2", balance: 800, due_date: "2026-04-01" },
  ];
  const customers = [
    { id: "c1", name: "Acme", phone: null, email: null },
    { id: "c2", name: "Globex", phone: null, email: null },
  ];
  const data = buildDashboardData(invoices, customers, [],
    { view: "all-open", sort: "recommended", q: "globex", invoice: null }, TODAY);
  expect(data.items.map((i) => i.invoiceId)).toEqual(["i2"]);
  expect(data.metrics.allOpen.count).toBe(1); // metrics reflect the search set
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
