/**
 * Vitest globalSetup — runs ONCE before all test files.
 * Cleans the local Supabase DB so `npx vitest run` is reliable without a manual
 * `supabase db reset` first. Uses the service-role key from .env.test.
 */
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";
import { loadTestEnv } from "./load-env";

export async function setup() {
  const env = loadTestEnv();
  const svc = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
    db: { schema: "public" },
  });

  // TRUNCATE as Postgres (not PostgREST) so last-owner membership triggers
  // and the 1k-row REST delete cap cannot leave a dirty tenancy behind.
  const appRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
  const sqlPath = join(tmpdir(), "nudgepay-vitest-truncate.sql");
  writeFileSync(
    sqlPath,
    "truncate table public.organizations, public.oauth_states, public.cron_checkpoints, public.workspace_deletions restart identity cascade;\n",
  );
  execFileSync("npx", ["supabase", "db", "query", "--local", "--file", sqlPath], {
    cwd: appRoot,
    stdio: "pipe",
    shell: true,
  });

  // Delete auth users with test emails. Page — a full suite creates far more
  // than one listUsers page. TRUNCATE already dropped memberships.
  const toDelete: string[] = [];
  for (let page = 1; page <= 50; page++) {
    const { data, error } = await svc.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw error;
    const batch = data?.users ?? [];
    if (batch.length === 0) break;
    for (const u of batch) {
      if (u.email?.endsWith("@example.com") || u.email?.endsWith("@chancey.test")) {
        toDelete.push(u.id);
      }
    }
    if (batch.length < 200) break;
  }
  for (const id of toDelete) {
    await svc.auth.admin.deleteUser(id);
  }
}
