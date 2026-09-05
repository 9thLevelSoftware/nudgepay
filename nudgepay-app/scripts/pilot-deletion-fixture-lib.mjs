import { createHash } from "node:crypto";

export const DELETION_FIXTURE_PREFIX = "pilot-deletion-20260905";
export const FIXTURE_ROWS_PER_TABLE = 5_000;
export const DELETION_FIXTURE_TABLES = Object.freeze([
  "customers",
  "invoices",
  "collection_cases",
  "text_messages",
  "contact_logs",
  "email_messages",
  "promises",
  "promise_invoices",
  "payments",
]);

export function fixtureUuid(label) {
  const bytes = createHash("sha256").update(`${DELETION_FIXTURE_PREFIX}:${label}`).digest().subarray(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const value = bytes.toString("hex");
  return `${value.slice(0, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}-${value.slice(16, 20)}-${value.slice(20)}`;
}

export function assertLocalDeletionUrl(rawUrl) {
  let url;
  try { url = new URL(rawUrl); } catch { throw new Error("SUPABASE_URL must be http://127.0.0.1:54321."); }
  if (
    url.protocol !== "http:" || url.username || url.password || url.pathname !== "/" || url.search || url.hash
    || !["127.0.0.1", "::1", "[::1]"].includes(url.hostname) || url.port !== "54321"
  ) throw new Error("Refusing deletion fixture: SUPABASE_URL must be http://127.0.0.1:54321 (or http://[::1]:54321), without credentials or path.");
  return url.toString();
}

export function parseDeletionFixtureArgs(values) {
  const parsed = { dryRun: true, seed: false, measure: false, seedAndMeasure: false, help: false };
  for (let index = 0; index < values.length; index++) {
    const value = values[index];
    if (value === "--seed") { if (parsed.seed) throw new Error("Duplicate flag: --seed"); parsed.seed = true; continue; }
    if (value === "--measure") { if (parsed.measure) throw new Error("Duplicate flag: --measure"); parsed.measure = true; continue; }
    if (value === "--seed-and-measure") { if (parsed.seedAndMeasure) throw new Error("Duplicate flag: --seed-and-measure"); parsed.seedAndMeasure = true; continue; }
    if (value === "--help") { parsed.help = true; continue; }
    if (value === "--output") {
      if (parsed.output) throw new Error("Duplicate flag: --output");
      const output = values[++index];
      if (!output || output.startsWith("--")) throw new Error("--output requires a value.");
      parsed.output = output;
      continue;
    }
    if (value === "--seed-output" || value === "--measure-output") {
      const key = value === "--seed-output" ? "seedOutput" : "measureOutput";
      if (parsed[key]) throw new Error(`Duplicate flag: ${value}`);
      const output = values[++index];
      if (!output || output.startsWith("--")) throw new Error(`${value} requires a value.`);
      parsed[key] = output;
      continue;
    }
    throw new Error(`Unknown argument: ${value}`);
  }
  if (parsed.seedAndMeasure && (parsed.seed || parsed.measure)) throw new Error("--seed-and-measure cannot be combined with --seed or --measure.");
  if (parsed.seed && parsed.measure) throw new Error("Choose one mutation mode: --seed or --measure.");
  if (parsed.seedAndMeasure && (!parsed.seedOutput || !parsed.measureOutput)) throw new Error("--seed-and-measure requires --seed-output and --measure-output.");
  if (!parsed.seedAndMeasure && (parsed.seedOutput || parsed.measureOutput)) throw new Error("--seed-output and --measure-output require --seed-and-measure.");
  if ((parsed.seed || parsed.measure) && !parsed.output) throw new Error("--output is required with --seed or --measure to retain sanitized evidence.");
  parsed.dryRun = !parsed.seed && !parsed.measure && !parsed.seedAndMeasure;
  return parsed;
}

function counts() { return Object.fromEntries(DELETION_FIXTURE_TABLES.map((table) => [table, FIXTURE_ROWS_PER_TABLE])); }
function rowId(workspace, table, index) { return fixtureUuid(`${workspace}:${table}:${index + 1}`); }

function buildWorkspace(workspace) {
  const id = fixtureUuid(`org:${workspace}`);
  const owner = { id: fixtureUuid(`owner:${workspace}`), email: `${DELETION_FIXTURE_PREFIX}-${workspace}@local.invalid` };
  const name = `Pilot deletion ${workspace}`;
  const customers = Array.from({ length: FIXTURE_ROWS_PER_TABLE }, (_, index) => ({
    id: rowId(workspace, "customer", index), org_id: id, qbo_id: `${DELETION_FIXTURE_PREFIX}-${workspace}-customer-${index + 1}`,
    name: `Deletion fixture customer ${index + 1}`,
  }));
  const invoices = customers.map((customer, index) => ({
    id: rowId(workspace, "invoice", index), org_id: id, customer_id: customer.id,
    qbo_id: `${DELETION_FIXTURE_PREFIX}-${workspace}-invoice-${index + 1}`, qbo_doc_number: `DEL-${workspace}-${index + 1}`,
    amount: 100, balance: 100, due_date: "2026-09-01", status: "open", qbo_sync_at: "2026-09-05T12:00:00.000Z",
  }));
  const collection_cases = customers.map((customer, index) => ({
    id: rowId(workspace, "case", index), org_id: id, customer_id: customer.id, status: "working",
    next_action_type: "follow_up", next_action_at: "2026-09-06", opened_at: "2026-09-01T12:00:00.000Z",
  }));
  const text_messages = customers.map((customer, index) => ({
    id: rowId(workspace, "text", index), org_id: id, customer_id: customer.id, invoice_id: invoices[index].id,
    case_id: collection_cases[index].id, direction: "inbound", status: "received", from_number: "+15555550100",
    to_number: "+15555550101", body: "Deletion performance fixture", created_at: "2026-09-05T12:00:00.000Z",
  }));
  const contact_logs = customers.map((customer, index) => ({
    id: rowId(workspace, "contact", index), org_id: id, customer_id: customer.id, invoice_id: invoices[index].id,
    case_id: collection_cases[index].id, user_id: owner.id, method: "call", outcome: "left_message",
    notes: "Deletion performance fixture", created_at: "2026-09-05T12:00:00.000Z",
  }));
  const email_messages = customers.map((customer, index) => ({
    id: rowId(workspace, "email", index), org_id: id, customer_id: customer.id, invoice_id: invoices[index].id,
    case_id: collection_cases[index].id, direction: "inbound", status: "received", from_address: "fixture@example.invalid",
    to_address: "fixture@example.invalid", subject: "Fixture", body: "Deletion performance fixture", created_at: "2026-09-05T12:00:00.000Z",
  }));
  const promises = customers.map((customer, index) => ({
    id: rowId(workspace, "promise", index), org_id: id, customer_id: customer.id, case_id: collection_cases[index].id,
    status: "cancelled", promised_amount: 100, promised_date: "2026-09-06", grace_until: "2026-09-07", baseline_balance: 100,
    replacement_promise_id: index === 0 ? null : rowId(workspace, "promise", index - 1), contact_log_id: contact_logs[index].id,
    created_by: owner.id, created_at: "2026-09-05T12:00:00.000Z",
  }));
  const promise_invoices = customers.map((_, index) => ({
    promise_id: promises[index].id, invoice_id: invoices[index].id, org_id: id, baseline_balance: 100,
  }));
  const payments = customers.map((customer, index) => ({
    id: rowId(workspace, "payment", index), org_id: id, customer_id: customer.id,
    qbo_id: `${DELETION_FIXTURE_PREFIX}-${workspace}-payment-${index + 1}`, type: "payment", amount: 1,
    txn_date: "2026-09-05", qbo_sync_at: "2026-09-05T12:00:00.000Z",
  }));
  return { id, name, owner, counts: counts(), rows: { customers, invoices, collection_cases, text_messages, contact_logs, email_messages, promises, promise_invoices, payments } };
}

export function buildDeletionFixturePlan() {
  return Object.freeze({ version: "nudgepay-pilot-deletion-fixture/v1", prefix: DELETION_FIXTURE_PREFIX, target: buildWorkspace("target"), control: buildWorkspace("control") });
}

function sameCounts(left, right) {
  return Object.keys(right).length === Object.keys(left).length
    && Object.entries(right).every(([table, count]) => left[table] === count);
}

export function evaluateDeletionMeasurement({ plan, ownerId, startedAt, rpcStatus, rpcError, targetExists, targetCounts, controlCounts, tombstone }) {
  const requestResult = rpcError
    ? { ok: false, status: rpcStatus ?? null, errorCode: typeof rpcError.code === "string" ? rpcError.code : null }
    : { ok: Number.isInteger(rpcStatus) && rpcStatus >= 200 && rpcStatus < 300, status: rpcStatus ?? null };
  const targetTablesGone = DELETION_FIXTURE_TABLES.every((table) => targetCounts[table] === 0);
  const controlUnchanged = sameCounts(controlCounts, plan.control.counts);
  const tombstoneNew = !!tombstone
    && tombstone.org_id === plan.target.id
    && tombstone.org_name === plan.target.name
    && tombstone.deleted_by === ownerId
    && tombstone.member_count === 1
    && Number.isFinite(Date.parse(tombstone.deleted_at))
    && Date.parse(tombstone.deleted_at) >= Date.parse(startedAt);
  const verification = { targetOrgGone: !targetExists, targetTablesGone, controlUnchanged, tombstoneNew };
  return { requestResult, verification, passed: requestResult.ok && Object.values(verification).every(Boolean) };
}

export function sanitizeDeletionEvidence({ plan, observedCounts, durationMs, measuredAt, requestResult, tombstone, controlExists, verification, passed, scriptHash, migrationLedger }) {
  return {
    format: "nudgepay-pilot-deletion-evidence/v1",
    fixtureVersion: plan.version,
    prefix: plan.prefix,
    target: { id: plan.target.id, name: plan.target.name, counts: observedCounts.target },
    control: { id: plan.control.id, name: plan.control.name, counts: observedCounts.control },
    measuredAt,
    durationMs,
    requestResult: { ok: requestResult.ok, status: requestResult.status, ...(requestResult.errorCode ? { errorCode: requestResult.errorCode } : {}) },
    tombstone: tombstone ? { org_id: tombstone.org_id, org_name: tombstone.org_name, member_count: tombstone.member_count, deleted_by: tombstone.deleted_by, ...(tombstone.deleted_at ? { deleted_at: tombstone.deleted_at } : {}) } : null,
    controlExists: typeof controlExists === "boolean" ? controlExists : null,
    ...(verification ? { verification } : {}),
    ...(typeof passed === "boolean" ? { passed } : {}),
    scriptHash,
    migrationLedger,
  };
}
