// Local-dev augmentation: add contact_logs (a broken promise, a due follow-up,
// a future promise) onto the Chancey demo org so Phase 5b's Activity timeline,
// "Follow-ups due" and "Broken promises" tiles/views render with real data.
// NOT for production. Run from nudgepay-app/ AFTER demo-seed.mjs:
//   node scripts/demo-seed-promises.mjs
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

function dayOffset(n) { const d = new Date(); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); }

const { data: org } = await svc.from("organizations")
  .select("id").eq("name", "Chancey Heating & Cooling").single();
const orgId = org.id;
const { data: owner } = await svc.auth.admin.listUsers({ perPage: 1000 });
const ownerId = owner.users.find((u) => u.email === "diskin@chancey.test").id;
const { data: invoices } = await svc.from("invoices")
  .select("id, qbo_doc_number, customer_id").eq("org_id", orgId);
const byDoc = Object.fromEntries(invoices.map((i) => [i.qbo_doc_number, i]));

const rows = [
  // #1051 Delgado $9,320.50 — BROKEN promise (promised in the past, still unpaid).
  {
    invoice: "1051", method: "call", outcome: "promise-to-pay",
    notes: "Spoke with Maria in AP — promised to mail a check.",
    promised_amount: 9320.50, promised_date: dayOffset(-5), follow_up_at: null,
  },
  // #1058 Northgate $2,740 — FOLLOW-UP due today (no commitment yet).
  {
    invoice: "1058", method: "call", outcome: "no-answer",
    notes: "Left voicemail for accounts dept. Try again.",
    promised_amount: null, promised_date: null, follow_up_at: dayOffset(0),
  },
  // #1042 Riverside $4,850 — FUTURE promise (not broken) + clears never-contacted.
  {
    invoice: "1042", method: "text", outcome: "promise-to-pay",
    notes: "Confirmed via SMS — check going out Friday.",
    promised_amount: 4850.00, promised_date: dayOffset(3), follow_up_at: dayOffset(3),
  },
];

for (const r of rows) {
  const inv = byDoc[r.invoice];
  const { error } = await svc.from("contact_logs").insert({
    org_id: orgId, invoice_id: inv.id, customer_id: inv.customer_id, user_id: ownerId,
    method: r.method, outcome: r.outcome, notes: r.notes,
    promised_amount: r.promised_amount, promised_date: r.promised_date, follow_up_at: r.follow_up_at,
  });
  if (error) { console.error(r.invoice, error); process.exit(1); }
}

console.log(JSON.stringify({
  ok: true, orgId,
  brokenPromise: "1051 (Delgado, promised " + dayOffset(-5) + ")",
  followUpDue: "1058 (Northgate, follow-up " + dayOffset(0) + ")",
  futurePromise: "1042 (Riverside, promised " + dayOffset(3) + ")",
}, null, 2));
