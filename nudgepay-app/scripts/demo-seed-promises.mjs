// Local-dev augmentation: add contact_logs (a broken promise, a due follow-up,
// a future promise) onto the Chancey demo org so Phase 5b's Activity timeline,
// "Follow-ups due" and "Broken promises" tiles/views render with real data.
// NOT for production. Run from nudgepay-app/ AFTER demo-seed.mjs:
//   node scripts/demo-seed-promises.mjs
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { dayOffset, findUserByEmail, seedDemoContactLogs } from "./seed-shared.mjs";

const env = Object.fromEntries(
  readFileSync(new URL("../.env.test", import.meta.url), "utf8")
    .split("\n").filter(Boolean).map((l) => {
      const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
    })
);
const svc = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const { data: org } = await svc.from("organizations")
  .select("id").eq("name", "Chancey Heating & Cooling").single();
const orgId = org.id;
const owner = await findUserByEmail(svc, "diskin@chancey.test");
if (!owner) throw new Error("demo owner not found — run demo-seed.mjs first");
const { data: invoices } = await svc.from("invoices")
  .select("id, qbo_doc_number, customer_id").eq("org_id", orgId);
await seedDemoContactLogs(svc, { orgId, ownerId: owner.id, invoices });

console.log(JSON.stringify({
  ok: true, orgId,
  brokenPromise: "1051 (Delgado, promised " + dayOffset(-5) + ")",
  followUpDue: "1058 (Northgate, follow-up " + dayOffset(0) + ")",
  futurePromise: "1042 (Riverside, promised " + dayOffset(3) + ")",
}, null, 2));
