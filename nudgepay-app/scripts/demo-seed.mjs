// Local-dev demo seed for UI review. NOT for production.
// Repopulates the Chancey org (wiped by the test suite) with an owner login,
// customers, past-due invoices, and one SMS thread so the dashboard + invoice
// thread render with realistic data.
//
// Run from nudgepay-app/:  node scripts/demo-seed.mjs
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import {
  findUserByEmail,
  ensureOrg,
  ensureMembership,
  upsertDemoQboChrome,
  seedDemoWorklist,
} from "./seed-shared.mjs";

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

async function ensureOwner() {
  const existing = await findUserByEmail(svc, OWNER_EMAIL);
  if (existing) return existing.id;
  const { data, error } = await svc.auth.admin.createUser({
    email: OWNER_EMAIL, password: OWNER_PASSWORD, email_confirm: true,
  });
  if (error) throw error;
  return data.user.id;
}

async function main() {
  const ownerId = await ensureOwner();
  // seed.sql already creates Chancey + an owner membership. Deleting the org
  // trips memberships_prevent_last_owner — reuse the org and wipe work items.
  const orgId = await ensureOrg(svc, "Chancey Heating & Cooling");
  await ensureMembership(svc, orgId, ownerId);
  await upsertDemoQboChrome(svc, orgId, "demo-realm-123");
  const { customers, invoices } = await seedDemoWorklist(svc, { orgId, ownerId });
  console.log(JSON.stringify({
    ok: true, orgId, ownerEmail: OWNER_EMAIL,
    customers: customers.length, invoices: invoices.length, threadInvoice: "1042",
  }, null, 2));
}

main().catch((e) => { console.error(e); process.exit(1); });
