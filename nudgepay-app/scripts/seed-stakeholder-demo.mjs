// Stakeholder demo workspace. Idempotent. Does not touch other orgs.
// Requires SUPABASE_URL + SUPABASE_SERVICE_KEY (production service role)
// and DEMO_PASSWORD (no default — never publish a production login secret).
//
//   DEMO_PASSWORD='…' node scripts/seed-stakeholder-demo.mjs
import { createClient } from "@supabase/supabase-js";
import {
  findUserByEmail,
  ensureOrg,
  ensureMembership,
  upsertDemoQboChrome,
  upsertDemoMessagingConfig,
  upsertDemoEmailConfig,
  seedDemoWorklist,
  seedDemoContactLogs,
  seedDemoEmailMessages,
} from "./seed-shared.mjs";

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_KEY;
if (!url || !key) {
  console.error("Set SUPABASE_URL and SUPABASE_SERVICE_KEY");
  process.exit(1);
}

const OWNER_EMAIL = process.env.DEMO_EMAIL || "demo@nudgepay-ar.app";
const OWNER_PASSWORD = process.env.DEMO_PASSWORD;
if (!OWNER_PASSWORD) {
  console.error("Set DEMO_PASSWORD (required; this script has no default password)");
  process.exit(1);
}

const ORG_NAME = "Chancey Heating & Cooling (Demo)";
const FROM_ADDRESS = "billing@chancey-demo.test";

const svc = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

async function ensureOwner() {
  const existing = await findUserByEmail(svc, OWNER_EMAIL);
  if (existing) {
    const { error } = await svc.auth.admin.updateUserById(existing.id, {
      password: OWNER_PASSWORD, email_confirm: true,
    });
    if (error) throw error;
    return existing.id;
  }
  const { data, error } = await svc.auth.admin.createUser({
    email: OWNER_EMAIL, password: OWNER_PASSWORD, email_confirm: true,
    user_metadata: { display_name: "Demo Owner" },
  });
  if (!error) return data.user.id;
  const raced = await findUserByEmail(svc, OWNER_EMAIL);
  if (!raced) throw error;
  const { error: upErr } = await svc.auth.admin.updateUserById(raced.id, {
    password: OWNER_PASSWORD, email_confirm: true,
  });
  if (upErr) throw upErr;
  return raced.id;
}

async function main() {
  const ownerId = await ensureOwner();
  const orgId = await ensureOrg(svc, ORG_NAME);
  await ensureMembership(svc, orgId, ownerId);
  await upsertDemoQboChrome(svc, orgId, "demo-not-intuit");
  await upsertDemoMessagingConfig(svc, orgId);
  await upsertDemoEmailConfig(svc, { orgId, fromAddress: FROM_ADDRESS });

  const { customers, invoices, byName, caseByCustomer } = await seedDemoWorklist(svc, {
    orgId, ownerId,
    customerExtras: { "Northgate Property Mgmt": { do_not_email: true } },
  });
  await seedDemoContactLogs(svc, { orgId, ownerId, invoices });
  await seedDemoEmailMessages(svc, {
    orgId, ownerId, fromAddress: FROM_ADDRESS, byName, invoices, caseByCustomer,
  });

  console.log(JSON.stringify({
    ok: true,
    url: "https://nudgepay.9thlevelsoftware.com/login",
    stagingUrl: "https://nudgepay-app-staging.dasblueeyeddevil.workers.dev/login",
    org: ORG_NAME,
    email: OWNER_EMAIL,
    customers: customers.length,
    invoices: invoices.length,
  }, null, 2));
}

main().catch((e) => { console.error(e); process.exit(1); });
