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
import {
  DEMO_FROM_NAME,
  findUserByEmail,
  upsertDemoEmailConfig,
  seedDemoEmailMessages,
} from "./seed-shared.mjs";

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

const { data: org } = await svc.from("organizations")
  .select("id").eq("name", "Chancey Heating & Cooling").single();
if (!org) { console.error("Run demo-seed.mjs first — Chancey org not found."); process.exit(1); }
const orgId = org.id;

const owner = await findUserByEmail(svc, "diskin@chancey.test");
if (!owner) throw new Error("demo owner not found — run demo-seed.mjs first");
const ownerId = owner.id;

const { data: customers } = await svc.from("customers")
  .select("id, name, email").eq("org_id", orgId);
const byName = Object.fromEntries(customers.map((c) => [c.name, c]));

const { data: invoices } = await svc.from("invoices")
  .select("id, qbo_doc_number, customer_id").eq("org_id", orgId);

const { data: cases } = await svc.from("collection_cases")
  .select("id, customer_id").eq("org_id", orgId);
const caseByCustomer = Object.fromEntries(cases.map((c) => [c.customer_id, c.id]));

await upsertDemoEmailConfig(svc, { orgId, fromAddress: FROM_ADDRESS, fromName: DEMO_FROM_NAME });

const { error: delErr } = await svc.from("email_messages").delete().eq("org_id", orgId)
  .like("provider_message_id", "demo-email-%");
if (delErr) throw delErr;

await seedDemoEmailMessages(svc, {
  orgId, ownerId, fromAddress: FROM_ADDRESS, byName, invoices, caseByCustomer,
});

console.log(JSON.stringify({
  ok: true, orgId,
  emailConfig: { from: `${DEMO_FROM_NAME} <${FROM_ADDRESS}>`, enabled: true },
  threads: {
    Summit: "needs-reply (outbound + inbound)",
    Delgado: "needs-attention (bounced)",
    Riverside: "delivered/opened (also has SMS — multi-channel)",
  },
  doNotEmail: "Northgate Property Mgmt",
}, null, 2));
