import { createHash } from "node:crypto";

export const PILOT_FIXTURE_PREFIX = "pilot-load-20260905";
export const PILOT_ORG_COUNT = 10;
export const PILOT_USERS_PER_ORG = 5;
export const PILOT_USER_COUNT = PILOT_ORG_COUNT * PILOT_USERS_PER_ORG;
export const DEFAULT_DATASET_SIZES = Object.freeze({ invoices: 5_000, cases: 5_000, messages: 5_000 });
export const MAX_DATASET_SIZE = 5_001;

export function assertLocalPilotUrl(rawUrl) {
  let url;
  try { url = new URL(rawUrl); } catch { throw new Error("SUPABASE_URL must be an exact local loopback URL."); }
  if (
    url.protocol !== "http:" || url.username || url.password || url.pathname !== "/" || url.search || url.hash
    || !["127.0.0.1", "::1", "[::1]"].includes(url.hostname) || url.port !== "54321"
  ) throw new Error("Refusing pilot fixture seed: SUPABASE_URL must be http://127.0.0.1:54321 (or http://[::1]:54321), without credentials or path.");
  return url.toString();
}

export function parseDatasetSize(raw, name, fallback) {
  if (raw === undefined) return fallback;
  if (!/^(?:4999|5000|5001)$/.test(raw) || Number(raw) > MAX_DATASET_SIZE) {
    throw new Error(`--${name} must be an integer from 4999 through ${MAX_DATASET_SIZE} per workspace.`);
  }
  return Number(raw);
}

export function parseSessionCount(raw) {
  if (raw === undefined) return 0;
  if (!/^(?:[1-9]|[1-4]\d|50)$/.test(raw)) throw new Error("--sessions must be an integer from 1 through 50.");
  return Number(raw);
}

export function fixtureUuid(label) {
  const bytes = createHash("sha256").update(`${PILOT_FIXTURE_PREFIX}:${label}`).digest().subarray(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const value = bytes.toString("hex");
  return `${value.slice(0, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}-${value.slice(16, 20)}-${value.slice(20)}`;
}

export function distributeCount(total, buckets = PILOT_ORG_COUNT) {
  return Array.from({ length: buckets }, (_, index) => Math.floor(total / buckets) + (index < total % buckets ? 1 : 0));
}

export function buildPilotPlan(sizes = DEFAULT_DATASET_SIZES) {
  for (const key of Object.keys(DEFAULT_DATASET_SIZES)) {
    if (!Number.isSafeInteger(sizes[key]) || sizes[key] < 4_999 || sizes[key] > MAX_DATASET_SIZE) throw new Error(`Invalid ${key} fixture size.`);
  }
  const orgs = Array.from({ length: PILOT_ORG_COUNT }, (_, orgIndex) => {
    const customerCount = Math.max(sizes.invoices, sizes.cases);
    return {
      index: orgIndex + 1,
      id: fixtureUuid(`org:${orgIndex + 1}`),
      name: `Pilot Load Local ${String(orgIndex + 1).padStart(2, "0")}`,
      users: Array.from({ length: PILOT_USERS_PER_ORG }, (_, userIndex) => ({
        index: userIndex + 1,
        email: `${PILOT_FIXTURE_PREFIX}-o${String(orgIndex + 1).padStart(2, "0")}-u${String(userIndex + 1).padStart(2, "0")}@local.invalid`,
        password: `LocalPilot!${String(orgIndex + 1).padStart(2, "0")}${String(userIndex + 1).padStart(2, "0")}`,
        role: userIndex === 0 ? "owner" : userIndex === 1 ? "admin" : "member",
      })),
      customerCount,
      invoices: sizes.invoices,
      cases: sizes.cases,
      messages: sizes.messages,
    };
  });
  return { prefix: PILOT_FIXTURE_PREFIX, sizes: { ...sizes }, orgs };
}

export function planTotals(plan) {
  return plan.orgs.reduce((totals, org) => ({
    organizations: totals.organizations + 1,
    users: totals.users + org.users.length,
    customers: totals.customers + org.customerCount,
    invoices: totals.invoices + org.invoices,
    cases: totals.cases + org.cases,
    messages: totals.messages + org.messages,
  }), { organizations: 0, users: 0, customers: 0, invoices: 0, cases: 0, messages: 0 });
}

export function assertPilotPlan(plan) {
  const totals = planTotals(plan);
  if (plan.orgs.length !== PILOT_ORG_COUNT || totals.users !== PILOT_USER_COUNT) throw new Error("Pilot fixture plan must contain 10 organizations and 50 users.");
  for (const key of Object.keys(DEFAULT_DATASET_SIZES)) if (totals[key] !== plan.sizes[key] * PILOT_ORG_COUNT) throw new Error(`Pilot fixture ${key} total is inconsistent.`);
  if (new Set(plan.orgs.map((org) => org.id)).size !== PILOT_ORG_COUNT) throw new Error("Pilot fixture organization IDs must be unique.");
  return totals;
}
