// Stakeholder demo workspace. Idempotent. Does not touch other orgs.
// Requires SUPABASE_URL + SUPABASE_SERVICE_KEY (production service role).
//
//   node scripts/seed-stakeholder-demo.mjs
import { createClient } from "@supabase/supabase-js";

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_KEY;
if (!url || !key) {
  console.error("Set SUPABASE_URL and SUPABASE_SERVICE_KEY");
  process.exit(1);
}

const OWNER_EMAIL = process.env.DEMO_EMAIL || "demo@nudgepay-ar.app";
const OWNER_PASSWORD = process.env.DEMO_PASSWORD || "NudgePay-Demo-2026";
const ORG_NAME = "Chancey Heating & Cooling (Demo)";

const svc = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

function daysAgo(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}
function dayOffset(n) {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}
function hoursAgo(h) {
  const d = new Date();
  d.setHours(d.getHours() - h);
  return d.toISOString();
}

async function ensureOwner() {
  const existing = (await svc.auth.admin.listUsers({ perPage: 1000 })).data.users
    .find((u) => (u.email ?? "").toLowerCase() === OWNER_EMAIL.toLowerCase());
  if (existing) {
    await svc.auth.admin.updateUserById(existing.id, { password: OWNER_PASSWORD, email_confirm: true });
    return existing.id;
  }
  const { data, error } = await svc.auth.admin.createUser({
    email: OWNER_EMAIL, password: OWNER_PASSWORD, email_confirm: true,
    user_metadata: { display_name: "Demo Owner" },
  });
  if (error) throw error;
  return data.user.id;
}

