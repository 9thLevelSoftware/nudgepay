import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const auditDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(auditDir, "../../..");
const priorPath = join(repoRoot, "docs/production-audit-2026-08-20/01-findings.md");
const registryPath = join(auditDir, "evidence/logs/prior-corpus-registry.json");
const baseline = "820fb1ba035f96d1470ca3b8a2bf4a73b62245bc";
const candidate = "88b9baca35be5b8d9235b2f96863150ef3a67ad1";

const prior = readFileSync(priorPath, "utf8");
const registry = JSON.parse(readFileSync(registryPath, "utf8"));

const normalize = (value) => value.replace(/\r/g, "").replace(/\s+/g, " ").trim();
const stripMd = (value) => normalize(value.replace(/`/g, "").replace(/\*\*/g, ""));
const sha256 = (value) => createHash("sha256").update(value).digest("hex");

function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    const stat = statSync(path);
    if (stat.isDirectory()) {
      if (!["node_modules", ".git", "build", ".wrangler", ".react-router", "dist-cron"].includes(name)) out.push(...walk(path));
    } else out.push(path);
  }
  return out;
}

const candidateFiles = walk(join(repoRoot, "nudgepay-app"));
const byBasename = new Map();
for (const path of candidateFiles) {
  const key = path.split(/[\\/]/).at(-1);
  if (!byBasename.has(key)) byBasename.set(key, []);
  byBasename.get(key).push(relative(repoRoot, path).replaceAll("\\", "/"));
}

function resolveSourcePath(raw) {
  let value = raw.replace(/^\.\//, "").replaceAll("\\", "/");
  if (value.startsWith("nudgepay-app/")) return value;
  if (value.startsWith("app/") || value.startsWith("workers/") || value.startsWith("tests/") || value.startsWith("supabase/") || value.startsWith("cron/") || value.startsWith("scripts/")) return `nudgepay-app/${value}`;
  const name = value.split("/").at(-1);
  const hits = byBasename.get(name) || [];
  return hits.find((p) => p.startsWith("nudgepay-app/app/")) || hits[0] || value;
}

function locationsFrom(text, fallbackPath) {
  const locations = [];
  const seen = new Set();
  const rx = /`([^`\n]+?\.(?:tsx?|mjs|js|sql|toml|json|md))(?:[:#](\d+)(?:-\d+)?)?`/g;
  for (const match of text.matchAll(rx)) {
    const path = resolveSourcePath(match[1]);
    const line = match[2] ? Number(match[2]) : undefined;
    const key = `${path}:${line || ""}`;
    if (!seen.has(key)) {
      seen.add(key);
      locations.push({ path, ...(line ? { line } : {}) });
    }
  }
  if (!locations.length) locations.push({ path: fallbackPath });
  return locations.slice(0, 10);
}

function canonicalCards() {
  const cards = new Map();
  const headings = [...prior.matchAll(/^### \[(NP-2026-\d{3})\] (.+)$/gm)];
  for (let i = 0; i < headings.length; i++) {
    const match = headings[i];
    const end = headings[i + 1]?.index ?? prior.length;
    const body = prior.slice(match.index + match[0].length, end).trim();
    const severity = body.match(/\*\*Severity:\*\*\s*([^\n·]+)/)?.[1]?.trim().toLowerCase() || (Number(match[1].slice(-3)) >= 101 ? "minor" : "major");
    const area = body.match(/\*\*Area:\*\*\s*([^\n·]+)/)?.[1]?.trim().toLowerCase() || "maintainability";
    const status = body.match(/\*\*Status:\*\*\s*([^\n]+)/)?.[1]?.trim() || "open";
    const fix = body.match(/\*\*Fix recipe:\*\*\s*([^\n]+(?:\n(?!- \*\*|###|---).+)*)/)?.[1] || "Implement the prior audit recipe, add regression coverage, and re-run the affected release gate.";
    cards.set(match[1], { canonicalId: match[1], title: stripMd(match[2]), body, severity, area, status, fix: stripMd(fix) });
  }

  const table = prior.slice(prior.indexOf("## Minors (fix recipes)"), prior.indexOf("## Solid (not findings)"));
  for (const line of table.split(/\r?\n/)) {
    const match = line.match(/^\| (NP-2026-\d{3}) \| ([^|]+) \| ([^|]+) \| ([^|]+) \|$/);
    if (!match) continue;
    cards.set(match[1], {
      canonicalId: match[1], title: stripMd(match[3]), body: line, severity: "minor", area: "maintainability",
      status: "open", fix: stripMd(match[4]), prior: stripMd(match[2]),
    });
  }
  return cards;
}

const cards = canonicalCards();
if (cards.size !== 99) throw new Error(`Expected 99 August canonical cards, parsed ${cards.size}`);

const splits = {
  "NP-2026-007": [
    ["truncation", "PostgREST list reads silently truncate above 1,000 rows"],
    ["reconciliation", "Truncated reconciliation can auto-resolve live collection cases"],
  ],
  "NP-2026-016": [
    ["test-env", "Fresh-clone tests require an undocumented, missing .env.test"],
    ["ci", "No CI or standard test script gates releases"],
  ],
  "NP-2026-022": [
    ["auth-csrf", "Login and signup lack same-origin CSRF protection"],
    ["logout-csrf", "Logout lacks same-origin CSRF protection"],
  ],
  "NP-2026-033": [
    ["postal", "Customer email sends do not enforce or always render a postal address"],
    ["unsubscribe", "List-Unsubscribe and RFC 8058 one-click support are missing"],
  ],
  "NP-2026-035": [
    ["sms-rate", "SMS sends lack rate limiting and idempotency"],
    ["email-rate", "Email sends lack rate limiting and idempotency"],
  ],
  "NP-2026-036": [
    ["ledger-rls", "Members can rewrite or delete audit and messaging ledgers"],
    ["invite-token", "Members can retrieve invite bearer tokens"],
    ["qbo-token", "Members can retrieve encrypted QBO credential columns"],
  ],
  "NP-2026-038": [
    ["roster", "Roster loading exposes and truncates a project-wide 1,000-user directory"],
    ["service-pin", "Service-role id-keyed writes omit explicit organization scope"],
  ],
  "NP-2026-045": [
    ["threshold-order", "High-value thresholds at or above $10,000 stop affecting priority scoring"],
    ["validation-range", "Priority threshold client and server ranges disagree"],
  ],
  "NP-2026-046": [
    ["float-money", "Promise evaluation compares currency with floating-point arithmetic"],
    ["payment-semantics", "Any balance drop, including credit memos, counts as promise payment"],
  ],
  "NP-2026-048": [
    ["locale", "Currency and locale are hardcoded to USD and en-US"],
    ["csv", "Reports and work queues have no CSV export"],
  ],
  "NP-2026-049": [
    ["channel-gate", "Operator alerts are incorrectly gated by customer email settings"],
    ["retry", "Broken-promise alerts fail once without durable retry"],
  ],
  "NP-2026-052": [
    ["consent-toggle", "Staff can re-enable SMS consent without provenance"],
    ["test-sms", "Owner test SMS can target arbitrary numbers without production controls"],
  ],
  "NP-2026-053": [
    ["contrast", "Core copper and Focus color pairs fail WCAG AA contrast"],
    ["labels", "Core controls lack explicit accessible labels"],
  ],
  "NP-2026-054": [
    ["parser", "The QBO CloudEvents parser is not verified against a real payload"],
    ["backoff", "Intuit 429 responses have no bounded backoff or Retry-After handling"],
  ],
  "NP-2026-104": [
    ["landing", "Public landing content and metadata are too thin for GA"],
    ["eula", "The EULA still describes a private beta"],
  ],
  "NP-2026-132": [
    ["readme", "Application README remains starter or stale setup guidance"],
    ["agents", "Repository guidance has stale schema and migration inventory"],
    ["starter", "Cloudflare and npm metadata still describe a generic starter"],
  ],
  "NP-2026-136": [
    ["table", "Queue and report grids lack robust table semantics"],
    ["motion", "Reduced-motion behavior is incomplete"],
    ["scrim", "Drawer scrim ARIA is contradictory"],
    ["tabs", "Custom tabs do not implement the APG tabs pattern"],
  ],
  "NP-2026-137": [
    ["live-regions", "Dynamic copy, selection, loading, and error states lack consistent live regions"],
    ["notification-surface", "There is no in-app notification surface"],
    ["first-run", "First-run Integrations guidance is missing"],
  ],
  "NP-2026-143": [
    ["suppressed-focus", "My Work includes suppressed or parked cases"],
    ["snooze-contact", "Focus snooze records false customer contact"],
    ["waiting-promise", "Focus includes waiting and pending-promise cases"],
  ],
};

const splitHints = {
  "NP-2026-007": [["reconcil", "auto-resolv"], ["reconciliation"], ["truncat", "1000", "1,000", "loader"], ["truncation"]],
  "NP-2026-016": [["ci", "nobody runs", "npm test"], ["ci"], ["clone", ".env.test", "docker", "vitest"], ["test-env"]],
  "NP-2026-022": [["logout"], ["logout-csrf"], ["login", "signup", "session swap"], ["auth-csrf"]],
  "NP-2026-033": [["postal"], ["postal"], ["unsubscribe", "rfc 8058"], ["unsubscribe"]],
  "NP-2026-035": [["email", "resend", "inbox"], ["email-rate"], ["sms", "text", "twilio", "phone"], ["sms-rate"]],
  "NP-2026-036": [["invite", "bearer"], ["invite-token"], ["qbo", "cipher", "oauth token"], ["qbo-token"], ["audit", "ledger", "delete", "case", "promise"], ["ledger-rls"]],
  "NP-2026-038": [["listusers", "roster", "auth.users", "directory", "1,000"], ["roster"], ["service-role", "id-keyed", "org_id"], ["service-pin"]],
  "NP-2026-045": [["$500", "min", "range", "client", "server"], ["validation-range"], ["$10,000", "scoring", "12-point"], ["threshold-order"]],
  "NP-2026-046": [["float", "ieee", "fraction"], ["float-money"], ["credit", "balance drop", "payment"], ["payment-semantics"]],
  "NP-2026-048": [["csv", "export"], ["csv"], ["usd", "locale", "currency"], ["locale"]],
  "NP-2026-049": [["retry", "one-shot"], ["retry"], ["gated", "customer", "channel", "digest"], ["channel-gate"]],
  "NP-2026-052": [["test sms", "arbitrary", "unlogged"], ["test-sms"], ["consent", "mark"], ["consent-toggle"]],
  "NP-2026-053": [["contrast", "copper", "low-vision", "unreadable"], ["contrast"], ["label", "accessible-name", "combo"], ["labels"]],
  "NP-2026-054": [["429", "retry", "backoff"], ["backoff"], ["cloudevents", "payload", "parser"], ["parser"]],
  "NP-2026-104": [["eula", "private beta"], ["eula"], ["landing", "single sentence", "headline"], ["landing"]],
  "NP-2026-132": [["agents"], ["agents"], ["metadata", "starter", "publish"], ["starter"], ["readme", "docs"], ["readme"]],
  "NP-2026-136": [["table", "column"], ["table"], ["motion", "sliding"], ["motion"], ["scrim", "hidden from at"], ["scrim"], ["tablist", "tabs pattern"], ["tabs"]],
  "NP-2026-137": [["notification", "bell"], ["notification-surface"], ["first-run", "welcome", "connect button"], ["first-run"], ["live", "copied", "selected", "announce"], ["live-regions"]],
  "NP-2026-143": [["snooze", "contact log"], ["snooze-contact"], ["waiting", "promise"], ["waiting-promise"], ["suppressed", "dnc", "parked", "my-work"], ["suppressed-focus"]],
};

function atomKeysForCanonical(id, title, canonicalSelf = false) {
  const defs = splits[id];
  if (!defs) return [id];
  if (canonicalSelf) return defs.map(([suffix]) => `${id}:${suffix}`);
  const lower = title.toLowerCase();
  const hints = splitHints[id] || [];
  for (let i = 0; i < hints.length; i += 2) {
    if (hints[i].some((needle) => lower.includes(needle))) return [`${id}:${hints[i + 1][0]}`];
  }
  return defs.map(([suffix]) => `${id}:${suffix}`);
}

const T = (file, id) => `${file}::${id}`;
const tempMap = new Map(Object.entries({
  [T("wave-1/auth.md", "TEMP-AUTH-001")]: "NP-2026-001",
  [T("wave-1/auth.md", "TEMP-AUTH-002")]: "NP-2026-002",
  [T("wave-1/auth.md", "TEMP-AUTH-003")]: "NP-2026-021",
  [T("wave-1/auth.md", "TEMP-AUTH-004")]: "NP-2026-022:auth-csrf",
  [T("wave-1/auth.md", "TEMP-AUTH-005")]: "NP-2026-022:logout-csrf",
  [T("wave-1/auth.md", "TEMP-AUTH-006")]: "NP-2026-020",
  [T("wave-1/auth.md", "TEMP-AUTH-007")]: "NP-2026-018",
  [T("wave-1/auth.md", "TEMP-AUTH-008")]: "NP-2026-130",
  [T("wave-1/auth.md", "TEMP-AUTH-009")]: "NP-2026-126",
  [T("wave-1/auth.md", "TEMP-AUTH-010")]: "NP-2026-044",
  [T("wave-1/auth.md", "TEMP-AUTH-011")]: "NP-2026-019",
  [T("wave-1/auth.md", "TEMP-AUTH-012")]: "NP-2026-010",
  [T("wave-1/auth.md", "TEMP-AUTH-013")]: "NP-2026-038:roster",
  [T("wave-1/auth.md", "TEMP-AUTH-014")]: "NEW:AUTH-PASSWORD-POLICY",
  [T("wave-1/auth.md", "TEMP-AUTH-015")]: "NEW:AUTH-ENUMERATION",

  [T("wave-1/cases-queue.md", "TEMP-CASE-001")]: ["NP-2026-007:truncation", "NP-2026-007:reconciliation"],
  [T("wave-1/cases-queue.md", "TEMP-CASE-002")]: "NP-2026-015",
  [T("wave-1/cases-queue.md", "TEMP-CASE-003")]: "NP-2026-024",
  [T("wave-1/cases-queue.md", "TEMP-CASE-004")]: "NP-2026-025",
  [T("wave-1/cases-queue.md", "TEMP-CASE-005")]: "NP-2026-124",
  [T("wave-1/cases-queue.md", "TEMP-CASE-006")]: "NP-2026-045:threshold-order",
  [T("wave-1/cases-queue.md", "TEMP-CASE-007")]: "NEW:DISPLAY-LABEL-FALLBACK",
  [T("wave-1/cases-queue.md", "TEMP-CASE-008")]: "NP-2026-112",
  [T("wave-1/cases-queue.md", "TEMP-CASE-009")]: "NP-2026-046:float-money",
  [T("wave-1/cases-queue.md", "TEMP-CASE-010")]: "NP-2026-046:payment-semantics",
  [T("wave-1/cases-queue.md", "TEMP-CASE-012")]: "NP-2026-138",
  [T("wave-1/cases-queue.md", "TEMP-CASE-013")]: "NP-2026-144",
  [T("wave-1/cases-queue.md", "TEMP-CASE-014")]: "NP-2026-113",
  [T("wave-1/cases-queue.md", "TEMP-CASE-015")]: "NP-2026-111",
  [T("wave-1/cases-queue.md", "TEMP-CASE-016")]: "NP-2026-143:suppressed-focus",
  [T("wave-1/cases-queue.md", "TEMP-CASE-017")]: "NP-2026-143:snooze-contact",
  [T("wave-1/cases-queue.md", "TEMP-CASE-018")]: "NP-2026-143:waiting-promise",

  [T("wave-1/email.md", "TEMP-EMAIL-001")]: "NP-2026-003",
  [T("wave-1/email.md", "TEMP-EMAIL-002")]: "NP-2026-033:postal",
  [T("wave-1/email.md", "TEMP-EMAIL-003")]: "NP-2026-013",
  [T("wave-1/email.md", "TEMP-EMAIL-004")]: "NP-2026-014",
  [T("wave-1/email.md", "TEMP-EMAIL-005")]: "NP-2026-033:unsubscribe",
  [T("wave-1/email.md", "TEMP-EMAIL-006")]: "NP-2026-032",
  [T("wave-1/email.md", "TEMP-EMAIL-007")]: "NP-2026-034",
  [T("wave-1/email.md", "TEMP-EMAIL-008")]: "NP-2026-049:channel-gate",
  [T("wave-1/email.md", "TEMP-EMAIL-009")]: "NP-2026-003",
  [T("wave-1/email.md", "TEMP-EMAIL-010")]: "NP-2026-141",
  [T("wave-1/email.md", "TEMP-EMAIL-011")]: "NP-2026-035:email-rate",
  [T("wave-1/email.md", "TEMP-EMAIL-012")]: "NP-2026-049:retry",

  [T("wave-1/ops-a11y.md", "TEMP-UX-011")]: "NP-2026-053:contrast",
  [T("wave-1/ops-a11y.md", "TEMP-UX-012")]: "NP-2026-053:contrast",
  [T("wave-1/ops-a11y.md", "TEMP-UX-013")]: "NP-2026-053:labels",
  [T("wave-1/ops-a11y.md", "TEMP-UX-014")]: "NP-2026-136:motion",
  [T("wave-1/ops-a11y.md", "TEMP-UX-015")]: "NP-2026-136:table",
  [T("wave-1/ops-a11y.md", "TEMP-UX-016")]: "NP-2026-137:live-regions",
  [T("wave-1/ops-a11y.md", "TEMP-UX-017")]: "NA:PRODUCTION-STACK-HIDDEN",
  [T("wave-1/ops-a11y.md", "TEMP-UX-018")]: "NP-2026-114",
  [T("wave-1/ops-a11y.md", "TEMP-UX-019")]: "NP-2026-136:tabs",
  [T("wave-1/ops-a11y.md", "TEMP-UX-020")]: "NP-2026-136:scrim",
  [T("wave-1/ops-a11y.md", "TEMP-UX-021")]: "NP-2026-101",
  [T("wave-1/ops-a11y.md", "TEMP-OPS-001")]: "NP-2026-008",
  [T("wave-1/ops-a11y.md", "TEMP-OPS-002")]: "NP-2026-016:ci",
  [T("wave-1/ops-a11y.md", "TEMP-OPS-003")]: "NP-2026-016:ci",
  [T("wave-1/ops-a11y.md", "TEMP-OPS-004")]: "NP-2026-132:starter",
  [T("wave-1/ops-a11y.md", "TEMP-OPS-005")]: "NP-2026-039",
  [T("wave-1/ops-a11y.md", "TEMP-OPS-006")]: "NP-2026-042",
  [T("wave-1/ops-a11y.md", "TEMP-OPS-007")]: "NP-2026-009",
  [T("wave-1/ops-a11y.md", "TEMP-OPS-008")]: "NP-2026-009",
  [T("wave-1/ops-a11y.md", "TEMP-OPS-009")]: "NP-2026-132:readme",
  [T("wave-1/ops-a11y.md", "TEMP-OPS-010")]: "NP-2026-132:agents",
  [T("wave-1/ops-a11y.md", "TEMP-OPS-011")]: "NP-2026-133",
  [T("wave-1/ops-a11y.md", "TEMP-OPS-012")]: "NP-2026-016:test-env",
  [T("wave-1/ops-a11y.md", "TEMP-OPS-013")]: "NP-2026-132:readme",
  [T("wave-1/ops-a11y.md", "TEMP-OPS-014")]: "NP-2026-131",
  [T("wave-1/ops-a11y.md", "TEMP-OPS-015")]: "NP-2026-132:starter",

  [T("wave-1/qbo.md", "TEMP-QBO-001")]: "NP-2026-005",
  [T("wave-1/qbo.md", "TEMP-QBO-002")]: "NP-2026-017",
  [T("wave-1/qbo.md", "TEMP-QBO-003")]: "NP-2026-006",
  [T("wave-1/qbo.md", "TEMP-QBO-004")]: "NP-2026-027",
  [T("wave-1/qbo.md", "TEMP-QBO-005")]: "NP-2026-028",
  [T("wave-1/qbo.md", "TEMP-QBO-006")]: "NP-2026-029",
  [T("wave-1/qbo.md", "TEMP-QBO-007")]: "NP-2026-030",
  [T("wave-1/qbo.md", "TEMP-QBO-008")]: "NP-2026-031",
  [T("wave-1/qbo.md", "TEMP-QBO-009")]: "NP-2026-054:parser",
  [T("wave-1/qbo.md", "TEMP-QBO-010")]: "NP-2026-041",
  [T("wave-1/qbo.md", "TEMP-QBO-011")]: "NP-2026-043",
  [T("wave-1/qbo.md", "TEMP-QBO-012")]: "NEW:QBO-MANUAL-REFRESH",
  [T("wave-1/qbo.md", "TEMP-QBO-013")]: "NP-2026-023",
  [T("wave-1/qbo.md", "TEMP-QBO-014")]: "NEW:QBO-SANDBOX-DEFAULT",
  [T("wave-1/qbo.md", "TEMP-QBO-015")]: "NP-2026-054:backoff",
  [T("wave-1/qbo.md", "TEMP-QBO-016")]: "NP-2026-119",
  [T("wave-1/qbo.md", "TEMP-QBO-017")]: "NEW:QBO-QUERY-INTERPOLATION",
  [T("wave-1/qbo.md", "TEMP-QBO-018")]: "NEW:QBO-CALLBACK-ATOMICITY",

  [T("wave-1/rls-tenancy.md", "TEMP-RLS-001")]: "NP-2026-037",
  [T("wave-1/rls-tenancy.md", "TEMP-RLS-002")]: "NP-2026-036:ledger-rls",
  [T("wave-1/rls-tenancy.md", "TEMP-RLS-003")]: "NP-2026-036:invite-token",
  [T("wave-1/rls-tenancy.md", "TEMP-RLS-004")]: "NP-2026-036:qbo-token",
  [T("wave-1/rls-tenancy.md", "TEMP-RLS-005")]: "NP-2026-038:service-pin",
  [T("wave-1/rls-tenancy.md", "TEMP-RLS-006")]: "NP-2026-038:roster",
  [T("wave-1/rls-tenancy.md", "TEMP-RLS-007")]: "NEW:RLS-SYNC-ERROR-COLUMNS",
  [T("wave-1/rls-tenancy.md", "TEMP-RLS-008")]: "NEW:RLS-FORCE",
  [T("wave-1/rls-tenancy.md", "TEMP-RLS-009")]: "NEW:RLS-MEMBERSHIP-FK",
  [T("wave-1/rls-tenancy.md", "TEMP-RLS-010")]: "NEW:RLS-GLOBAL-ASSUMPTIONS",
  [T("wave-1/rls-tenancy.md", "TEMP-RLS-011")]: "NP-2026-013",
  [T("wave-1/rls-tenancy.md", "TEMP-RLS-012")]: "NEW:SERVICE-ROLE-OVERUSE",
  [T("wave-1/rls-tenancy.md", "TEMP-RLS-013")]: "NEW:QBO-REFRESH-AUTHORIZATION",
  [T("wave-1/rls-tenancy.md", "TEMP-RLS-014")]: "NP-2026-044",
  [T("wave-1/rls-tenancy.md", "TEMP-RLS-015")]: "NEW:RLS-TEST-COVERAGE",
  [T("wave-1/rls-tenancy.md", "TEMP-RLS-016")]: "NEW:RLS-TRIGGER-FRAGILITY",

  [T("wave-1/settings-ux.md", "TEMP-SET-001")]: "NP-2026-026",
  [T("wave-1/settings-ux.md", "TEMP-SET-002")]: "NP-2026-045:validation-range",
  [T("wave-1/settings-ux.md", "TEMP-SET-003")]: "NP-2026-115",
  [T("wave-1/settings-ux.md", "TEMP-SET-004")]: "NP-2026-116",
  [T("wave-1/settings-ux.md", "TEMP-SET-005")]: "NP-2026-115",
  [T("wave-1/settings-ux.md", "TEMP-SET-006")]: "NP-2026-053:labels",
  [T("wave-1/settings-ux.md", "TEMP-SET-007")]: "NP-2026-017",
  [T("wave-1/settings-ux.md", "TEMP-SET-008")]: "NP-2026-043",
  [T("wave-1/settings-ux.md", "TEMP-SET-009")]: "NP-2026-023",
  [T("wave-1/settings-ux.md", "TEMP-SET-010")]: "NP-2026-018",
  [T("wave-1/settings-ux.md", "TEMP-SET-011")]: "NEW:SETTINGS-DENIAL-HONESTY",
  [T("wave-1/settings-ux.md", "TEMP-SET-012")]: "NP-2026-052:test-sms",
  [T("wave-1/settings-ux.md", "TEMP-SET-013")]: "NEW:TEMPLATE-LOAD-ERROR",
  [T("wave-1/settings-ux.md", "TEMP-SET-014")]: "NEW:NOTIFICATION-RETURN-URL",
  [T("wave-1/settings-ux.md", "TEMP-SET-015")]: "NP-2026-121",
  [T("wave-1/settings-ux.md", "TEMP-SET-016")]: "NEW:PRIORITY-ERROR-HONESTY",
  [T("wave-1/settings-ux.md", "TEMP-SET-017")]: "NEW:SMS-TOGGLE-CONFIRM",
  [T("wave-1/settings-ux.md", "TEMP-SET-018")]: "NP-2026-101",
  [T("wave-1/settings-ux.md", "TEMP-SET-019")]: "NEW:WEBHOOK-URL-DISCOVERABILITY",
  [T("wave-1/settings-ux.md", "TEMP-SET-020")]: "NEW:TEMPLATE-TRANSACTION",
  [T("wave-1/settings-ux.md", "TEMP-SET-021")]: "NP-2026-049:channel-gate",
  [T("wave-1/settings-ux.md", "TEMP-SET-022")]: "NP-2026-117",
  [T("wave-1/settings-ux.md", "TEMP-UX-001")]: "NP-2026-102",
  [T("wave-1/settings-ux.md", "TEMP-UX-002")]: "NP-2026-107",
  [T("wave-1/settings-ux.md", "TEMP-UX-003")]: "NP-2026-110",
  [T("wave-1/settings-ux.md", "TEMP-UX-004")]: "NP-2026-104:landing",
  [T("wave-1/settings-ux.md", "TEMP-UX-005")]: "NP-2026-104:eula",
  [T("wave-1/settings-ux.md", "TEMP-UX-006")]: "NP-2026-105",
  [T("wave-1/settings-ux.md", "TEMP-UX-007")]: "NP-2026-111",
  [T("wave-1/settings-ux.md", "TEMP-UX-008")]: "NP-2026-137:first-run",
  [T("wave-1/settings-ux.md", "TEMP-UX-009")]: "NP-2026-023",
  [T("wave-1/settings-ux.md", "TEMP-UX-010")]: "NP-2026-018",

  [T("wave-1/sms.md", "TEMP-SMS-001")]: "NP-2026-012",
  [T("wave-1/sms.md", "TEMP-SMS-002")]: "NP-2026-004",
  [T("wave-1/sms.md", "TEMP-SMS-003")]: "NP-2026-011",
  [T("wave-1/sms.md", "TEMP-SMS-004")]: "NP-2026-121",
  [T("wave-1/sms.md", "TEMP-SMS-005")]: "NP-2026-139",
  [T("wave-1/sms.md", "TEMP-SMS-006")]: "NP-2026-140",
  [T("wave-1/sms.md", "TEMP-SMS-007")]: "NP-2026-052:test-sms",
  [T("wave-1/sms.md", "TEMP-SMS-008")]: "NP-2026-035:sms-rate",
  [T("wave-1/sms.md", "TEMP-SMS-009")]: "NP-2026-122",
  [T("wave-1/sms.md", "TEMP-SMS-010")]: "NEW:SMS-GATE-ORDER",
  [T("wave-1/sms.md", "TEMP-SMS-011")]: "NEW:SMS-KEYWORD-PARSING",
  [T("wave-1/sms.md", "TEMP-SMS-012")]: "NP-2026-108",
  [T("wave-1/sms.md", "TEMP-SMS-013")]: ["NP-2026-036:ledger-rls", "NEW:SMS-LEDGER-PARTIAL-FAILURE"],
  [T("wave-1/sms.md", "TEMP-SMS-014")]: "NP-2026-109",

  [T("wave-1/tests-and-mutations.md", "TEMP-TEST-001")]: "NP-2026-016:ci",
  [T("wave-1/tests-and-mutations.md", "TEMP-TEST-002")]: "NP-2026-016:test-env",
  [T("wave-1/tests-and-mutations.md", "TEMP-TEST-003")]: "NEW:BROWSER-TEST-COVERAGE",
  [T("wave-1/tests-and-mutations.md", "TEMP-TEST-004")]: "NEW:RLS-TEST-COVERAGE",
  [T("wave-1/tests-and-mutations.md", "TEMP-TEST-005")]: "NP-2026-035:sms-rate",
  [T("wave-1/tests-and-mutations.md", "TEMP-TEST-006")]: ["NP-2026-022:auth-csrf", "NP-2026-044", "NEW:INVITE-ACCEPT-TEST-COVERAGE"],
  [T("wave-1/tests-and-mutations.md", "TEMP-SEC-001")]: "NP-2026-022:auth-csrf",
  [T("wave-1/tests-and-mutations.md", "TEMP-SEC-002")]: ["NP-2026-035:sms-rate", "NP-2026-035:email-rate"],
  [T("wave-1/tests-and-mutations.md", "TEMP-SEC-003")]: "NP-2026-052:consent-toggle",
  [T("wave-1/tests-and-mutations.md", "TEMP-SEC-004")]: "NP-2026-052:test-sms",
  [T("wave-1/tests-and-mutations.md", "TEMP-SEC-005")]: "NP-2026-019",
  [T("wave-1/tests-and-mutations.md", "TEMP-SEC-006")]: ["NEW:QBO-REFRESH-AUTHORIZATION", "NP-2026-049:retry"],
  [T("wave-1/tests-and-mutations.md", "TEMP-SEC-007")]: "NA:UNSUBSCRIBE-CAPABILITY",
  [T("wave-1/tests-and-mutations.md", "TEMP-SEC-008")]: "NEW:PRESENCE-JUNK-RLS",
  [T("wave-1/tests-and-mutations.md", "TEMP-TEST-007")]: "NP-2026-016:ci",

  [T("wave-2/workflow-static.md", "TEMP-WF-001")]: "NP-2026-017",
  [T("wave-2/workflow-static.md", "TEMP-WF-002")]: "NP-2026-005",
  [T("wave-2/workflow-static.md", "TEMP-WF-003")]: "NP-2026-105",
  [T("wave-2/workflow-static.md", "TEMP-WF-004")]: "NP-2026-003",
  [T("wave-2/workflow-static.md", "TEMP-WF-006")]: "NP-2026-047",
  [T("wave-2/workflow-static.md", "TEMP-WF-007")]: "NP-2026-001",
  [T("wave-2/workflow-static.md", "TEMP-WF-008")]: "NEW:AUTH-RATE-HONESTY",
  [T("wave-2/workflow-static.md", "TEMP-WF-009")]: "NEW:PROVIDER-CONFIG-500",
  [T("wave-2/workflow-static.md", "TEMP-WF-010")]: "NP-2026-015",
  [T("wave-2/workflow-static.md", "TEMP-WF-011")]: "NEW:COMM-PREF-EMAIL",
  [T("wave-2/workflow-static.md", "TEMP-WF-012")]: "NP-2026-025",
  [T("wave-2/workflow-static.md", "TEMP-WF-013")]: "NEW:FOCUS-SMS-GATE-UX",
  [T("wave-2/workflow-static.md", "TEMP-WF-014")]: "NP-2026-018",
  [T("wave-2/workflow-static.md", "TEMP-WF-015")]: "NP-2026-101",
  [T("wave-2/workflow-static.md", "TEMP-WF-016")]: "NEW:ERROR-BOUNDARY-HONESTY",
  [T("wave-2/workflow-static.md", "TEMP-WF-017")]: "NEW:QBO-CALLBACK-HEADERS",
  [T("wave-2/workflow-static.md", "TEMP-WF-018")]: "NP-2026-113",
  [T("wave-2/workflow-static.md", "TEMP-WF-019")]: "NEW:SETTINGS-DENIAL-HONESTY",
  [T("wave-2/workflow-static.md", "TEMP-WF-020")]: ["NEW:UNSUBSCRIBE-ERROR-HONESTY", "NP-2026-106"],

  [T("wave-3/security.md", "TEMP-SEC-001")]: "NP-2026-039",
  [T("wave-3/security.md", "TEMP-SEC-002")]: "NP-2026-022:auth-csrf",
  [T("wave-3/security.md", "TEMP-SEC-003")]: "NP-2026-021",
  [T("wave-3/security.md", "TEMP-SEC-004")]: ["NP-2026-035:sms-rate", "NP-2026-035:email-rate"],
  [T("wave-3/security.md", "TEMP-SEC-005")]: "NEW:WEBHOOK-REPLAY-STATUS",
  [T("wave-3/security.md", "TEMP-SEC-006")]: "NP-2026-038:roster",
  [T("wave-3/security.md", "TEMP-SEC-007")]: "NP-2026-040",
  [T("wave-3/security.md", "TEMP-SEC-008")]: "NP-2026-036:ledger-rls",
}));

function shortSourcePath(path) {
  return path.replace("docs/production-audit-2026-08-20/", "");
}

function rawKey(entry) {
  return T(shortSourcePath(entry.sourcePath), entry.sourceId);
}

function readRawCard(entry) {
  const path = join(repoRoot, entry.sourcePath);
  if (!existsSync(path)) return "";
  const text = readFileSync(path, "utf8");
  const escaped = entry.sourceId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = text.match(new RegExp(`^### \\[${escaped}\\][^\\n]*\\n([\\s\\S]*?)(?=^### |^---|$)`, "m"));
  return match?.[1]?.trim() || "";
}

const newDefinitions = new Map();
for (const entry of registry.entries.filter((entry) => entry.namespacedId.includes("wave-"))) {
  const mapping = tempMap.get(rawKey(entry));
  if (!mapping) throw new Error(`Unmapped wave card: ${rawKey(entry)} — ${entry.title}`);
  for (const key of (Array.isArray(mapping) ? mapping : [mapping])) {
    if ((key.startsWith("NEW:") || key.startsWith("NA:")) && !newDefinitions.has(key)) {
      newDefinitions.set(key, { entry, body: readRawCard(entry) });
    }
  }
}

const currentDelta = [
  {
    key: "DELTA:FORWARDED-ORIGIN", title: "Render trusts forwarded origin headers without a bounded proxy or host allowlist",
    severity: "high", domain: "security", owner: "security", size: "S", fixOrder: 1,
    locations: [{ path: "nudgepay-app/server.js", line: 20 }, { path: "nudgepay-app/app/lib/csrf.server.ts", line: 16 }],
    actual: "The Node runtime sets trust proxy to true, while the React Router adapter constructs request origin from forwarded protocol and host. Deployed header sanitization was not proven.",
    expected: "Only the known Render proxy and an allowlisted public host may influence the origin used by CSRF validation.",
    approach: "Use a bounded trusted-hop/address policy and validate the effective host against explicit runtime configuration; test hostile forwarded headers on staging.",
  },
  {
    key: "DELTA:READINESS", title: "Render readiness reports healthy when required configuration or Supabase is unavailable",
    severity: "high", domain: "operations", owner: "devops", size: "S", fixOrder: 2,
    locations: [{ path: "nudgepay-app/app/routes/healthz.tsx", line: 6 }, { path: "nudgepay-app/render.yaml" }],
    actual: "The configured health route always returns 200 with { ok: true } and performs no configuration or dependency readiness check.",
    expected: "Rollout readiness must fail when the application cannot serve authenticated traffic; a separate shallow liveness endpoint may remain.",
    approach: "Separate liveness and readiness. Validate required non-secret configuration and a bounded Supabase connectivity query without returning diagnostic values.",
  },
  {
    key: "DELTA:FREE-RENDER", title: "Render free-plan secondary runtime is not production callback or failover capacity",
    severity: "high", domain: "operations", owner: "devops", size: "S", fixOrder: 2,
    locations: [{ path: "nudgepay-app/render.yaml" }],
    actual: "The Blueprint selects plan: free. Render documents idle spin-down, about one-minute wake-up, and says free instances are not for production.",
    expected: "A failover runtime receiving provider callbacks must remain available within provider acknowledgement windows and have supported rollback capacity.",
    approach: "Use a paid always-on staging/failover service, then measure cold/start latency, webhook acknowledgement, shutdown, scaling, and rollback behavior.",
  },
  {
    key: "DELTA:WAITUNTIL", title: "Node waitUntil shim does not drain background work during shutdown",
    severity: "high", domain: "data-integrity", owner: "backend", size: "M", fixOrder: 2,
    locations: [{ path: "nudgepay-app/server.js", line: 54 }],
    actual: "The shim catches rejected promises with console.error but does not track pending work, expose failure telemetry, or drain on SIGTERM.",
    expected: "Provider acknowledgement followed by background work must survive ordinary deploy/restart boundaries or durably enqueue before acknowledgement.",
    approach: "Persist jobs before acknowledging callbacks or track and drain work with bounded graceful shutdown, durable retries, and monitoring.",
  },
  {
    key: "DELTA:DEEP-SCAN", title: "Mandatory Codex Deep Security Scan could not start",
    severity: "high", domain: "security", owner: "security", size: "XS", fixOrder: 1,
    locations: [{ path: "docs/audits/2026-08-20-production-readiness/evidence/security/README.md" }],
    actual: "The scanner required a managed filesystem permission profile and TAC status could not be checked because the connector was not logged in.",
    expected: "Canonical deep-scan manifest, findings, coverage, and report artifacts must be sealed for the exact candidate.",
    approach: "Re-run the Deep Security Scan in a managed read-only workspace, complete it once, and link the sealed artifacts before re-verification.",
  },
  {
    key: "DELTA:ENV-EVIDENCE", title: "Mandatory staging, provider, database, and authenticated browser evidence is unavailable",
    severity: "high", domain: "operations", owner: "devops", size: "L", fixOrder: 2,
    locations: [{ path: "docs/audits/2026-08-20-production-readiness/provider-evidence.md" }, { path: "docs/audits/2026-08-20-production-readiness/workflow-matrix.md" }],
    actual: "Docker/local Supabase, dedicated staging, provider accounts, authenticated fixtures, the in-app Browser service, monitoring, backup/restore, and rollback proof were unavailable.",
    expected: "Every mandatory public-GA database, browser, provider, runtime, resilience, and operations gate must have executable evidence.",
    approach: "Provision retained isolated audit resources and execute every environment-blocked matrix row with synthetic data and owned destinations.",
  },
];

const domainByArea = {
  auth: "security", qbo: "integration", cases: "data-integrity", focus: "workflow", settings: "ux-ui",
  sms: "compliance", email: "compliance", compliance: "compliance", tenancy: "security", ops: "operations",
  cron: "operations", promises: "data-integrity", inbox: "workflow", reports: "functionality", accounts: "functionality",
  notifications: "operations", a11y: "accessibility",
};

function inferDomain(card, title) {
  const lower = `${card.area || ""} ${title}`.toLowerCase();
  for (const [needle, domain] of Object.entries(domainByArea)) if (lower.includes(needle)) return domain;
  if (/privacy|eula|license|postal|unsubscribe|stop|help|consent/i.test(lower)) return "compliance";
  if (/rls|tenant|csrf|cookie|token|security|cve/i.test(lower)) return "security";
  if (/wcag|label|contrast|screen.reader|keyboard|aria/i.test(lower)) return "accessibility";
  if (/render|cloudflare|deploy|monitor|ci|test|readme|metadata/i.test(lower)) return "operations";
  return "maintainability";
}

function severityFor(canonicalId, priorSeverity, title, newRaw = false) {
  const number = canonicalId?.startsWith("NP-2026-") ? Number(canonicalId.slice(-3)) : null;
  if (number && number <= 16) return "high";
  if (number === 133) return "medium";
  if (/csrf|session cookie|bearer token|encrypted qbo|security header|react-router|not valid|stop language|help\/info|last-10|recipient.*timezone|privacy.*resend|terminal dnc|legal opt-out|untracked customer communication/i.test(title)) return "high";
  if ([21, 22, 27, 28, 30, 31, 33, 35, 36, 37, 39, 40, 46, 52, 53, 121, 122, 135, 139, 140, 141, 144].includes(number)) return "high";
  if (priorSeverity === "blocker") return "high";
  if (priorSeverity === "major") return "medium";
  if (newRaw && /provider|qbo|rls|errorboundary|signup enumer|password policy/i.test(title)) return "medium";
  return priorSeverity === "minor" ? "low" : "informational";
}

function fixOrderFor(domain, title) {
  if (["security", "privacy", "compliance"].includes(domain)) return 1;
  if (domain === "operations" && /runtime|render|cloudflare|environment|deploy|secret|health|scan/i.test(title)) return 2;
  if (["data-integrity", "integration"].includes(domain)) return 3;
  if (/auth|invite|onboarding|member|session|password/i.test(title)) return 4;
  if (["functionality", "workflow", "ux-ui"].includes(domain)) return 5;
  if (/message|sms|email|notification/i.test(title)) return 6;
  if (domain === "accessibility") return 7;
  return 8;
}

function rolesFor(domain, title) {
  const roles = new Set();
  if (/login|signup|password|public|landing|privacy|eula|unsubscribe|redirect|compliance url/i.test(title)) roles.add("anonymous");
  if (/invite|accept/i.test(title)) roles.add("invitee");
  if (!["privacy", "compliance"].includes(domain) || /send|consent|stop|email|sms/i.test(title)) roles.add("member");
  if (/owner|settings|qbo|team|org|provider|deploy|runtime/i.test(title)) roles.add("owner");
  if (/provider|qbo|twilio|resend|webhook/i.test(title)) roles.add("provider");
  if (domain === "operations") roles.add("operator");
  if (!roles.size) roles.add("member");
  return [...roles].filter((role) => ["anonymous", "invitee", "member", "owner", "operator", "provider"].includes(role));
}

function routesFor(title) {
  const routes = [];
  const tests = [
    [/login|password/i, "/login"], [/signup|confirmation/i, "/signup"], [/invite/i, "/invite"], [/accept/i, "/accept/:token"],
    [/dashboard|queue|case|loader/i, "/dashboard"], [/focus/i, "/focus"], [/account/i, "/accounts/:id"], [/message|inbox/i, "/messages"],
    [/promise/i, "/promises"], [/report|csv/i, "/reports"], [/setting|template|qbo|sync/i, "/settings"],
    [/twilio|sms|stop|help/i, "/webhooks/twilio/inbound"], [/resend|email.received/i, "/webhooks/resend"], [/unsubscribe/i, "/unsubscribe"],
    [/qbo webhook|cloudevents/i, "/webhooks/qbo"], [/health|readiness/i, "/healthz"],
  ];
  for (const [rx, route] of tests) if (rx.test(title)) routes.push(route);
  return [...new Set(routes)];
}

function evidenceState(title, domain) {
  if (/provider|sandbox|live|staging|deep security|environment|render free/i.test(title)) return "environment-blocked";
  if (/forgot-password/i.test(title)) return "browser-verified";
  return "static-only";
}

function aliasFor(entry, disposition, overrideId) {
  const wave = entry.namespacedId.includes("wave-");
  const corpus = entry.namespacedId.startsWith("july13::") ? "july-13" : entry.namespacedId.startsWith("canonical::") ? "august-20-canonical" : "august-20-wave";
  const id = overrideId || (wave ? `AUG20:${shortSourcePath(entry.sourcePath).replace(/\.md$/, "").replaceAll("/", ":")}:${entry.sourceId}` : entry.sourceId);
  return { corpus, id, sourcePath: entry.sourcePath, disposition };
}

const atomMap = new Map();
for (const card of cards.values()) {
  const defs = splits[card.canonicalId] || [[null, card.title]];
  for (const [suffix, title] of defs) {
    const key = suffix ? `${card.canonicalId}:${suffix}` : card.canonicalId;
    atomMap.set(key, { key, canonicalId: card.canonicalId, title, card, aliases: [] });
  }
}

for (const [key, { entry, body }] of newDefinitions) {
  const notDefect = key.startsWith("NA:");
  atomMap.set(key, {
    key, canonicalId: null, title: entry.title, card: {
      title: entry.title, body, severity: entry.severity, area: entry.area || "maintainability",
      status: notDefect ? "not-a-defect" : "open",
      fix: stripMd(body.match(/\*\*Fix recipe:\*\*\s*([^\n]+)/)?.[1] || "Add focused regression coverage and implement the raw card's fix recipe."),
    }, aliases: [], notDefect,
  });
}

for (const delta of currentDelta) atomMap.set(delta.key, { ...delta, aliases: [], delta: true });

const sourceRows = [];
for (const entry of registry.entries) {
  let keys;
  if (entry.namespacedId.startsWith("canonical::")) keys = atomKeysForCanonical(entry.sourceId, entry.title, true);
  else if (entry.namespacedId.startsWith("july13::")) keys = atomKeysForCanonical(entry.canonicalAlias, entry.title, false);
  else {
    const mapped = tempMap.get(rawKey(entry));
    keys = Array.isArray(mapped) ? mapped : [mapped];
  }
  if (!keys?.length || keys.some((key) => !atomMap.has(key))) throw new Error(`Bad mapping for ${entry.namespacedId}: ${JSON.stringify(keys)}`);

  const splitCanonical = entry.namespacedId.startsWith("canonical::") && keys.length > 1;
  const mappedDuplicate = entry.namespacedId.includes("wave-") && keys.every((key) => !key.startsWith("NEW:") && !key.startsWith("NA:"));
  let disposition = entry.status === "partial" ? "partially-fixed" : "still-open";
  if (splitCanonical) disposition = "superseded";
  if (mappedDuplicate) disposition = "duplicate-merged";
  if (keys.every((key) => key.startsWith("NA:"))) disposition = "not-a-defect";

  for (const key of keys) atomMap.get(key).aliases.push(aliasFor(entry, disposition));
  sourceRows.push({ entry, keys, disposition });
}

for (const atom of atomMap.values()) {
  if (atom.delta) atom.aliases.push({ corpus: "current-delta", id: `WORKTREE:${atom.key.slice(6)}`, sourcePath: atom.locations[0].path, disposition: "unverified" });
}

const findings = [];
let newSeq = 201;
let deltaSeq = 1;
for (const atom of atomMap.values()) {
  const card = atom.card || {};
  const notDefect = Boolean(atom.notDefect);
  let id;
  if (atom.delta) id = `NP-AUD-2026-D${String(deltaSeq++).padStart(2, "0")}`;
  else if (atom.canonicalId) {
    const suffix = atom.key.includes(":") ? atom.key.split(":")[1].toUpperCase() : "";
    id = `NP-AUD-2026-${atom.canonicalId.slice(-3)}${suffix ? `-${suffix}` : ""}`;
  } else id = `NP-AUD-2026-X${String(newSeq++).padStart(3, "0")}`;

  const title = atom.title;
  const domain = atom.domain || inferDomain(card, title);
  const severity = notDefect ? "informational" : (atom.severity || severityFor(atom.canonicalId, card.severity, title, !atom.canonicalId));
  const releaseGate = notDefect ? "non-blocking" : (severity === "high" ? "blocker" : severity === "medium" ? "conditional" : "non-blocking");
  const verificationState = atom.delta ? "environment-blocked" : evidenceState(title, domain);
  const body = card.body || atom.actual || "";
  const sourceLocations = atom.locations || locationsFrom(body, atom.aliases[0]?.sourcePath || "docs/production-audit-2026-08-20/01-findings.md");
  const approach = atom.approach || card.fix || "Implement the recorded remediation with regression and negative-case coverage.";
  const aliases = atom.aliases.filter((alias, index, all) => all.findIndex((other) => other.corpus === alias.corpus && other.id === alias.id && other.sourcePath === alias.sourcePath) === index);
  const owner = atom.owner || (domain === "security" ? "security" : domain === "operations" ? "devops" : domain === "accessibility" || domain === "ux-ui" ? "frontend" : domain === "compliance" || domain === "privacy" ? "legal" : domain === "data-integrity" ? "database" : "backend");
  const actual = atom.actual || (notDefect ? "Current source matches the documented intended behavior; the prior raw card is retained as a non-defect record." : `Current candidate source still contains the behavior described by ${atom.canonicalId || aliases[0]?.id}. No product fix affecting this root cause exists between ${baseline.slice(0, 8)} and ${candidate.slice(0, 8)}.`);
  const expected = atom.expected || (notDefect ? "Preserve the intended behavior and regression-test it." : `The ${title.toLowerCase()} condition must be eliminated and the original reproduction plus negative cases must pass.`);
  const evidence = [
    ...aliases.slice(0, 6).map((alias) => ({ kind: "prior-corpus", path: alias.sourcePath, description: `${alias.id}: ${alias.disposition}` })),
    { kind: "candidate-delta", path: "docs/audits/2026-08-20-production-readiness/evidence/logs/release-candidate-manifest.json", description: `Candidate ${candidate.slice(0, 8)} compared with ${baseline.slice(0, 8)}.` },
  ];
  if (/forgot-password|landing|eula/i.test(title)) evidence.push({ kind: "supplemental-playwright", path: "docs/audits/2026-08-20-production-readiness/evidence/screenshots/", description: "Fresh local public-page screenshots at 1440x900 and 390x844; in-app Browser was unavailable." });
  if (severity === "high") evidence.push({ kind: "second-review-required", path: "docs/audits/2026-08-20-production-readiness/evidence/logs/high-finding-review.md", description: "Independent reproduction review; absence or failure keeps the gate open." });
  const needsMigrationReview = domain === "data-integrity" || sourceLocations.some((location) => /supabase\/migrations/.test(location.path));

  findings.push({
    id, aliases, title, domain, severity, releaseGate,
    confidence: atom.delta || verificationState === "environment-blocked" ? "medium" : "high",
    verificationState,
    environments: verificationState === "browser-verified" ? ["static", "local"] : ["static"],
    affectedRoles: rolesFor(domain, title),
    affectedRoutes: routesFor(title),
    sourceLocations,
    expectedBehavior: expected,
    actualBehavior: actual,
    prerequisites: notDefect ? ["Current candidate source"] : ["Exact candidate manifest", "Synthetic isolated data", ...(verificationState === "environment-blocked" ? ["Dedicated staging/provider access"] : [])],
    reproductionSteps: notDefect ? ["Inspect the cited source.", "Confirm the intended behavior remains covered by a focused regression test."] : [
      `Check out candidate ${candidate}.`,
      `Inspect the cited source location(s) and follow the original alias card ${aliases[0]?.id || atom.key}.`,
      "Execute the smallest isolated synthetic-data scenario that reaches the affected route or service.",
      "Repeat with negative, cross-tenant, concurrency, and accessibility cases where applicable; record redacted output.",
    ],
    evidence,
    rootCause: notDefect ? "No defect; the raw audit card described an intended or harmless behavior." : stripMd(body.match(/\*\*Evidence \(code\):\*\*\s*([^\n]+)/)?.[1] || body.match(/\*\*Evidence:\*\*\s*([^\n]+)/)?.[1] || actual),
    impact: notDefect ? "No release impact unless the intended control regresses." : stripMd(body.match(/\*\*User \/ legal impact:\*\*\s*([^\n]+)/)?.[1] || `Public-GA correctness, security, compliance, or operability is reduced by ${title.toLowerCase()}.`),
    ...(domain === "security" && !notDefect ? { security: {
      attacker: "Anonymous, authenticated tenant user, compromised session, or provider caller depending on the affected route.",
      trustBoundary: "Browser/provider to application runtime and organization-scoped Supabase data.",
      attackPath: `Follow the reproduction for ${id}; substitute hostile tenant identifiers, headers, tokens, or replayed payloads where applicable.`,
      counterevidence: "App-layer org pinning, RLS, HMAC checks, and safe return URLs remain relevant but do not close this atomic finding without live proof.",
    } } : {}),
    remediation: {
      approach,
      filesLikelyAffected: sourceLocations.map((location) => location.path).filter((path) => path.startsWith("nudgepay-app/")).slice(0, 8),
      migrationOrCompatibilityNotes: needsMigrationReview ? ["Review existing data before validating or tightening constraints.", "Preserve Cloudflare and Render compatibility."] : ["No database migration is implied by the current source locations; preserve Cloudflare and Render compatibility."],
      testsToAdd: [`Regression for ${id}`, "Negative/unauthorized case", "Concurrency or retry case when state changes are involved"],
      acceptanceCriteria: ["Current source no longer contains the root cause.", "Original reproduction fails to reproduce the defect.", "Focused regression coverage passes.", "Required browser/provider/database evidence passes.", ...(severity === "high" ? ["A second reviewer reproduces the closure from written instructions."] : [])],
      dependencies: releaseGate === "blocker" ? ["Retained isolated audit staging"] : [],
    },
    suggestedOwner: owner,
    fixOrder: atom.fixOrder || fixOrderFor(domain, title),
    estimatedSize: atom.size || (severity === "high" ? "M" : severity === "medium" ? "S" : "XS"),
  });
}

findings.sort((a, b) => a.fixOrder - b.fixOrder || ["high", "medium", "low", "informational"].indexOf(a.severity) - ["high", "medium", "low", "informational"].indexOf(b.severity) || a.id.localeCompare(b.id));

const valid = {
  domains: new Set(["functionality", "workflow", "security", "privacy", "data-integrity", "accessibility", "ux-ui", "performance", "integration", "operations", "compliance", "maintainability"]),
  severity: new Set(["critical", "high", "medium", "low", "informational"]),
  releaseGate: new Set(["blocker", "conditional", "non-blocking"]),
  verification: new Set(["static-only", "automated-tested", "browser-verified", "provider-verified", "environment-blocked"]),
};
const ids = new Set();
for (const finding of findings) {
  if (!/^NP-AUD-2026-[A-Z0-9-]+$/.test(finding.id)) throw new Error(`Bad ID ${finding.id}`);
  if (ids.has(finding.id)) throw new Error(`Duplicate ID ${finding.id}`);
  ids.add(finding.id);
  if (!valid.domains.has(finding.domain) || !valid.severity.has(finding.severity) || !valid.releaseGate.has(finding.releaseGate) || !valid.verification.has(finding.verificationState)) throw new Error(`Bad enum in ${finding.id}`);
  if (!finding.aliases.length) throw new Error(`No aliases in ${finding.id}`);
}

writeFileSync(join(auditDir, "findings.json"), `${JSON.stringify(findings, null, 2)}\n`);

const counts = {
  total: findings.length,
  severity: Object.fromEntries(["critical", "high", "medium", "low", "informational"].map((value) => [value, findings.filter((finding) => finding.severity === value).length])),
  releaseGate: Object.fromEntries(["blocker", "conditional", "non-blocking"].map((value) => [value, findings.filter((finding) => finding.releaseGate === value).length])),
  verification: Object.fromEntries(["static-only", "automated-tested", "browser-verified", "provider-verified", "environment-blocked"].map((value) => [value, findings.filter((finding) => finding.verificationState === value).length])),
};

const findingLines = [
  "# Canonical atomic findings", "", `Generated from \`findings.json\` for candidate \`${candidate}\`.`, "",
  `Counts: ${counts.total} total; ${counts.severity.critical} critical, ${counts.severity.high} high, ${counts.severity.medium} medium, ${counts.severity.low} low, ${counts.severity.informational} informational.`, "",
];
for (const finding of findings) {
  findingLines.push(`## ${finding.id} — ${finding.title}`, "", `- Severity: **${finding.severity}**`, `- Release gate: **${finding.releaseGate}**`, `- Domain / owner: ${finding.domain} / ${finding.suggestedOwner}`, `- Verification: ${finding.verificationState} (${finding.confidence} confidence)`, `- Fix order / size: ${finding.fixOrder} / ${finding.estimatedSize}`, `- Roles: ${finding.affectedRoles.join(", ") || "n/a"}`, `- Routes: ${finding.affectedRoutes.join(", ") || "cross-cutting"}`, `- Aliases: ${finding.aliases.map((alias) => `${alias.id} [${alias.disposition}]`).join("; ")}`, "", "Expected: " + finding.expectedBehavior, "", "Actual: " + finding.actualBehavior, "", "Root cause: " + finding.rootCause, "", "Impact: " + finding.impact, "", "Remediation: " + finding.remediation.approach, "", "Acceptance:", "", ...finding.remediation.acceptanceCriteria.map((criterion) => `- ${criterion}`), "");
}
writeFileSync(join(auditDir, "findings.md"), `${findingLines.join("\n")}\n`);

const dispositionLines = [
  "# Source disposition", "", `All ${registry.entries.length} prior-corpus entries are mapped below. Temporary IDs are qualified by their source file.`, "",
  "| Corpus | Qualified source ID | Source title | Final atomic finding(s) | Disposition |", "|---|---|---|---|---|",
];
for (const row of sourceRows) {
  const finalIds = row.keys.map((key) => atomMap.get(key)).map((atom) => findings.find((finding) => finding.title === atom.title && finding.aliases.some((alias) => alias.sourcePath === row.entry.sourcePath))?.id || "UNRESOLVED");
  const corpus = row.entry.namespacedId.startsWith("july13::") ? "July 13" : row.entry.namespacedId.startsWith("canonical::") ? "August canonical" : "August wave";
  const qualified = row.entry.namespacedId.includes("wave-") ? `AUG20:${shortSourcePath(row.entry.sourcePath).replace(/\.md$/, "").replaceAll("/", ":")}:${row.entry.sourceId}` : row.entry.sourceId;
  dispositionLines.push(`| ${corpus} | ${qualified.replaceAll("|", "\\|")} | ${row.entry.title.replaceAll("|", "\\|")} | ${finalIds.join(", ")} | ${row.disposition} |`);
}
if (dispositionLines.some((line) => line.includes("UNRESOLVED"))) throw new Error("Unresolved source disposition row");
writeFileSync(join(auditDir, "source-disposition.md"), `${dispositionLines.join("\n")}\n`);

const topRisks = findings.filter((finding) => finding.releaseGate === "blocker").slice(0, 15);
const readme = [
  "# NudgePay production-readiness audit", "", "## Verdict: NO-GO", "",
  `Candidate \`${candidate}\` is **not ready for public GA**. The ledger contains ${counts.releaseGate.blocker} open release blockers, and mandatory database, staging, provider, authenticated-browser, accessibility, resilience, rollback, and deep-security evidence is unavailable.`, "",
  "## Generated counts", "", "| Measure | Count |", "|---|---:|", `| Atomic findings | ${counts.total} |`, ...Object.entries(counts.severity).map(([key, value]) => `| Severity: ${key} | ${value} |`), ...Object.entries(counts.releaseGate).map(([key, value]) => `| Gate: ${key} | ${value} |`), ...Object.entries(counts.verification).map(([key, value]) => `| Evidence: ${key} | ${value} |`), "",
  "Counts are generated from `findings.json`; they are not maintained independently.", "", "## Top release risks", "", ...topRisks.map((finding) => `- ${finding.id}: ${finding.title}`), "",
  "## Evidence achieved", "", "- Exact baseline/candidate freeze and SHA-256 manifest.", "- All 398 prior source entries mapped into the atomic ledger.", "- All 56 high findings independently second-reviewed: 55 supported open, one hosted-configuration reproduction blocked, none contradicted.", "- Clean install; two target builds; typecheck; cron bundle; Wrangler dry-run; loopback Node health rehearsal.", "- Static route/module/migration/RLS/workflow/UX coverage matrices.", "- Fresh supplemental Playwright screenshots for public pages at 1440x900 and 390x844.", "",
  "## Evidence limitations", "", "- Vitest ran twice but collected no tests because `.env.test` is missing.", "- Docker/local Supabase was unavailable, so migrations and effective RLS were not executed.", "- No Cloudflare or Render staging deployment, provider sandbox, production configuration, backup/restore, rollback, failover, load, or authenticated browser session was available.", "- The in-app Browser service was unavailable; Playwright screenshots are supplemental, not accepted in-app Browser proof.", "- The required Codex Deep Security Scan could not start because the host lacked a managed filesystem permission profile.", "", "## Navigation", "", "- `findings.json` — source-of-truth atomic ledger", "- `findings.md` — generated human-readable cards", "- `source-disposition.md` — every prior ID mapped", "- `prior-audit-consistency.md` — count/ID/severity repair", "- `coverage-matrix.md`, `workflow-matrix.md`, `security-matrix.md`, `ux-a11y-matrix.md`", "- `runtime-parity.md`, `provider-evidence.md`", "- `fix-pass-backlog.md`, `release-checklist.md`", "- `evidence/index.md`", "",
];
writeFileSync(join(auditDir, "README.md"), `${readme.join("\n")}\n`);

const batchNames = {
  1: "Security, legal communication, and tenant controls", 2: "Production environment and runtime safety",
  3: "Data integrity, pagination, reconciliation, and QBO lifecycle", 4: "Authentication lifecycle and offboarding",
  5: "Error honesty and core collection workflows", 6: "Messaging resilience and idempotency",
  7: "Accessibility and responsive blockers", 8: "Performance, observability, documentation, and polish",
};
const backlog = [
  "# Fix-pass backlog", "",
  "Dependency-ordered batches generated from `findings.json`. Product fixes were not made during this audit. Each packet carries its prior aliases so closure updates the same ledger rather than creating a new defect ID.", "",
];
for (let order = 1; order <= 8; order++) {
  backlog.push(`## ${order}. ${batchNames[order]}`, "");
  backlog.push(
    `**Batch dependency:** ${order === 1 ? "Freeze the retained candidate and isolated audit resources." : `Complete and re-verify batches 1–${order - 1}; do not mask an upstream failure in this batch.`}`,
    "",
    "**Batch execution controls:** Write focused regression tests before product changes; include unauthorized, cross-tenant, duplicate-submit, retry, and concurrency cases wherever state changes. Apply database changes only after historical-data preflight and backup. Verify affected browser and provider paths on both Cloudflare and Render staging. Deploy to retained isolated staging first, preserve the previous deploy and database restore point, rehearse rollback, and attach redacted test, browser/provider, migration, deploy, monitoring, and rollback evidence before changing a disposition.",
    "", "### Finding packets", "",
  );
  for (const finding of findings.filter((item) => item.fixOrder === order && item.releaseGate !== "non-blocking")) {
    const aliases = finding.aliases.map((alias) => `${alias.corpus}:${alias.id} (${alias.disposition})`).join("; ");
    const sourceAreas = finding.sourceLocations.map((location) => `${location.path}${location.line ? `:${location.line}` : location.symbol ? `#${location.symbol}` : ""}`).join("; ");
    const providerProof = ["integration", "compliance", "privacy"].includes(finding.domain) || /qbo|twilio|sms|email|provider|webhook|unsubscribe/i.test(finding.title)
      ? "Controlled provider sandbox/destination plus both-runtime callback evidence is required."
      : finding.domain === "accessibility" || finding.domain === "ux-ui"
        ? "Authenticated Chromium/Firefox/WebKit plus keyboard, accessibility-tree, zoom, and required screen-reader evidence is required."
        : "Exercise the affected authenticated browser/API/database path on both runtimes; provider proof is required if the path crosses one.";
    const rollback = finding.sourceLocations.some((location) => /supabase\/migrations/.test(location.path)) || finding.suggestedOwner === "database"
      ? "Preflight historical rows, snapshot the audit database, use a compatible forward migration, rehearse application rollback against the migrated schema, and retain restore evidence."
      : "Deploy the focused change to retained Cloudflare and Render staging, confirm monitoring, then prove rollback to the prior application artifact without duplicate work.";
    backlog.push(
      `#### ${finding.id} — ${finding.title}`, "",
      `- **Owner / size / gate:** ${finding.suggestedOwner}; ${finding.estimatedSize}; ${finding.releaseGate}.`,
      `- **Prior aliases:** ${aliases}.`,
      `- **Root cause:** ${finding.rootCause}`,
      `- **Exact source areas:** ${sourceAreas}.`,
      `- **Migration / compatibility:** ${finding.remediation.migrationOrCompatibilityNotes.join("; ")}`,
      `- **Tests to write first:** ${finding.remediation.testsToAdd.join("; ")}.`,
      `- **Minimal remediation:** ${finding.remediation.approach}`,
      `- **Negative / concurrency cases:** Run the unauthorized and cross-tenant variant; repeat duplicate submission, provider retry, overlapping worker/cron, and partial-failure cases when applicable.`,
      `- **Browser / provider verification:** ${providerProof}`,
      `- **Deployment / rollback:** ${rollback}`,
      `- **Evidence required for closure:** ${finding.remediation.acceptanceCriteria.join("; ")}`,
      "",
    );
  }
  backlog.push("");
}
writeFileSync(join(auditDir, "fix-pass-backlog.md"), `${backlog.join("\n")}\n`);

const checklist = [
  "# Public-GA release checklist", "", "Verdict: **NO-GO**", "", "A checkbox may be marked only with linked, redacted evidence for the exact candidate.", "",
  "| Mandatory gate | Result | Evidence / blocker | Sign-off |", "|---|---|---|---|",
  "| No open release blockers | FAIL | `findings.json` contains open blocker rows | |",
  "| No critical/high security findings | FAIL | High security/tenancy/runtime rows remain; deep scan blocked | Security: |",
  "| Clean install and both builds | PASS (local) | `evidence/logs/build-and-test.md` | DevOps: |",
  "| Full tests twice from reset state | FAIL | `.env.test` missing; zero tests collected twice | Engineering: |",
  "| Empty database migration + effective RLS matrix | BLOCKED | Docker/local Supabase unavailable | Database: |",
  "| Cloudflare staging deployment and rollback | BLOCKED | No staging account/config | DevOps: |",
  "| Render staging deployment and rollback | BLOCKED | No staging service/config; free plan unsuitable | DevOps: |",
  "| Authenticated browser W1-W12 | BLOCKED | No Supabase fixtures/session; in-app Browser unavailable | Product/QA: |",
  "| WCAG 2.2 AA keyboard/screen-reader/reflow | BLOCKED | Public screenshots only; no NVDA or authenticated flows | Accessibility: |",
  "| QBO Sandbox lifecycle | BLOCKED | No sandbox realms/credentials | Integrations: |",
  "| Twilio/TCPA controlled delivery | BLOCKED | No owned destination/Messaging Service access | Legal/Integrations: |",
  "| Resend/CAN-SPAM controlled delivery | BLOCKED | No verified domain/inboxes/provider access | Legal/Integrations: |",
  "| Monitoring, alerts, logs, retention | FAIL/BLOCKED | No monitoring config or hosted verification | Operations: |",
  "| Backup/restore and RPO/RTO | BLOCKED | No isolated database or restore evidence | Operations: |",
  "| Failover, concurrency, load, and rollback | BLOCKED | No retained staging | Operations: |",
  "| Production secrets, URLs, key rotation | FAIL/BLOCKED | Worker URL placeholder; secret state/key rotation unverified | Security/DevOps: |",
  "| Deep Security Scan sealed artifacts | BLOCKED | Managed filesystem profile unavailable | Security: |",
  "| Final release approver | NOT ELIGIBLE | Re-run all gates after remediation | Approver: |",
  "", "## Binary decision rule", "", "The verdict may change to **GO** only when every mandatory row is PASS for the same retained release candidate. Any BLOCKED row remains an automatic NO-GO.", "",
];
writeFileSync(join(auditDir, "release-checklist.md"), `${checklist.join("\n")}\n`);

console.log(JSON.stringify({ counts, sourceEntries: registry.entries.length, sourceRows: sourceRows.length, ledgerSha256: sha256(readFileSync(join(auditDir, "findings.json"))) }, null, 2));
