import { createClient, type SupabaseClient, type User } from "@supabase/supabase-js";
import { E2E_IDS, E2E_LABELS, E2E_PASSWORD, E2E_USERS } from "./seed-data";
import { loadLocalE2EEnv, requireHealthyLocalSupabase } from "./local-env";
import { acquireLocalDbHarnessLock, hasLocalDbHarnessLockToken } from "../../scripts/local-db-harness-lock.mjs";

function isoDate(daysFromToday: number): string {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + daysFromToday);
  return date.toISOString().slice(0, 10);
}

async function must<T>(label: string, promise: PromiseLike<{ data: T; error: { message: string } | null }>): Promise<T> {
  const { data, error } = await promise;
  if (error) throw new Error(`${label}: ${error.message}`);
  return data;
}

async function listAllUsers(service: SupabaseClient): Promise<User[]> {
  const users: User[] = [];
  for (let page = 1; page <= 20; page += 1) {
    const { data, error } = await service.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw new Error(`list local auth users: ${error.message}`);
    users.push(...data.users);
    if (data.users.length < 200) break;
  }
  return users;
}

async function cleanPreviousRun(service: SupabaseClient): Promise<void> {
  const { data: orgs, error: orgError } = await service
    .from("organizations")
    .select("id, name")
    .in("id", [E2E_IDS.primaryOrg, E2E_IDS.otherOrg]);
  if (orgError) throw new Error(`find previous E2E tenants: ${orgError.message}`);

  for (const org of orgs ?? []) {
    const { data: members, error: memberError } = await service
      .from("memberships")
      .select("user_id, role")
      .eq("org_id", org.id);
    if (memberError) throw new Error(`find previous E2E tenant owner: ${memberError.message}`);
    const owner = members?.find((member) => member.role === "owner");
    if (!owner) {
      const { error } = await service.from("organizations").delete().eq("id", org.id);
      if (error) throw new Error(`delete partial E2E tenant: ${error.message}`);
      continue;
    }
    const { error } = await service.rpc("delete_workspace", {
      p_org_id: org.id,
      p_deleted_by: owner.user_id,
      p_org_name: org.name,
      p_member_count: members?.length ?? 0,
    });
    if (error) throw new Error(`delete previous E2E tenant: ${error.message}`);
  }

  const e2eEmails = new Set(Object.values(E2E_USERS).map((entry) => entry.email));
  for (const user of await listAllUsers(service)) {
    if (!user.email || !e2eEmails.has(user.email)) continue;
    const { error } = await service.auth.admin.deleteUser(user.id);
    if (error) throw new Error(`delete previous local E2E auth user ${user.email}: ${error.message}`);
  }
}

async function createUser(service: SupabaseClient, email: string, label: string): Promise<User> {
  const { data, error } = await service.auth.admin.createUser({
    email,
    password: E2E_PASSWORD,
    email_confirm: true,
    user_metadata: { display_name: label },
  });
  if (error || !data.user) throw new Error(`create local E2E auth user ${email}: ${error?.message ?? "missing user"}`);
  return data.user;
}

