/**
 * Vitest globalSetup — runs ONCE before all test files.
 * Cleans the local Supabase DB so `npx vitest run` is reliable without a manual
 * `supabase db reset` first. Uses the service-role key from .env.test.
 */
import { createClient } from "@supabase/supabase-js";
import { loadTestEnv } from "./load-env";

export async function setup() {
  const env = loadTestEnv();
  const svc = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
    db: { schema: "public" },
  });

  // Delete auth users with test emails first (FK cascade removes memberships too,
  // but we still truncate public tables for thoroughness).
  const { data: users } = await svc.auth.admin.listUsers({ perPage: 1000 });
  if (users?.users?.length) {
    const testUsers = users.users.filter(
      (u) =>
        u.email?.endsWith("@example.com") ||
        u.email?.endsWith("@chancey.test")
    );
    for (const u of testUsers) {
      await svc.auth.admin.deleteUser(u.id);
    }
  }

  // Table-by-table delete in dependency order; service role bypasses RLS.
  await svc.from("inbound_orphans").delete().neq("id", "00000000-0000-0000-0000-000000000000");
  await svc.from("invites").delete().neq("id", "00000000-0000-0000-0000-000000000000");
  await svc.from("contact_logs").delete().neq("id", "00000000-0000-0000-0000-000000000000");
  await svc.from("text_messages").delete().neq("id", "00000000-0000-0000-0000-000000000000");
  await svc.from("email_messages").delete().neq("id", "00000000-0000-0000-0000-000000000000");
  await svc.from("promise_invoices").delete().neq("org_id", "00000000-0000-0000-0000-000000000000");
  await svc.from("promises").delete().neq("id", "00000000-0000-0000-0000-000000000000");
  await svc.from("payments").delete().neq("id", "00000000-0000-0000-0000-000000000000");
  await svc.from("case_presence").delete().neq("org_id", "00000000-0000-0000-0000-000000000000");
  await svc.from("collection_cases").delete().neq("id", "00000000-0000-0000-0000-000000000000");
  await svc.from("qbo_connections").delete().neq("id", "00000000-0000-0000-0000-000000000000");
  await svc.from("messaging_config").delete().neq("id", "00000000-0000-0000-0000-000000000000");
  await svc.from("sms_sender_inventory").delete().neq("org_id", "00000000-0000-0000-0000-000000000000");
  await svc.from("invoices").delete().neq("id", "00000000-0000-0000-0000-000000000000");
  await svc.from("customers").delete().neq("id", "00000000-0000-0000-0000-000000000000");
  await svc.from("memberships").delete().neq("id", "00000000-0000-0000-0000-000000000000");
  await svc.from("sync_errors").delete().neq("id", "00000000-0000-0000-0000-000000000000");
  await svc.from("oauth_states").delete().neq("state", "");
  await svc.from("cron_checkpoints").delete().neq("job", "");
  await svc.from("organizations").delete().neq("id", "00000000-0000-0000-0000-000000000000");
}
