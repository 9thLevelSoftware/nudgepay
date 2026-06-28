// Local-dev augmentation layering the email subsystem (Phases 14–17) onto the
// Chancey demo org so the channel-aware Messages inbox, the per-account Email
// tab, and Settings → Email render with real data:
//   - email_config: workspace email turned ON (from name/address + CAN-SPAM
//     postal address) so the composer is enabled.
//   - email_messages: a needs-reply email thread (Summit), a bounced/failed
//     thread (Delgado → "Needs attention" + Failed badge), and a delivered
//     email on Riverside (a customer with BOTH an SMS and an email thread).
//   - do_not_email: Northgate hard-blocked on email too (already do-not-call).
// NOT for production. Run from nudgepay-app/ AFTER demo-seed.mjs (+ promises +
// phase8):  node scripts/demo-seed-email.mjs
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const env = Object.fromEntries(
  readFileSync(new URL("../.env.test", import.meta.url), "utf8")
    .split("\n").map((l) => l.trim())
    .filter((l) => l && !l.startsWith("#") && l.includes("="))
    .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; })
);
const svc = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const FROM_ADDRESS = "billing@chancey-demo.com";
const FROM_NAME = "Chancey Heating & Cooling";
// hoursAgo → ISO timestamp, for natural thread ordering.
const hoursAgo = (h) => { const d = new Date(); d.setHours(d.getHours() - h); return d.toISOString(); };

const { data: org } = await svc.from("organizations")
  .select("id").eq("name", "Chancey Heating & Cooling").single();
if (!org) { console.error("Run demo-seed.mjs first — Chancey org not found."); process.exit(1); }
const orgId = org.id;

const { data: users } = await svc.auth.admin.listUsers({ perPage: 1000 });
const ownerId = users.users.find((u) => u.email === "diskin@chancey.test").id;

const { data: customers } = await svc.from("customers")
  .select("id, name, email").eq("org_id", orgId);
const byName = Object.fromEntries(customers.map((c) => [c.name, c]));

const { data: invoices } = await svc.from("invoices")
  .select("id, qbo_doc_number, customer_id").eq("org_id", orgId);
const invByDoc = Object.fromEntries(invoices.map((i) => [i.qbo_doc_number, i]));

const { data: cases } = await svc.from("collection_cases")
  .select("id, customer_id").eq("org_id", orgId);
const caseByCustomer = Object.fromEntries(cases.map((c) => [c.customer_id, c.id]));

// --- email_config: turn workspace email ON ----------------------------------
const { error: ecErr } = await svc.from("email_config").upsert({
  org_id: orgId,
  email_enabled: true,
  from_address: FROM_ADDRESS,
  from_name: FROM_NAME,
  provider: "resend",
  postal_address: "1420 Industrial Pkwy, Suite 200, Sacramento, CA 95820",
  updated_at: new Date().toISOString(),
}, { onConflict: "org_id" });
if (ecErr) { console.error("email_config", ecErr); process.exit(1); }

// NOTE: preferred_channel is constrained to ('call','text') by 0017 — email is
// not yet a selectable *preferred* channel, only a real outbound channel. So we
// don't set it here; Summit leads the Email demo via its email thread below.

// --- Northgate: do_not_email too (already do_not_call) → full block demo -----
if (byName["Northgate Property Mgmt"]) {
  const { error: ngErr } = await svc.from("customers").update({ do_not_email: true })
    .eq("id", byName["Northgate Property Mgmt"].id);
  if (ngErr) { console.error("northgate do_not_email", ngErr); process.exit(1); }
}

// --- idempotency: clear any prior demo email rows in this org ----------------
await svc.from("email_messages").delete().eq("org_id", orgId)
  .like("provider_message_id", "demo-email-%");

function emailRow(custName, invoiceDoc, fields) {
  const cust = byName[custName];
  const inv = invoiceDoc ? invByDoc[invoiceDoc] : null;
  return {
    org_id: orgId,
    customer_id: cust.id,
    invoice_id: inv ? inv.id : null,
    case_id: caseByCustomer[cust.id] ?? null,
    ...fields,
  };
}

const rows = [
  // ── Summit ($675, #1063): outbound reminder → inbound reply → NEEDS REPLY ──
  emailRow("Summit Restaurant Group", "1063", {
    sent_by_user_id: ownerId, direction: "outbound", provider_message_id: "demo-email-1",
    status: "delivered", from_address: FROM_ADDRESS, to_address: byName["Summit Restaurant Group"].email,
    subject: "Past-due invoice #1063 — $675.00",
    body: "Hi Summit Restaurant Group,\n\nOur records show invoice #1063 for $675.00 is now past due. " +
      "You can reply directly to this email with any questions or to arrange payment.\n\nThank you,\nChancey Heating & Cooling",
    created_at: hoursAgo(52),
  }),
  emailRow("Summit Restaurant Group", "1063", {
    direction: "inbound", provider_message_id: "demo-email-2", status: null,
    from_address: byName["Summit Restaurant Group"].email, to_address: FROM_ADDRESS,
    subject: "Re: Past-due invoice #1063 — $675.00",
    body: "Thanks for the reminder — can you resend the itemized invoice? Our AP system flagged a mismatch on the service date.",
    created_at: hoursAgo(6),
  }),

  // ── Delgado ($9,320.50, #1051): outbound that BOUNCED → NEEDS ATTENTION ────
  emailRow("Delgado HVAC Supply", "1051", {
    sent_by_user_id: ownerId, direction: "outbound", provider_message_id: "demo-email-3",
    status: "bounced", error_code: "hard_bounce",
    from_address: FROM_ADDRESS, to_address: byName["Delgado HVAC Supply"].email,
    subject: "Payment reminder — invoice #1051 ($9,320.50)",
    body: "Hi Delgado HVAC Supply,\n\nThis is a reminder that invoice #1051 for $9,320.50 remains outstanding. " +
      "Please reply to arrange payment.\n\nThank you,\nChancey Heating & Cooling",
    created_at: hoursAgo(20),
  }),

  // ── Riverside: a DELIVERED email — this customer also has an SMS thread ────
  emailRow("Riverside Apartments LLC", "1042", {
    sent_by_user_id: ownerId, direction: "outbound", provider_message_id: "demo-email-4",
    status: "opened", from_address: FROM_ADDRESS, to_address: byName["Riverside Apartments LLC"].email,
    subject: "Copy of invoice #1042 as requested",
    body: "Hi Riverside Apartments,\n\nAttached is a copy of invoice #1042 for $4,850.00 as you requested over text. " +
      "Let us know if you need anything else.\n\nThank you,\nChancey Heating & Cooling",
    created_at: hoursAgo(2),
  }),
];

const { error: insErr } = await svc.from("email_messages").insert(rows);
if (insErr) { console.error("email_messages insert", insErr); process.exit(1); }

console.log(JSON.stringify({
  ok: true, orgId,
  emailConfig: { from: `${FROM_NAME} <${FROM_ADDRESS}>`, enabled: true },
  threads: {
    Summit: "needs-reply (outbound + inbound)",
    Delgado: "needs-attention (bounced)",
    Riverside: "delivered/opened (also has SMS — multi-channel)",
  },
  doNotEmail: "Northgate Property Mgmt",
}, null, 2));
