// Local-dev demo seed for UI review. NOT for production.
// Repopulates the Chancey org (wiped by the test suite) with an owner login,
// customers, past-due invoices, and one SMS thread so the dashboard + invoice
// thread render with realistic data.
//
// Run from nudgepay-app/:  node scripts/demo-seed.mjs
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const env = Object.fromEntries(
  readFileSync(new URL("../.env.test", import.meta.url), "utf8")
    .split("\n").filter(Boolean).map((l) => {
      const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
    })
);

const svc = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const OWNER_EMAIL = "diskin@chancey.test";
const OWNER_PASSWORD = "password123";

function daysAgo(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}

async function ensureOwner() {
  const existing = (await svc.auth.admin.listUsers({ perPage: 1000 })).data.users
    .find((u) => u.email === OWNER_EMAIL);
  if (existing) return existing.id;
  const { data, error } = await svc.auth.admin.createUser({
    email: OWNER_EMAIL, password: OWNER_PASSWORD, email_confirm: true,
  });
  if (error) throw error;
  return data.user.id;
}

async function main() {
  // Clean any prior demo org so this is idempotent.
  const { data: priorOrgs } = await svc.from("organizations")
    .select("id").eq("name", "Chancey Heating & Cooling");
  for (const o of priorOrgs ?? []) {
    await svc.from("organizations").delete().eq("id", o.id); // cascades
  }

  const ownerId = await ensureOwner();

  const { data: org, error: orgErr } = await svc.from("organizations")
    .insert({ name: "Chancey Heating & Cooling" }).select("id").single();
  if (orgErr) throw orgErr;
  const orgId = org.id;

  await svc.from("memberships").insert({ org_id: orgId, user_id: ownerId, role: "owner" });

  // Display-only "connected" QBO row (null encrypted tokens — no live calls).
  // The dashboard gates the worklist on status === "connected".
  await svc.from("qbo_connections").insert({
    org_id: orgId, realm_id: "demo-realm-123", status: "connected",
    last_sync_at: new Date().toISOString(),
  });

  const customerRows = [
    { name: "Riverside Apartments LLC", phone: "+13105550111", sms_consent: true,  email: "ap@riverside.example" },
    { name: "Delgado HVAC Supply",      phone: "+13105550122", sms_consent: true,  email: "billing@delgado.example" },
    { name: "Northgate Property Mgmt",  phone: "+13105550133", sms_consent: false, email: "accounts@northgate.example" },
    { name: "Summit Restaurant Group",  phone: "+13105550144", sms_consent: true,  email: "finance@summit.example" },
  ].map((c, i) => ({ ...c, org_id: orgId, qbo_id: `demo-cust-${i + 1}` }));
  const { data: customers, error: custErr } = await svc.from("customers")
    .insert(customerRows).select("id, name, phone");
  if (custErr) throw custErr;

  const byName = Object.fromEntries(customers.map((c) => [c.name, c]));

  const invoiceRows = [
    { c: "Riverside Apartments LLC", doc: "1042", amount: 4850.00, balance: 4850.00, due: 58 },
    { c: "Riverside Apartments LLC", doc: "1067", amount: 1200.00, balance: 1200.00, due: 31 },
    { c: "Delgado HVAC Supply",      doc: "1051", amount: 9320.50, balance: 9320.50, due: 44 },
    { c: "Northgate Property Mgmt",  doc: "1058", amount: 2740.00, balance: 2740.00, due: 22 },
    { c: "Summit Restaurant Group",  doc: "1063", amount:  675.00, balance:  675.00, due: 15 },
    { c: "Summit Restaurant Group",  doc: "1071", amount: 3110.00, balance: 3110.00, due: 9  },
  ].map((r, i) => ({
    org_id: orgId, qbo_id: `demo-inv-${i + 1}`, qbo_doc_number: r.doc,
    customer_id: byName[r.c].id, amount: r.amount, balance: r.balance,
    due_date: daysAgo(r.due), invoice_date: daysAgo(r.due + 30),
    status: "overdue", qbo_sync_at: new Date().toISOString(),
  }));
  const { data: invoices, error: invErr } = await svc.from("invoices")
    .insert(invoiceRows).select("id, qbo_doc_number, customer_id");
  if (invErr) throw invErr;

  // Per-customer case states for a full feature demo (Phase 6a/6b/6c):
  //   Riverside -> promised (pending promise + SMS thread)
  //   Delgado   -> working  (broken promise -> Broken-promises view)
  //   Northgate -> waiting  (customer-side, future review date)
  //   Summit    -> on_hold  (exception: disputed, future review date)
  const today = new Date().toISOString().slice(0, 10);
  const dayOffset = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); };

  const CASE_SPEC = {
    "Riverside Apartments LLC": { status: "promised", next_action_type: "promise",  next_action_at: dayOffset(2) },
    "Delgado HVAC Supply":      { status: "working",  next_action_type: "follow_up", next_action_at: today },
    "Northgate Property Mgmt":  { status: "waiting",  next_action_type: "waiting",   next_action_at: dayOffset(5) },
    "Summit Restaurant Group":  { status: "on_hold",  next_action_type: "exception", next_action_at: dayOffset(7),
      exception_reason: "disputed", exception_note: "Disputes the labor hours billed on invoice #1063." },
  };

  const caseRows = customers.map((c) => ({
    org_id: orgId, customer_id: c.id,
    ...(CASE_SPEC[c.name] ?? { status: "new", next_action_type: "contact", next_action_at: today }),
  }));
  const { data: cases, error: caseErr } = await svc.from("collection_cases")
    .insert(caseRows).select("id, customer_id");
  if (caseErr) throw caseErr;
  const caseByCustomer = Object.fromEntries(cases.map((c) => [c.customer_id, c.id]));

  // Assign two accounts to the demo owner so "My work" is populated.
  await svc.from("customers").update({ owner: ownerId })
    .in("id", [byName["Riverside Apartments LLC"].id, byName["Northgate Property Mgmt"].id]);

  // Promises: a PENDING one on Riverside (promise card) and a BROKEN one on
  // Delgado (Broken-promises view + row indicator).
  const riversideId = byName["Riverside Apartments LLC"].id;
  const delgadoId = byName["Delgado HVAC Supply"].id;
  const invByCustomer = (cid) => invoices.filter((i) => i.customer_id === cid);
  const { data: proms, error: promErr } = await svc.from("promises").insert([
    { org_id: orgId, case_id: caseByCustomer[riversideId], customer_id: riversideId, status: "pending",
      promised_amount: 2000, promised_date: dayOffset(2), grace_until: dayOffset(4),
      baseline_balance: 6050, amount_received: 0, created_by: ownerId },
    { org_id: orgId, case_id: caseByCustomer[delgadoId], customer_id: delgadoId, status: "broken",
      promised_amount: 5000, promised_date: dayOffset(-5), grace_until: dayOffset(-3),
      baseline_balance: 9320.50, amount_received: 0, created_by: ownerId, resolved_at: new Date().toISOString() },
  ]).select("id, case_id");
  if (promErr) throw promErr;
  const promByCase = Object.fromEntries(proms.map((p) => [p.case_id, p.id]));
  await svc.from("promise_invoices").insert([
    ...invByCustomer(riversideId).map((i) => ({ promise_id: promByCase[caseByCustomer[riversideId]], invoice_id: i.id, org_id: orgId, baseline_balance: 0 })),
    ...invByCustomer(delgadoId).map((i) => ({ promise_id: promByCase[caseByCustomer[delgadoId]], invoice_id: i.id, org_id: orgId, baseline_balance: 0 })),
  ]);

  // One SMS thread on the largest Riverside invoice (#1042), linked to its case.
  const riverside = byName["Riverside Apartments LLC"];
  const inv1042 = invoices.find((i) => i.qbo_doc_number === "1042");
  await svc.from("text_messages").insert([
    {
      org_id: orgId, invoice_id: inv1042.id, customer_id: riverside.id,
      case_id: caseByCustomer[riverside.id],
      sent_by_user_id: ownerId, direction: "outbound", twilio_message_sid: "SMdemo001",
      status: "delivered", from_number: "+13105550100", to_number: riverside.phone,
      body: "Hi Riverside Apartments — invoice #1042 for $4,850.00 is past due. Reply here with any questions or to arrange payment. — Chancey Heating & Cooling",
    },
    {
      org_id: orgId, invoice_id: inv1042.id, customer_id: riverside.id,
      case_id: caseByCustomer[riverside.id],
      direction: "inbound", twilio_message_sid: "SMdemo002",
      from_number: riverside.phone, to_number: "+13105550100",
      body: "Thanks — check is going out Friday. Can you send a copy of the invoice?",
    },
  ]);

  console.log(JSON.stringify({
    ok: true, orgId, ownerEmail: OWNER_EMAIL,
    customers: customers.length, invoices: invoices.length, threadInvoice: "1042",
  }, null, 2));
}

main().catch((e) => { console.error(e); process.exit(1); });
