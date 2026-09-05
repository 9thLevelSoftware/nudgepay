#!/usr/bin/env node
import { mkdirSync, writeFileSync, chmodSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import {
  DEFAULT_DATASET_SIZES, PILOT_FIXTURE_PREFIX, assertLocalPilotUrl, assertPilotPlan, buildPilotPlan,
  fixtureUuid, parseDatasetSize, parseSessionCount, planTotals,
} from "./seed-pilot-load-lib.mjs";

const BATCH_SIZE = 500;
function parseArgs(values) {
  const parsed = {};
  const known = new Set(["seed", "help", "credentials-file", "cookie-file", "invoices", "cases", "messages", "sessions"]);
  for (let index = 0; index < values.length; index++) {
    const value = values[index];
    if (!value.startsWith("--")) throw new Error(`Unexpected argument: ${value}`);
    const [key, inline] = value.slice(2).split("=", 2);
    if (!known.has(key)) throw new Error(`Unknown argument: --${key}`);
    if (inline !== undefined) { parsed[key] = inline; continue; }
    if (["seed", "help"].includes(key)) { parsed[key] = "true"; continue; }
    const next = values[++index];
    if (!next || next.startsWith("--")) throw new Error(`--${key} requires a value.`);
    parsed[key] = next;
  }
  return parsed;
}
const args = parseArgs(process.argv.slice(2));

function usage() {
  return "Usage: node scripts/seed-pilot-load.mjs --credentials-file C:\\secure\\pilot-local.json [--invoices 4999|5000|5001 per workspace] [--cases 4999|5000|5001 per workspace] [--messages 4999|5000|5001 per workspace] [--sessions 1..50 --cookie-file C:\\secure\\pilot-local-cookies.json] [--seed]";
}
function fail(error) { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; }
function batches(rows) { return Array.from({ length: Math.ceil(rows.length / BATCH_SIZE) }, (_, index) => rows.slice(index * BATCH_SIZE, (index + 1) * BATCH_SIZE)); }
async function expect(result, label) { if (result.error) throw new Error(`${label}: ${result.error.message}`); return result.data; }

function customerRow(org, index) {
  const number = index + 1;
  return { id: fixtureUuid(`customer:${org.index}:${number}`), org_id: org.id, qbo_id: `${PILOT_FIXTURE_PREFIX}-customer-${org.index}-${number}`, name: `Pilot Customer ${org.index}-${String(number).padStart(4, "0")}`, email: `customer-${org.index}-${number}@example.invalid`, phone: `+1555${String(org.index).padStart(2, "0")}${String(number).padStart(5, "0").slice(-5)}`, sms_consent: number % 4 !== 0, do_not_text: number % 17 === 0, do_not_email: number % 19 === 0, preferred_channel: number % 3 === 0 ? "text" : "call" };
}
function invoiceRow(org, index, customers) {
  const number = index + 1;
  const amount = 125 + (number % 24) * 37.5;
  const overdueDays = 1 + (number % 90);
  return { id: fixtureUuid(`invoice:${org.index}:${number}`), org_id: org.id, qbo_id: `${PILOT_FIXTURE_PREFIX}-invoice-${org.index}-${number}`, qbo_doc_number: `PL-${org.index}-${String(number).padStart(5, "0")}`, customer_id: customers[index % customers.length].id, amount, balance: number % 11 === 0 ? 0 : amount, due_date: new Date(Date.UTC(2026, 8, 5 - overdueDays)).toISOString().slice(0, 10), invoice_date: new Date(Date.UTC(2026, 7, 5 - (number % 28))).toISOString().slice(0, 10), status: number % 11 === 0 ? "paid" : "open", paid_date: number % 11 === 0 ? "2026-09-03" : null, qbo_sync_at: "2026-09-05T12:00:00.000Z" };
}
function caseRow(org, index, customers) {
  const number = index + 1;
  const status = ["new", "working", "promised", "waiting", "on_hold", "resolved"][number % 6];
  return { id: fixtureUuid(`case:${org.index}:${number}`), org_id: org.id, customer_id: customers[index].id, status, next_action_type: status === "resolved" ? null : ["contact", "follow_up", "promise", "waiting", "exception"][number % 5], next_action_at: status === "resolved" ? null : new Date(Date.UTC(2026, 8, 5 + (number % 14) - 7)).toISOString().slice(0, 10), opened_at: "2026-06-01T08:00:00.000Z", closed_at: status === "resolved" ? "2026-08-31T16:00:00.000Z" : null };
}
function messageRow(org, index, customers, invoices, cases, users) {
  const number = index + 1;
  const direction = number % 5 === 0 ? "inbound" : "outbound";
  const customer = customers[index % customers.length];
  const invoice = invoices.length ? invoices[index % invoices.length] : null;
  const collectionCase = cases.length ? cases[index % cases.length] : null;
  return { id: fixtureUuid(`message:${org.index}:${number}`), org_id: org.id, customer_id: customer.id, invoice_id: invoice?.id ?? null, case_id: collectionCase?.id ?? null, sent_by_user_id: direction === "outbound" ? users[index % users.length].id : null, direction, twilio_message_sid: `SM${fixtureUuid(`twilio:${org.index}:${number}`).replaceAll("-", "")}`, status: direction === "outbound" ? (number % 7 === 0 ? "delivered" : "sent") : "received", from_number: direction === "outbound" ? "+15550000001" : customer.phone, to_number: direction === "outbound" ? customer.phone : "+15550000001", body: direction === "outbound" ? `Reminder: invoice ${invoice?.qbo_doc_number ?? "account"} has an outstanding balance. Reply with a payment date or call us.` : `I can pay on ${new Date(Date.UTC(2026, 8, 6 + (number % 10))).toISOString().slice(0, 10)}.`, created_at: new Date(Date.UTC(2026, 8, 5, 12, 0, 0) - number * 3_600_000).toISOString() };
}

async function findUserByEmail(admin, email) {
  for (let page = 1; page <= 10; page++) {
    const users = await expect(await admin.auth.admin.listUsers({ page, perPage: 200 }), "list pilot users");
    const found = users.users.find((user) => user.email === email);
    if (found || users.users.length === 0) return found ?? null;
  }
  throw new Error("Pilot user lookup exceeded its bounded page limit.");
}
function deleteFixtureOrganizationsLocally(plan) {
  // This fixture recycler is local-only. It invokes the existing workspace
  // deletion RPC through the local CLI connection so a rerun respects the
  // current last-owner guard. It does not change application timeout behavior
  // or qualify the production deletion path. The SQL has only deterministic
  // fixture UUIDs, and --local never contacts hosting.
  const ids = plan.orgs.map((org) => `'${org.id}'`).join(", ");
  const sqlPath = join(tmpdir(), `nudgepay-pilot-fixture-delete-${process.pid}-${Date.now()}.sql`);
  const sql = [
    "with request_claim as (select set_config('request.jwt.claim.role', 'service_role', true)),",
    "deleted as (",
    "  select public.delete_workspace(organization.id, owner.user_id, organization.name, 5)",
    "    from request_claim",
    "    cross join public.organizations as organization",
    "    join public.memberships as owner on owner.org_id = organization.id and owner.role = 'owner'",
    `   where organization.id in (${ids})`,
    ")",
    "select count(*)::int as deleted_workspaces from deleted;",
    "",
  ].join("\n");
  try {
    writeFileSync(sqlPath, sql, { mode: 0o600 });
    execFileSync(process.execPath, [
      resolve("node_modules/supabase/dist/supabase.js"), "db", "query", "--local", "--file", sqlPath, "--output", "json",
    ], {
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 10 * 60_000,
      windowsHide: true,
    });
  } catch {
    throw new Error("Local pilot fixture cleanup failed. Confirm local Supabase is running and no other database harness owns it.");
  } finally {
    rmSync(sqlPath, { force: true });
  }
}
async function removeOwnedFixtures(admin, plan) {
  // Production hardening prevents direct removal of the final owner. The
  // helper uses that same scoped workspace deletion RPC rather than weakening
  // the guard for fixture reruns.
  deleteFixtureOrganizationsLocally(plan);
  for (const user of plan.orgs.flatMap((org) => org.users)) {
    const existing = await findUserByEmail(admin, user.email);
    if (existing) await expect(await admin.auth.admin.deleteUser(existing.id), "delete owned pilot auth user");
  }
}
async function ensureUsers(admin, plan) {
  const usersByEmail = new Map();
  for (const user of plan.orgs.flatMap((org) => org.users)) {
    const result = await admin.auth.admin.createUser({ email: user.email, password: user.password, email_confirm: true, user_metadata: { display_name: `Pilot User ${user.email}` } });
    const created = await expect(result, "create local pilot auth user");
    usersByEmail.set(user.email, created.user);
  }
  return usersByEmail;
}
async function insertRows(admin, table, rows) { for (const batch of batches(rows)) await expect(await admin.from(table).insert(batch), `insert ${table}`); }
async function seed(admin, plan) {
  await removeOwnedFixtures(admin, plan);
  const usersByEmail = await ensureUsers(admin, plan);
  for (const org of plan.orgs) {
    await expect(await admin.from("organizations").insert({ id: org.id, name: org.name }), "insert pilot organization");
    const users = org.users.map((user) => ({ ...user, id: usersByEmail.get(user.email).id }));
    await insertRows(admin, "memberships", users.map((user) => ({ org_id: org.id, user_id: user.id, role: user.role })));
    const customers = Array.from({ length: org.customerCount }, (_, index) => customerRow(org, index));
    const invoices = Array.from({ length: org.invoices }, (_, index) => invoiceRow(org, index, customers));
    const cases = Array.from({ length: org.cases }, (_, index) => caseRow(org, index, customers));
    const messages = Array.from({ length: org.messages }, (_, index) => messageRow(org, index, customers, invoices, cases, users));
    await insertRows(admin, "customers", customers); await insertRows(admin, "invoices", invoices); await insertRows(admin, "collection_cases", cases); await insertRows(admin, "text_messages", messages);
  }
  return usersByEmail;
}
async function localCookies(url, anonKey, users) {
  const sessions = [];
  for (const user of users) {
    const cookies = [];
    const client = createServerClient(url, anonKey, { cookies: { getAll: () => [], setAll: (values) => cookies.push(...values) } });
    await expect(await client.auth.signInWithPassword({ email: user.email, password: user.password }), "create local pilot session");
    const authCookie = cookies.map(({ name, value }) => `${name}=${value}`).join("; ");
    if (!authCookie) throw new Error("Supabase SSR session did not produce cookies.");
    sessions.push({ session: user.session, workspace: user.workspace, cookie: `${authCookie}; nudgepay-org=${user.orgId}` });
  }
  return sessions;
}
async function main() {
  if (args.help) { console.log(usage()); return; }
  const sizes = { invoices: parseDatasetSize(args.invoices, "invoices", DEFAULT_DATASET_SIZES.invoices), cases: parseDatasetSize(args.cases, "cases", DEFAULT_DATASET_SIZES.cases), messages: parseDatasetSize(args.messages, "messages", DEFAULT_DATASET_SIZES.messages) };
  const sessions = parseSessionCount(args.sessions);
  const plan = buildPilotPlan(sizes); const totals = assertPilotPlan(plan);
  const preview = { mode: args.seed ? "seed" : "dry-run", localOnly: true, prefix: PILOT_FIXTURE_PREFIX, totals, sessions, credentialsFile: args["credentials-file"] ? resolve(args["credentials-file"]) : null, cookieFile: args["cookie-file"] ? resolve(args["cookie-file"]) : null };
  if (!args.seed) { console.log(JSON.stringify(preview, null, 2)); return; }
  if (!args["credentials-file"]) throw new Error("--credentials-file is required with --seed.");
  if (sessions && !args["cookie-file"]) throw new Error("--cookie-file is required when --sessions is set so local session tokens are never written to stdout.");
  const url = assertLocalPilotUrl(process.env.SUPABASE_URL);
  if (!process.env.SUPABASE_SERVICE_KEY || !process.env.SUPABASE_ANON_KEY) throw new Error("SUPABASE_SERVICE_KEY and SUPABASE_ANON_KEY are required for a local seed.");
  const admin = createClient(url, process.env.SUPABASE_SERVICE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  const usersByEmail = await seed(admin, plan);
  const credentialUsers = plan.orgs.flatMap((org) => org.users.map((user, userIndex) => ({ orgId: org.id, orgName: org.name, workspace: `pilot-workspace-${String(org.index).padStart(2, "0")}`, session: `pilot-session-${String((org.index - 1) * 5 + userIndex + 1).padStart(2, "0")}`, email: user.email, password: user.password, role: user.role, userId: usersByEmail.get(user.email).id })));
  const credentialPath = resolve(args["credentials-file"]); mkdirSync(dirname(credentialPath), { recursive: true });
  const sessionUsers = sessions ? credentialUsers.slice(0, sessions).map((user) => ({ ...user, orgId: user.orgId })) : [];
  const cookies = sessions ? await localCookies(url, process.env.SUPABASE_ANON_KEY, sessionUsers) : undefined;
  writeFileSync(credentialPath, `${JSON.stringify({ format: "nudgepay-local-pilot-fixtures/v1", generatedAt: new Date().toISOString(), target: url, prefix: PILOT_FIXTURE_PREFIX, totals, users: credentialUsers, ...(cookies ? { localCookieFixture: resolve(args["cookie-file"]) } : {}) }, null, 2)}\n`, { mode: 0o600 }); chmodSync(credentialPath, 0o600);
  if (cookies) {
    const cookiePath = resolve(args["cookie-file"]); mkdirSync(dirname(cookiePath), { recursive: true });
    const workspaces = plan.orgs.map((org) => ({ workspace: `pilot-workspace-${String(org.index).padStart(2, "0")}`, invoices: org.invoices, cases: org.cases, messages: org.messages }));
    writeFileSync(cookiePath, `${JSON.stringify({ format: "nudgepay-pilot-session-fixture/v1", localOnly: true, source: { kind: "local-pilot-fixture", prefix: PILOT_FIXTURE_PREFIX, totals, workspaces }, sessions: cookies.map(({ session, workspace, cookie }) => ({ session, workspace, cookie })) }, null, 2)}\n`, { mode: 0o600 }); chmodSync(cookiePath, 0o600);
  }
  console.log(JSON.stringify({ ...preview, credentialsFile: credentialPath, createdSessions: sessions, providerSends: 0 }, null, 2));
}
main().catch(fail);
