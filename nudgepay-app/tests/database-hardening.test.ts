import { execFileSync } from "node:child_process";
import { unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";
import { makeUserClient, runLocalTestSql, serviceClient } from "./helpers";
import { parseLocalQueryRows } from "./local-query-json";

function queryLocalRows<T>(sql: string): T[] {
  const sqlPath = join(tmpdir(), `nudgepay-query-${crypto.randomUUID()}.sql`);
  writeFileSync(sqlPath, sql);
  try {
    const raw = execFileSync(
      "npx",
      ["supabase", "db", "query", "--local", "--file", sqlPath, "--output", "json"],
      { cwd: process.cwd(), encoding: "utf8", shell: true, stdio: ["ignore", "pipe", "pipe"] },
    );
    return parseLocalQueryRows<T>(raw);
  } finally {
    unlinkSync(sqlPath);
  }
}

test("internal helpers expose only the privileges their database callers need", () => {
  const helpers = queryLocalRows<{
    name: string;
    anon_execute: boolean;
    authenticated_execute: boolean;
  }>(`
    select p.proname as name,
           has_function_privilege('anon', p.oid, 'execute') as anon_execute,
           has_function_privilege('authenticated', p.oid, 'execute') as authenticated_execute
      from pg_catalog.pg_proc p
      join pg_catalog.pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname in ('is_org_member', 'is_org_owner', 'is_org_admin')
     order by p.proname;
  `);

  expect(helpers).toEqual([
    { name: "is_org_admin", anon_execute: false, authenticated_execute: true },
    { name: "is_org_member", anon_execute: false, authenticated_execute: true },
    { name: "is_org_owner", anon_execute: false, authenticated_execute: true },
  ]);

  const triggerPrivileges = queryLocalRows<{ exposed_count: number }>(`
    select count(*)::int as exposed_count
      from pg_catalog.pg_proc p
      join pg_catalog.pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname in (
         'set_updated_at',
         'prevent_member_customer_source_edits',
         'prevent_last_owner_exit',
         'prevent_inbound_stop_unlock',
         'protect_text_message_sender_identity',
         'prevent_member_promise_money_edits',
         'notify_message_event',
         'freeze_erased_customer_pii',
         'reject_write_on_erased_customer',
         'prevent_non_owner_role_change'
       )
       and (
         has_function_privilege('anon', p.oid, 'execute')
         or has_function_privilege('authenticated', p.oid, 'execute')
       );
  `);
  expect(triggerPrivileges).toEqual([{ exposed_count: 0 }]);

  const paths = queryLocalRows<{ name: string; pinned: boolean }>(`
    select p.proname as name,
           coalesce(array_to_string(p.proconfig, ','), '') like '%search_path=""%' as pinned
      from pg_catalog.pg_proc p
      join pg_catalog.pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname in ('phone_last10', 'normalize_email', 'set_updated_at')
     order by p.proname;
  `);
  expect(paths).toEqual([
    { name: "normalize_email", pinned: true },
    { name: "phone_last10", pinned: true },
    { name: "set_updated_at", pinned: true },
  ]);

  const membershipUpdates = queryLocalRows<{
    role_update: boolean;
    org_update: boolean;
    user_update: boolean;
  }>(`
    select has_column_privilege('authenticated', 'public.memberships', 'role', 'update') as role_update,
           has_column_privilege('authenticated', 'public.memberships', 'org_id', 'update') as org_update,
           has_column_privilege('authenticated', 'public.memberships', 'user_id', 'update') as user_update;
  `);
  expect(membershipUpdates).toEqual([{
    role_update: true,
    org_update: false,
    user_update: false,
  }]);
}, 20_000);

test("optimized own-row policies preserve case presence, notification, and thread-read RLS", async () => {
  const svc = serviceClient();
  const a = await makeUserClient(`hardening-a-${Math.random()}@example.com`);
  const b = await makeUserClient(`hardening-b-${Math.random()}@example.com`);
  const { data: org } = await svc.from("organizations")
    .insert({ name: `Hardening RLS ${Math.random()}` }).select("id").single();
  const orgId = org!.id as string;
  await svc.from("memberships").insert([
    { org_id: orgId, user_id: a.userId, role: "owner" },
    { org_id: orgId, user_id: b.userId, role: "member" },
  ]);
  const { data: customer } = await svc.from("customers")
    .insert({ org_id: orgId, name: "Hardening customer" }).select("id").single();
  const customerId = customer!.id as string;

  const ownPresence = await a.client.from("case_presence").insert({
    org_id: orgId,
    customer_id: customerId,
    user_id: a.userId,
  });
  expect(ownPresence.error).toBeNull();
  const spoofedPresence = await a.client.from("case_presence").insert({
    org_id: orgId,
    customer_id: customerId,
    user_id: b.userId,
  });
  expect(spoofedPresence.error).not.toBeNull();
  const ownPresenceUpdate = await a.client.from("case_presence")
    .update({ last_seen_at: new Date().toISOString() })
    .eq("org_id", orgId).eq("customer_id", customerId).eq("user_id", a.userId)
    .select("user_id");
  expect(ownPresenceUpdate.error).toBeNull();
  expect(ownPresenceUpdate.data).toEqual([{ user_id: a.userId }]);
  const spoofedPresenceUpdate = await a.client.from("case_presence")
    .update({ user_id: b.userId })
    .eq("org_id", orgId).eq("customer_id", customerId).eq("user_id", a.userId)
    .select("user_id");
  expect(spoofedPresenceUpdate.error).not.toBeNull();
  const foreignPresenceUpdate = await b.client.from("case_presence")
    .update({ last_seen_at: new Date().toISOString() })
    .eq("org_id", orgId).eq("customer_id", customerId).eq("user_id", a.userId)
    .select("user_id");
  expect(foreignPresenceUpdate.error).toBeNull();
  expect(foreignPresenceUpdate.data ?? []).toHaveLength(0);

  const ownPrefs = await a.client.from("user_notification_prefs").insert({
    org_id: orgId,
    user_id: a.userId,
    broken_promise_email: true,
    daily_digest_email: true,
  });
  expect(ownPrefs.error).toBeNull();
  const spoofedPrefs = await a.client.from("user_notification_prefs").insert({
    org_id: orgId,
    user_id: b.userId,
    broken_promise_email: false,
    daily_digest_email: false,
  });
  expect(spoofedPrefs.error).not.toBeNull();
  const ownPrefsUpdate = await a.client.from("user_notification_prefs")
    .update({ daily_digest_email: false })
    .eq("org_id", orgId).eq("user_id", a.userId)
    .select("user_id, daily_digest_email");
  expect(ownPrefsUpdate.error).toBeNull();
  expect(ownPrefsUpdate.data).toEqual([{ user_id: a.userId, daily_digest_email: false }]);
  const prefsSeenByB = await b.client.from("user_notification_prefs")
    .select("user_id").eq("org_id", orgId);
  expect(prefsSeenByB.error).toBeNull();
  expect(prefsSeenByB.data ?? []).toHaveLength(0);

  const ownThreadRead = await a.client.from("thread_reads").insert({
    org_id: orgId,
    user_id: a.userId,
    customer_id: customerId,
    channel: "email",
  });
  expect(ownThreadRead.error).toBeNull();
  const spoofedThreadRead = await a.client.from("thread_reads").insert({
    org_id: orgId,
    user_id: b.userId,
    customer_id: customerId,
    channel: "sms",
  });
  expect(spoofedThreadRead.error).not.toBeNull();
  const ownThreadUpdate = await a.client.from("thread_reads")
    .update({ last_read_at: new Date().toISOString() })
    .eq("org_id", orgId).eq("user_id", a.userId)
    .eq("customer_id", customerId).eq("channel", "email")
    .select("user_id");
  expect(ownThreadUpdate.error).toBeNull();
  expect(ownThreadUpdate.data).toEqual([{ user_id: a.userId }]);
  const readsSeenByB = await b.client.from("thread_reads")
    .select("user_id").eq("org_id", orgId);
  expect(readsSeenByB.error).toBeNull();
  expect(readsSeenByB.data ?? []).toHaveLength(0);
});

test("authenticated membership writes recheck stale admin and target-role snapshots", async () => {
  const svc = serviceClient();
  const owner = await makeUserClient(`hardening-owner-${Math.random()}@example.com`);
  const admin = await makeUserClient(`hardening-admin-${Math.random()}@example.com`);
  const target = await makeUserClient(`hardening-target-${Math.random()}@example.com`);
  const { data: org } = await svc.from("organizations")
    .insert({ name: `Hardening roles ${Math.random()}` }).select("id").single();
  const orgId = org!.id as string;
  await svc.from("memberships").insert([
    { org_id: orgId, user_id: owner.userId, role: "owner" },
    { org_id: orgId, user_id: admin.userId, role: "admin" },
    { org_id: orgId, user_id: target.userId, role: "member" },
  ]);

  // Model an action that already resolved the actor as admin, then lost that
  // role before the write. Current RLS must turn the mutation into zero rows.
  await svc.from("memberships").update({ role: "member" })
    .eq("org_id", orgId).eq("user_id", admin.userId);
  const staleAdminWrite = await admin.client.from("memberships")
    .update({ role: "admin" })
    .eq("org_id", orgId).eq("user_id", target.userId)
    .select("user_id");
  expect(staleAdminWrite.error).toBeNull();
  expect(staleAdminWrite.data ?? []).toHaveLength(0);

  // Model a target read as member followed by promotion before delete. Once
  // the actor is admin again, the trigger still prevents deleting an owner.
  await svc.from("memberships").update({ role: "admin" })
    .eq("org_id", orgId).eq("user_id", admin.userId);
  await svc.from("memberships").update({ role: "owner" })
    .eq("org_id", orgId).eq("user_id", target.userId);
  const promotedOwnerDelete = await admin.client.from("memberships")
    .delete().eq("org_id", orgId).eq("user_id", target.userId)
    .select("user_id");
  expect(promotedOwnerDelete.error).not.toBeNull();
  const { data: targetAfter } = await svc.from("memberships")
    .select("role").eq("org_id", orgId).eq("user_id", target.userId).single();
  expect(targetAfter?.role).toBe("owner");
});

test("authenticated admins cannot rewrite membership identity or move the last owner", async () => {
  const svc = serviceClient();
  const admin = await makeUserClient(`hardening-identity-admin-${Math.random()}@example.com`);
  const ownerA = await makeUserClient(`hardening-identity-owner-a-${Math.random()}@example.com`);
  const ownerB = await makeUserClient(`hardening-identity-owner-b-${Math.random()}@example.com`);
  const replacement = await makeUserClient(`hardening-identity-replacement-${Math.random()}@example.com`);
  const { data: orgA } = await svc.from("organizations")
    .insert({ name: `Hardening identity A ${Math.random()}` }).select("id").single();
  const { data: orgB } = await svc.from("organizations")
    .insert({ name: `Hardening identity B ${Math.random()}` }).select("id").single();
  const orgAId = orgA!.id as string;
  const orgBId = orgB!.id as string;
  await svc.from("memberships").insert([
    { org_id: orgAId, user_id: ownerA.userId, role: "owner" },
    { org_id: orgAId, user_id: admin.userId, role: "admin" },
    { org_id: orgBId, user_id: ownerB.userId, role: "owner" },
    { org_id: orgBId, user_id: admin.userId, role: "admin" },
  ]);

  const moveOwner = await admin.client.from("memberships")
    .update({ org_id: orgBId })
    .eq("org_id", orgAId).eq("user_id", ownerA.userId)
    .select("org_id, user_id");
  expect(moveOwner.error).not.toBeNull();

  const replaceOwner = await admin.client.from("memberships")
    .update({ user_id: replacement.userId })
    .eq("org_id", orgAId).eq("user_id", ownerA.userId)
    .select("org_id, user_id");
  expect(replaceOwner.error).not.toBeNull();

  const { data: ownersA } = await svc.from("memberships")
    .select("user_id").eq("org_id", orgAId).eq("role", "owner");
  expect(ownersA).toEqual([{ user_id: ownerA.userId }]);
  const { data: moved } = await svc.from("memberships")
    .select("org_id, user_id").eq("org_id", orgBId).eq("user_id", ownerA.userId);
  expect(moved ?? []).toHaveLength(0);
});

test("concurrent owner exits serialize and leave one owner", async () => {
  const svc = serviceClient();
  const a = await makeUserClient(`hardening-exit-a-${Math.random()}@example.com`);
  const b = await makeUserClient(`hardening-exit-b-${Math.random()}@example.com`);
  const { data: org } = await svc.from("organizations")
    .insert({ name: `Hardening exits ${Math.random()}` }).select("id").single();
  const orgId = org!.id as string;
  await svc.from("memberships").insert([
    { org_id: orgId, user_id: a.userId, role: "owner" },
    { org_id: orgId, user_id: b.userId, role: "owner" },
  ]);

  // This after-trigger delay makes the old write-skew deterministic: without
  // the organization-row lock, both before-triggers count the other owner
  // before either transaction commits.
  runLocalTestSql(`
    create or replace function public.zz_test_delay_owner_exit()
    returns trigger language plpgsql set search_path = '' as $$
    begin
      perform pg_catalog.pg_sleep(0.75);
      return old;
    end;
    $$;
  `);
  runLocalTestSql("drop trigger if exists zz_test_delay_owner_exit on public.memberships;");
  runLocalTestSql(`
    create trigger zz_test_delay_owner_exit
      after delete on public.memberships
      for each row execute function public.zz_test_delay_owner_exit();
  `);

  try {
    const results = await Promise.all([
      a.client.from("memberships").delete()
        .eq("org_id", orgId).eq("user_id", a.userId).select("user_id"),
      b.client.from("memberships").delete()
        .eq("org_id", orgId).eq("user_id", b.userId).select("user_id"),
    ]);
    expect(results.filter((result) => !result.error && result.data?.length === 1)).toHaveLength(1);
    expect(results.filter((result) => result.error)).toHaveLength(1);

    const { data: remaining, error } = await svc.from("memberships")
      .select("user_id, role").eq("org_id", orgId);
    expect(error).toBeNull();
    expect(remaining).toHaveLength(1);
    expect(remaining?.[0].role).toBe("owner");
  } finally {
    runLocalTestSql("drop trigger if exists zz_test_delay_owner_exit on public.memberships;");
    runLocalTestSql("drop function if exists public.zz_test_delay_owner_exit();");
  }
}, 20_000);

test("workspace deletion and concurrent offboarding use one lock order", async () => {
  const svc = serviceClient();
  const ownerA = await makeUserClient(`hardening-delete-a-${Math.random()}@example.com`);
  const ownerB = await makeUserClient(`hardening-delete-b-${Math.random()}@example.com`);
  const orgName = `Hardening delete ${Math.random()}`;
  const { data: org } = await svc.from("organizations")
    .insert({ name: orgName }).select("id").single();
  const orgId = org!.id as string;
  await svc.from("memberships").insert([
    { org_id: orgId, user_id: ownerA.userId, role: "owner" },
    { org_id: orgId, user_id: ownerB.userId, role: "owner" },
  ]);

  runLocalTestSql(`
    create or replace function public.aaa_test_delay_membership_delete()
    returns trigger language plpgsql set search_path = '' as $$
    begin
      if old.org_id = '${orgId}'::uuid and old.user_id = '${ownerA.userId}'::uuid then
        perform pg_catalog.pg_sleep(0.75);
      end if;
      return old;
    end;
    $$;
  `);
  runLocalTestSql("drop trigger if exists aaa_test_delay_membership_delete on public.memberships;");
  runLocalTestSql(`
    create trigger aaa_test_delay_membership_delete
      before delete on public.memberships
      for each row execute function public.aaa_test_delay_membership_delete();
  `);

  try {
    const offboard = Promise.resolve(
      svc.from("memberships").delete()
        .eq("org_id", orgId).eq("user_id", ownerA.userId).select("user_id"),
    );
    await new Promise((resolve) => setTimeout(resolve, 150));
    const workspaceDelete = svc.rpc("delete_workspace", {
      p_org_id: orgId,
      p_deleted_by: ownerB.userId,
      p_org_name: orgName,
      p_member_count: 2,
    });

    const [offboardResult, deleteResult] = await Promise.all([offboard, workspaceDelete]);
    expect(offboardResult.error?.code).not.toBe("40P01");
    expect(deleteResult.error?.code).not.toBe("40P01");
    expect(offboardResult.error).toBeNull();
    expect(deleteResult.error).toBeNull();

    const { data: remaining } = await svc.from("organizations").select("id").eq("id", orgId);
    expect(remaining ?? []).toHaveLength(0);
  } finally {
    runLocalTestSql("drop trigger if exists aaa_test_delay_membership_delete on public.memberships;");
    runLocalTestSql("drop function if exists public.aaa_test_delay_membership_delete();");
  }
}, 20_000);

test("workspace deletion waits for a provider reservation and then fails closed", async () => {
  const svc = serviceClient();
  const owner = await makeUserClient(`hardening-provider-race-${Math.random()}@example.com`);
  const orgName = `Hardening provider race ${Math.random()}`;
  const { data: org, error: orgError } = await svc.from("organizations")
    .insert({ name: orgName }).select("id").single();
  expect(orgError).toBeNull();
  const orgId = org!.id as string;
  const { error: membershipError } = await svc.from("memberships").insert({
    org_id: orgId,
    user_id: owner.userId,
    role: "owner",
  });
  expect(membershipError).toBeNull();

  runLocalTestSql(`
    create or replace function public.zz_test_delay_checkout_reservation()
    returns trigger language plpgsql set search_path = '' as $$
    begin
      if new.org_id = '${orgId}'::uuid then
        perform pg_catalog.pg_sleep(0.75);
      end if;
      return new;
    end;
    $$;
  `);
  runLocalTestSql("drop trigger if exists zz_test_delay_checkout_reservation on public.billing_checkout_attempts;");
  runLocalTestSql(`
    create trigger zz_test_delay_checkout_reservation
      after insert on public.billing_checkout_attempts
      for each row execute function public.zz_test_delay_checkout_reservation();
  `);

  try {
    const reservation = Promise.resolve(svc.rpc("reserve_billing_checkout", {
      p_org_id: orgId,
      p_user_id: owner.userId,
    }));
    await new Promise((resolve) => setTimeout(resolve, 150));
    const deletion = Promise.resolve(svc.rpc("delete_workspace", {
      p_org_id: orgId,
      p_deleted_by: owner.userId,
      p_org_name: orgName,
      p_member_count: 1,
    }));

    const [reservationResult, deletionResult] = await Promise.all([reservation, deletion]);
    expect(reservationResult.error).toBeNull();
    expect(deletionResult.error?.code).toBe("PT409");
    expect(deletionResult.error?.message).toMatch(/pending provider work/i);
    const { data: orgStillExists } = await svc.from("organizations")
      .select("id").eq("id", orgId);
    expect(orgStillExists ?? []).toHaveLength(1);
    const { data: attempt } = await svc.from("billing_checkout_attempts")
      .select("state").eq("org_id", orgId).single();
    expect(attempt?.state).toBe("reserved");
  } finally {
    runLocalTestSql("drop trigger if exists zz_test_delay_checkout_reservation on public.billing_checkout_attempts;");
    runLocalTestSql("drop function if exists public.zz_test_delay_checkout_reservation();");
  }
}, 20_000);