async function main() {
  const ownerId = await ensureOwner();

  let orgId;
  const { data: existingOrg, error: existingErr } = await svc.from("organizations")
    .select("id").eq("name", ORG_NAME).maybeSingle();
  if (existingErr) throw existingErr;
  if (existingOrg) {
    orgId = existingOrg.id;
    for (const table of [
      "text_messages", "email_messages", "contact_logs", "promise_invoices",
      "promises", "collection_cases", "invoices", "customers",
    ]) {
      const { error } = await svc.from(table).delete().eq("org_id", orgId);
      if (error) throw error;
    }
  } else {
    const { data: org, error: orgErr } = await svc.from("organizations")
      .insert({ name: ORG_NAME }).select("id").single();
    if (orgErr) throw orgErr;
    orgId = org.id;
  }

  const { data: mem } = await svc.from("memberships")
    .select("user_id").eq("org_id", orgId).eq("user_id", ownerId).maybeSingle();
  if (!mem) {
    const { error: memErr } = await svc.from("memberships")
      .insert({ org_id: orgId, user_id: ownerId, role: "owner" });
    if (memErr) throw memErr;
  }

  // Display-only connected chrome. Tokens stay null so Intuit is never called
  // until real QBO secrets exist (cron currently fails closed before CDC).
  const { error: qboErr } = await svc.from("qbo_connections").upsert({
    org_id: orgId,
    realm_id: "demo-not-intuit",
    status: "connected",
    last_sync_at: new Date().toISOString(),
  }, { onConflict: "org_id" });
  if (qboErr) throw qboErr;

  await svc.from("messaging_config").upsert({
    org_id: orgId, sender: "+13105550100", messaging_service_sid: "MG_demo", sms_enabled: true,
  }, { onConflict: "org_id" });
  await svc.from("email_config").upsert({
    org_id: orgId,
    email_enabled: true,
    from_address: "billing@chancey-demo.test",
    from_name: "Chancey Heating & Cooling",
    provider: "resend",
    postal_address: "1420 Industrial Pkwy, Suite 200, Sacramento, CA 95820",
    updated_at: new Date().toISOString(),
  }, { onConflict: "org_id" });

  const customerRows = [
    { name: "Riverside Apartments LLC", phone: "+13105550111", sms_consent: true, email: "ap@riverside.example" },
    { name: "Delgado HVAC Supply", phone: "+13105550122", sms_consent: true, email: "billing@delgado.example" },
    { name: "Northgate Property Mgmt", phone: "+13105550133", sms_consent: false, email: "accounts@northgate.example", do_not_email: true },
    { name: "Summit Restaurant Group", phone: "+13105550144", sms_consent: true, email: "finance@summit.example" },
  ].map((c, i) => ({
    do_not_call: false, do_not_text: false, do_not_email: false, ...c,
    org_id: orgId, qbo_id: `demo-cust-${i + 1}`,
  }));
  const { data: customers, error: custErr } = await svc.from("customers")
    .insert(customerRows).select("id, name, phone, email");
  if (custErr) throw custErr;
  const byName = Object.fromEntries(customers.map((c) => [c.name, c]));

  const invoiceRows = [
    { c: "Riverside Apartments LLC", doc: "1042", amount: 4850.00, balance: 4850.00, due: 58 },
    { c: "Riverside Apartments LLC", doc: "1067", amount: 1200.00, balance: 1200.00, due: 31 },
    { c: "Delgado HVAC Supply", doc: "1051", amount: 9320.50, balance: 9320.50, due: 44 },
    { c: "Northgate Property Mgmt", doc: "1058", amount: 2740.00, balance: 2740.00, due: 22 },
    { c: "Summit Restaurant Group", doc: "1063", amount: 675.00, balance: 675.00, due: 15 },
    { c: "Summit Restaurant Group", doc: "1071", amount: 3110.00, balance: 3110.00, due: 9 },
    { c: "Riverside Apartments LLC", doc: "1088", amount: 890.00, balance: 890.00, due: -6 },
  ].map((r, i) => ({
    org_id: orgId, qbo_id: `demo-inv-${i + 1}`, qbo_doc_number: r.doc,
    customer_id: byName[r.c].id, amount: r.amount, balance: r.balance,
    due_date: daysAgo(r.due), invoice_date: daysAgo(Math.max(r.due, 0) + 30),
    status: r.due < 0 ? "open" : "overdue", qbo_sync_at: new Date().toISOString(),
  }));
  const { data: invoices, error: invErr } = await svc.from("invoices")
    .insert(invoiceRows).select("id, qbo_doc_number, customer_id");
  if (invErr) throw invErr;

  const today = new Date().toISOString().slice(0, 10);
  const CASE_SPEC = {
    "Riverside Apartments LLC": { status: "promised", next_action_type: "promise", next_action_at: dayOffset(2) },
    "Delgado HVAC Supply": { status: "working", next_action_type: "follow_up", next_action_at: today },
    "Northgate Property Mgmt": { status: "waiting", next_action_type: "waiting", next_action_at: dayOffset(5) },
    "Summit Restaurant Group": {
      status: "on_hold", next_action_type: "exception", next_action_at: dayOffset(7),
      exception_reason: "disputed",
      exception_note: "Disputes the labor hours billed on invoice #1063.",
    },
  };
  const caseRows = customers.map((c) => ({
    org_id: orgId, customer_id: c.id,
    ...(CASE_SPEC[c.name] ?? { status: "new", next_action_type: "contact", next_action_at: today }),
  }));
  const { data: cases, error: caseErr } = await svc.from("collection_cases")
    .insert(caseRows).select("id, customer_id");
  if (caseErr) throw caseErr;
  const caseByCustomer = Object.fromEntries(cases.map((c) => [c.customer_id, c.id]));

  const { error: updateErr } = await svc.from("customers").update({ owner: ownerId })
    .in("id", [byName["Riverside Apartments LLC"].id, byName["Northgate Property Mgmt"].id]);
  if (updateErr) throw updateErr;

  const riversideId = byName["Riverside Apartments LLC"].id;
  const delgadoId = byName["Delgado HVAC Supply"].id;
  const invByCustomer = (cid) => invoices.filter((i) => i.customer_id === cid);
  const { data: proms, error: promErr } = await svc.from("promises").insert([
    {
      org_id: orgId, case_id: caseByCustomer[riversideId], customer_id: riversideId, status: "pending",
      promised_amount: 2000, promised_date: dayOffset(2), grace_until: dayOffset(4),
      baseline_balance: 6050, amount_received: 0, created_by: ownerId,
    },
    {
      org_id: orgId, case_id: caseByCustomer[delgadoId], customer_id: delgadoId, status: "broken",
      promised_amount: 5000, promised_date: dayOffset(-5), grace_until: dayOffset(-3),
      baseline_balance: 9320.50, amount_received: 0, created_by: ownerId, resolved_at: new Date().toISOString(),
    },
  ]).select("id, case_id");
  if (promErr) throw promErr;
  const promByCase = Object.fromEntries(proms.map((p) => [p.case_id, p.id]));
  const { error: promInvErr } = await svc.from("promise_invoices").insert([
    ...invByCustomer(riversideId).map((i) => ({
      promise_id: promByCase[caseByCustomer[riversideId]], invoice_id: i.id, org_id: orgId, baseline_balance: 0,
    })),
    ...invByCustomer(delgadoId).map((i) => ({
      promise_id: promByCase[caseByCustomer[delgadoId]], invoice_id: i.id, org_id: orgId, baseline_balance: 0,
    })),
  ]);
  if (promInvErr) throw promInvErr;

  const riverside = byName["Riverside Apartments LLC"];
  const inv1042 = invoices.find((i) => i.qbo_doc_number === "1042");
  const { error: smsErr } = await svc.from("text_messages").insert([
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
  if (smsErr) throw smsErr;

  const byDoc = Object.fromEntries(invoices.map((i) => [i.qbo_doc_number, i]));
  const logRows = [
    {
      invoice: "1051", method: "call", outcome: "promise-to-pay",
      notes: "Spoke with Maria in AP — promised to mail a check.",
      promised_amount: 9320.50, promised_date: dayOffset(-5), follow_up_at: null,
    },
    {
      invoice: "1058", method: "call", outcome: "no-answer",
      notes: "Left voicemail for accounts dept. Try again.",
      promised_amount: null, promised_date: null, follow_up_at: dayOffset(0),
    },
    {
      invoice: "1042", method: "text", outcome: "promise-to-pay",
      notes: "Confirmed via SMS — check going out Friday.",
      promised_amount: 4850.00, promised_date: dayOffset(3), follow_up_at: dayOffset(3),
    },
  ];
  for (const r of logRows) {
    const inv = byDoc[r.invoice];
    const { error } = await svc.from("contact_logs").insert({
      org_id: orgId, invoice_id: inv.id, customer_id: inv.customer_id, user_id: ownerId,
      method: r.method, outcome: r.outcome, notes: r.notes,
      promised_amount: r.promised_amount, promised_date: r.promised_date, follow_up_at: r.follow_up_at,
    });
    if (error) throw error;
  }

  const FROM_ADDRESS = "billing@chancey-demo.test";
  const { error: emailErr } = await svc.from("email_messages").insert([
    {
      org_id: orgId, customer_id: byName["Summit Restaurant Group"].id,
      invoice_id: byDoc["1063"].id, case_id: caseByCustomer[byName["Summit Restaurant Group"].id],
      sent_by_user_id: ownerId, direction: "outbound", provider_message_id: "demo-email-1",
      status: "delivered", from_address: FROM_ADDRESS, to_address: byName["Summit Restaurant Group"].email,
      subject: "Past-due invoice #1063 — $675.00",
      body: "Hi Summit Restaurant Group,\n\nOur records show invoice #1063 for $675.00 is now past due.\n\nThank you,\nChancey Heating & Cooling",
      created_at: hoursAgo(52),
    },
    {
      org_id: orgId, customer_id: byName["Summit Restaurant Group"].id,
      invoice_id: byDoc["1063"].id, case_id: caseByCustomer[byName["Summit Restaurant Group"].id],
      direction: "inbound", provider_message_id: "demo-email-2", status: null,
      from_address: byName["Summit Restaurant Group"].email, to_address: FROM_ADDRESS,
      subject: "Re: Past-due invoice #1063 — $675.00",
      body: "Thanks for the reminder — can you resend the itemized invoice?",
      created_at: hoursAgo(6),
    },
    {
      org_id: orgId, customer_id: byName["Delgado HVAC Supply"].id,
      invoice_id: byDoc["1051"].id, case_id: caseByCustomer[byName["Delgado HVAC Supply"].id],
      sent_by_user_id: ownerId, direction: "outbound", provider_message_id: "demo-email-3",
      status: "bounced", error_code: "hard_bounce",
      from_address: FROM_ADDRESS, to_address: byName["Delgado HVAC Supply"].email,
      subject: "Payment reminder — invoice #1051 ($9,320.50)",
      body: "Hi Delgado HVAC Supply,\n\nInvoice #1051 for $9,320.50 remains outstanding.\n\nThank you,\nChancey Heating & Cooling",
      created_at: hoursAgo(20),
    },
    {
      org_id: orgId, customer_id: riverside.id,
      invoice_id: inv1042.id, case_id: caseByCustomer[riverside.id],
      sent_by_user_id: ownerId, direction: "outbound", provider_message_id: "demo-email-4",
      status: "opened", from_address: FROM_ADDRESS, to_address: riverside.email,
      subject: "Copy of invoice #1042 as requested",
      body: "Hi Riverside Apartments,\n\nHere is a copy of invoice #1042 for $4,850.00 as requested over text.\n\nThank you,\nChancey Heating & Cooling",
      created_at: hoursAgo(2),
    },
  ]);
  if (emailErr) throw emailErr;

  console.log(JSON.stringify({
    ok: true,
    url: "https://nudgepay.9thlevelsoftware.com/login",
    stagingUrl: "https://nudgepay-app-staging.dasblueeyeddevil.workers.dev/login",
    org: ORG_NAME,
    email: OWNER_EMAIL,
    password: OWNER_PASSWORD,
    customers: customers.length,
    invoices: invoices.length,
  }, null, 2));
}

main().catch((e) => { console.error(e); process.exit(1); });