async function seed(service: SupabaseClient): Promise<void> {
  const owner = await createUser(service, E2E_USERS.owner.email, E2E_USERS.owner.label);
  const admin = await createUser(service, E2E_USERS.admin.email, E2E_USERS.admin.label);
  const member = await createUser(service, E2E_USERS.member.email, E2E_USERS.member.label);
  const outsider = await createUser(service, E2E_USERS.outsider.email, E2E_USERS.outsider.label);

  await must("insert E2E tenants", service.from("organizations").insert([
    { id: E2E_IDS.primaryOrg, name: E2E_LABELS.primaryOrg },
    { id: E2E_IDS.otherOrg, name: E2E_LABELS.otherOrg },
  ]));
  await must("insert E2E memberships", service.from("memberships").insert([
    { org_id: E2E_IDS.primaryOrg, user_id: owner.id, role: E2E_USERS.owner.role },
    { org_id: E2E_IDS.primaryOrg, user_id: admin.id, role: E2E_USERS.admin.role },
    { org_id: E2E_IDS.primaryOrg, user_id: member.id, role: E2E_USERS.member.role },
    { org_id: E2E_IDS.otherOrg, user_id: outsider.id, role: E2E_USERS.outsider.role },
  ]));

  await must("insert fake E2E QBO connections", service.from("qbo_connections").insert([
    { org_id: E2E_IDS.primaryOrg, realm_id: "e2e-primary-fake", status: "connected", last_sync_at: new Date().toISOString() },
    { org_id: E2E_IDS.otherOrg, realm_id: "e2e-other-fake", status: "connected", last_sync_at: new Date().toISOString() },
  ]));
  await must("disable E2E outbound messaging", service.from("messaging_config").insert([
    { org_id: E2E_IDS.primaryOrg, sms_enabled: false },
    { org_id: E2E_IDS.otherOrg, sms_enabled: false },
  ]));
  await must("disable E2E outbound email", service.from("email_config").insert([
    { org_id: E2E_IDS.primaryOrg, email_enabled: false },
    { org_id: E2E_IDS.otherOrg, email_enabled: false },
  ]));

  await must("insert E2E customers", service.from("customers").insert([
    { id: E2E_IDS.mutationCustomer, org_id: E2E_IDS.primaryOrg, qbo_id: "e2e-customer-mutation", name: E2E_LABELS.mutationCustomer, email: "ap@beacon-e2e.local", phone: "+15005550101", sms_consent: true, owner: owner.id },
    { id: E2E_IDS.promiseCustomer, org_id: E2E_IDS.primaryOrg, qbo_id: "e2e-customer-promise", name: E2E_LABELS.promiseCustomer, email: "ap@copper-ridge-e2e.local", phone: "+15005550102", sms_consent: true, owner: admin.id },
    { id: E2E_IDS.messageCustomer, org_id: E2E_IDS.primaryOrg, qbo_id: "e2e-customer-message", name: E2E_LABELS.messageCustomer, email: "ap@delta-e2e.local", phone: "+15005550103", sms_consent: true, owner: member.id },
    { id: E2E_IDS.otherCustomer, org_id: E2E_IDS.otherOrg, qbo_id: "e2e-other-secret", name: E2E_LABELS.otherCustomer, email: "secret@other-e2e.local", phone: "+15005550999", sms_consent: true, owner: outsider.id },
  ]));

  await must("insert E2E invoices", service.from("invoices").insert([
    { id: E2E_IDS.mutationInvoice, org_id: E2E_IDS.primaryOrg, qbo_id: "e2e-invoice-mutation", qbo_doc_number: "E2E-1001", customer_id: E2E_IDS.mutationCustomer, amount: 1250, balance: 1250, due_date: isoDate(-45), invoice_date: isoDate(-75), status: "overdue", qbo_sync_at: new Date().toISOString() },
    { id: E2E_IDS.promiseInvoice, org_id: E2E_IDS.primaryOrg, qbo_id: "e2e-invoice-promise", qbo_doc_number: "E2E-1002", customer_id: E2E_IDS.promiseCustomer, amount: 2400, balance: 2400, due_date: isoDate(-32), invoice_date: isoDate(-62), status: "overdue", qbo_sync_at: new Date().toISOString() },
    { id: E2E_IDS.messageInvoice, org_id: E2E_IDS.primaryOrg, qbo_id: "e2e-invoice-message", qbo_doc_number: "E2E-1003", customer_id: E2E_IDS.messageCustomer, amount: 875, balance: 875, due_date: isoDate(-18), invoice_date: isoDate(-48), status: "overdue", qbo_sync_at: new Date().toISOString() },
    { id: E2E_IDS.otherInvoice, org_id: E2E_IDS.otherOrg, qbo_id: "e2e-other-invoice", qbo_doc_number: "E2E-X-999", customer_id: E2E_IDS.otherCustomer, amount: 9999, balance: 9999, due_date: isoDate(-60), invoice_date: isoDate(-90), status: "overdue", qbo_sync_at: new Date().toISOString() },
  ]));

  await must("insert E2E collection cases", service.from("collection_cases").insert([
    { id: E2E_IDS.mutationCase, org_id: E2E_IDS.primaryOrg, customer_id: E2E_IDS.mutationCustomer, status: "new", next_action_type: "contact", next_action_at: isoDate(0) },
    { id: E2E_IDS.promiseCase, org_id: E2E_IDS.primaryOrg, customer_id: E2E_IDS.promiseCustomer, status: "promised", next_action_type: "promise", next_action_at: isoDate(7) },
    { id: E2E_IDS.messageCase, org_id: E2E_IDS.primaryOrg, customer_id: E2E_IDS.messageCustomer, status: "working", next_action_type: "follow_up", next_action_at: isoDate(2) },
    { id: E2E_IDS.otherCase, org_id: E2E_IDS.otherOrg, customer_id: E2E_IDS.otherCustomer, status: "new", next_action_type: "contact", next_action_at: isoDate(0) },
  ]));

  await must("insert E2E promise", service.from("promises").insert({
    id: E2E_IDS.existingPromise,
    org_id: E2E_IDS.primaryOrg,
    case_id: E2E_IDS.promiseCase,
    customer_id: E2E_IDS.promiseCustomer,
    status: "pending",
    promised_amount: 1800,
    promised_date: isoDate(7),
    grace_until: isoDate(9),
    baseline_balance: 2400,
    created_by: admin.id,
  }));
  await must("link E2E promise invoice", service.from("promise_invoices").insert({
    promise_id: E2E_IDS.existingPromise,
    invoice_id: E2E_IDS.promiseInvoice,
    org_id: E2E_IDS.primaryOrg,
    baseline_balance: 2400,
  }));

  await must("insert fake E2E message ledgers", service.from("text_messages").insert([
    { org_id: E2E_IDS.primaryOrg, case_id: E2E_IDS.messageCase, customer_id: E2E_IDS.messageCustomer, invoice_id: E2E_IDS.messageInvoice, sent_by_user_id: owner.id, direction: "outbound", body: "Synthetic reminder from the local E2E ledger.", status: "delivered", from_number: "+15005550006", to_number: "+15005550103" },
    { org_id: E2E_IDS.primaryOrg, case_id: E2E_IDS.messageCase, customer_id: E2E_IDS.messageCustomer, invoice_id: E2E_IDS.messageInvoice, direction: "inbound", body: "Synthetic reply in the local E2E ledger.", status: "received", from_number: "+15005550103", to_number: "+15005550006" },
  ]));
  await must("insert fake E2E email ledger", service.from("email_messages").insert({
    org_id: E2E_IDS.primaryOrg,
    case_id: E2E_IDS.messageCase,
    customer_id: E2E_IDS.messageCustomer,
    invoice_id: E2E_IDS.messageInvoice,
    sent_by_user_id: owner.id,
    direction: "outbound",
    subject: "Synthetic E2E reminder",
    body: "This is local seeded ledger data; no provider request was made.",
    status: "delivered",
    from_address: "collections@nudgepay-e2e.local",
    to_address: "ap@delta-e2e.local",
  }));
}

export default async function globalSetup(): Promise<() => Promise<void>> {
  const inheritedLock = hasLocalDbHarnessLockToken({ token: process.env.NUDGEPAY_LOCAL_DB_HARNESS_LOCK_TOKEN });
  const lock = inheritedLock ? undefined : acquireLocalDbHarnessLock({ owner: "authenticated-e2e-playwright" });
  let service: SupabaseClient;
  try {
    const env = loadLocalE2EEnv();
    await requireHealthyLocalSupabase(env);
    service = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    await cleanPreviousRun(service);
    await seed(service);
  } catch (error) {
    lock?.release();
    throw error;
  }
  return async () => {
    try {
      await cleanPreviousRun(service);
    } finally {
      lock?.release();
    }
  };
}
