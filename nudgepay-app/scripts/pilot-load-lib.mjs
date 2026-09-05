const PRODUCTION_HOSTS = new Set(["nudgepay.9thlevelsoftware.com", "nudgepay.com", "www.nudgepay.com"]);
const MAX_REPORTED_FAILURES = 100;
const HISTOGRAM_BIN_MS = 10;
const HISTOGRAM_MAX_MS = 120_000;
export const READ_ONLY_ROUTES = ["/dashboard", "/accounts", "/promises", "/messages"];
export const QUALIFICATION_LIMITS = { p95Ms: 2_000, errorRate: 0.01 };
export const PILOT_PROFILE = "pilot";
export const DIAGNOSTIC_PROFILE = "diagnostic";
export const MIN_SUCCESSFUL_SAMPLES_PER_ROUTE_PER_SESSION = 1;
export function profileMinimums(profile) { return profile === PILOT_PROFILE ? { durationSeconds: 3_600, concurrency: 50 } : { durationSeconds: 1, concurrency: 1 }; }

export function parsePositiveInteger(value, name, fallback, { min = 1, max = Number.MAX_SAFE_INTEGER } = {}) {
  if (value === undefined) return fallback;
  if (!/^\d+$/.test(value) || !Number.isSafeInteger(Number(value)) || Number(value) < min || Number(value) > max) throw new Error(`${name} must be a safe integer from ${min} through ${max}.`);
  return Number(value);
}
export function assertStagingOrigin(origin, allowedOrigins) {
  let url;
  try { url = new URL(origin); } catch { throw new Error("--origin must be an absolute HTTPS staging URL."); }
  if (url.protocol !== "https:" || url.username || url.password || url.pathname !== "/" || url.search || url.hash) throw new Error("--origin must be an exact HTTPS origin without credentials, path, query, or fragment.");
  if (PRODUCTION_HOSTS.has(url.hostname.toLowerCase())) throw new Error("Refusing production origin. Pilot load runs only against an explicitly allowlisted staging origin.");
  if (!allowedOrigins.includes(url.origin)) throw new Error("Origin is not in the staging allowlist (PILOT_LOAD_ALLOWED_ORIGINS); refusing to send traffic.");
  return url.origin;
}
function validCookie(cookie) { return typeof cookie === "string" && /^[^=;,\s]+=[^\r\n]+$/.test(cookie.trim()); }
function parseCookieValues(value) {
  const values = Array.isArray(value) ? value : [value];
  if (values.length < 1 || values.length > 50 || values.some((cookie) => !validCookie(cookie))) throw new Error("Cookie fixture must contain 1–50 non-empty Cookie header values without line breaks.");
  const cookies = values.map((cookie) => cookie.trim());
  if (new Set(cookies).size !== cookies.length) throw new Error("Cookie fixture contexts must be distinct.");
  return cookies;
}
export function parseSessionFixture(rawFixture) {
  const fixture = rawFixture.trim();
  if (!fixture) throw new Error("Cookie fixture is empty.");
  if (!fixture.startsWith("{") && !fixture.startsWith("[")) return { sessions: parseCookieValues(fixture).map((cookie, index) => ({ cookie, label: `context-${index + 1}`, workspace: null })), provenance: null };
  let parsed;
  try { parsed = JSON.parse(fixture); } catch { throw new Error("Cookie JSON fixture is invalid."); }
  if (!parsed || Array.isArray(parsed) || typeof parsed !== "object") throw new Error("Cookie JSON fixture must be an object.");
  if (Array.isArray(parsed.sessions)) {
    const allowed = new Set(["format", "localOnly", "source", "sessions"]);
    if (Object.keys(parsed).some((key) => !allowed.has(key)) || parsed.format !== "nudgepay-pilot-session-fixture/v1" || typeof parsed.localOnly !== "boolean" || !parsed.source || typeof parsed.source !== "object" || !["local-pilot-fixture", "staging-pilot-fixture"].includes(parsed.source.kind) || (parsed.source.kind === "local-pilot-fixture" && parsed.localOnly !== true) || (parsed.source.kind === "staging-pilot-fixture" && parsed.localOnly !== false)) throw new Error("Labeled pilot session fixture has an invalid provenance envelope.");
    if (parsed.sessions.length < 1 || parsed.sessions.length > 50 || parsed.sessions.some((entry) => !entry || typeof entry !== "object" || !validCookie(entry.cookie) || typeof entry.session !== "string" || !/^pilot-session-\d{2}$/.test(entry.session) || typeof entry.workspace !== "string" || !/^pilot-workspace-\d{2}$/.test(entry.workspace) || Object.keys(entry).some((key) => !["cookie", "session", "workspace"].includes(key)))) throw new Error("Labeled pilot session fixture must contain 1–50 unique session/workspace/cookie entries.");
    const cookies = parseCookieValues(parsed.sessions.map((entry) => entry.cookie));
    if (new Set(parsed.sessions.map((entry) => entry.session)).size !== parsed.sessions.length) throw new Error("Labeled pilot session fixture session labels must be distinct.");
    return { sessions: parsed.sessions.map((entry, index) => ({ cookie: cookies[index], label: entry.session, workspace: entry.workspace })), provenance: parsed.source };
  }
  const keys = Object.keys(parsed);
  if (keys.length !== 1 || !["cookie", "cookies"].includes(keys[0])) throw new Error("Cookie JSON fixture must contain exactly cookie or cookies.");
  return { sessions: parseCookieValues("cookie" in parsed ? parsed.cookie : parsed.cookies).map((cookie, index) => ({ cookie, label: `context-${index + 1}`, workspace: null })), provenance: null };
}
export function parseCookieFixture(rawFixture) { return parseSessionFixture(rawFixture).sessions.map((session) => session.cookie); }
export function assertPilotFixtureContract(fixture, origin) {
  if (!fixture.provenance || fixture.provenance.kind !== "staging-pilot-fixture" || typeof fixture.provenance.origin !== "string" || fixture.provenance.origin !== origin || typeof fixture.provenance.prefix !== "string" || !fixture.provenance.totals || typeof fixture.provenance.totals !== "object") throw new Error("Pilot profile requires a staging fixture bound to the exact runner origin.");
  const totals = fixture.provenance.totals;
  if (totals.organizations !== 10 || totals.users !== 50 || ["invoices", "cases", "messages"].some((key) => !Number.isSafeInteger(totals[key]) || totals[key] < 49_990 || totals[key] > 50_010)) throw new Error("Pilot fixture provenance must declare ten full boundary datasets.");
  if (fixture.sessions.length !== 50) throw new Error("Pilot profile requires exactly 50 session contexts.");
  const workspaceCounts = Object.fromEntries(fixture.sessions.reduce((all, session) => all.set(session.workspace, (all.get(session.workspace) ?? 0) + 1), new Map()));
  if (Object.keys(workspaceCounts).length !== 10 || Object.values(workspaceCounts).some((count) => count !== 5)) throw new Error("Pilot profile requires five sessions in each of ten distinct workspaces.");
  const workspaces = fixture.provenance.workspaces;
  if (!Array.isArray(workspaces) || workspaces.length !== 10 || workspaces.some((workspace) => !workspace || typeof workspace !== "object" || typeof workspace.workspace !== "string" || !Object.prototype.hasOwnProperty.call(workspaceCounts, workspace.workspace) || ["invoices", "cases", "messages"].some((key) => !Number.isSafeInteger(workspace[key]) || workspace[key] < 4_999 || workspace[key] > 5_001))) throw new Error("Pilot fixture provenance must include ten per-workspace 4,999–5,001 dataset counts.");
  for (const key of ["invoices", "cases", "messages"]) if (workspaces.reduce((sum, workspace) => sum + workspace[key], 0) !== totals[key]) throw new Error(`Pilot fixture per-workspace ${key} counts do not match the declared total.`);
  return { distinctWorkspaceLabels: Object.keys(workspaceCounts).length, totals, workspaceCounts };
}
export function isSuccessfulAuthenticatedHtml(status, contentType, body) {
  return status === 200 && contentType.includes("text/html") && /<html[\s>]/i.test(body) && /<main\b[^>]*\bid=["']main-content["']/i.test(body) && !/<title>\s*[^<]*\blog in\b[^<]*<\/title>/i.test(body) && !/action=["'][^"']*\/login(?:["'?]|$)/i.test(body);
}
export class MetricsAccumulator {
  constructor(routes = READ_ONLY_ROUTES) { this.routes = Object.fromEntries(routes.map((route) => [route, { requests: 0, successes: 0, errors: 0 }])); this.sessions = {}; this.histogram = new Uint32Array(Math.ceil(HISTOGRAM_MAX_MS / HISTOGRAM_BIN_MS) + 1); this.requests = 0; this.successes = 0; this.errors = 0; this.failures = []; }
  record(result) {
    this.requests++; const route = this.routes[result.route] ?? (this.routes[result.route] = { requests: 0, successes: 0, errors: 0 }); const label = result.sessionLabel ?? "unlabeled"; const session = this.sessions[label] ?? (this.sessions[label] = { workspace: result.workspace ?? null, requests: 0, successes: 0, errors: 0, routes: {} }); const sessionRoute = session.routes[result.route] ?? (session.routes[result.route] = { requests: 0, successes: 0, errors: 0 });
    route.requests++; session.requests++; sessionRoute.requests++; this.histogram[Math.min(this.histogram.length - 1, Math.floor(Math.max(0, result.durationMs) / HISTOGRAM_BIN_MS))]++;
    if (result.ok) { this.successes++; route.successes++; session.successes++; sessionRoute.successes++; } else { this.errors++; route.errors++; session.errors++; sessionRoute.errors++; if (this.failures.length < MAX_REPORTED_FAILURES) this.failures.push({ route: result.route, sessionLabel: label, status: result.status, error: result.error }); }
  }
  percentile(fraction) { if (!this.requests) return null; const rank = Math.ceil(this.requests * fraction); let observed = 0; for (let index = 0; index < this.histogram.length; index++) { observed += this.histogram[index]; if (observed >= rank) return index * HISTOGRAM_BIN_MS; } return HISTOGRAM_MAX_MS; }
  summary() { const errorRate = this.requests ? this.errors / this.requests : 0; const sessionEntries = Object.entries(this.sessions); const workspaces = new Set(sessionEntries.map(([, value]) => value.workspace).filter(Boolean)); const successfulWorkspaces = new Set(sessionEntries.filter(([, value]) => value.successes > 0).map(([, value]) => value.workspace).filter(Boolean)); return { requests: this.requests, successes: this.successes, errors: this.errors, errorRate, p50Ms: this.percentile(0.5), p95Ms: this.percentile(0.95), routes: this.routes, sessions: this.sessions, sessionUtilization: { contextsObserved: sessionEntries.length, contextsWithSuccesses: sessionEntries.filter(([, value]) => value.successes > 0).length, workspacesObserved: workspaces.size, workspacesWithSuccesses: successfulWorkspaces.size }, failures: this.failures, failuresTruncated: this.errors > this.failures.length }; }
}
export function qualificationOutcome(summary, limits = QUALIFICATION_LIMITS, profile = DIAGNOSTIC_PROFILE, expectedSessions = []) {
  const reasons = [];
  if (summary.requests === 0) reasons.push("no_requests");
  if (summary.p95Ms !== null && summary.p95Ms >= limits.p95Ms) reasons.push("p95_limit");
  if (summary.errorRate >= limits.errorRate) reasons.push("error_rate_limit");
  if (profile === PILOT_PROFILE) {
    if (expectedSessions.length !== 50) reasons.push("expected_session_contexts");
    for (const route of READ_ONLY_ROUTES) if ((summary.routes[route]?.successes ?? 0) < MIN_SUCCESSFUL_SAMPLES_PER_ROUTE_PER_SESSION) reasons.push(`route_coverage:${route}`);
    for (const expected of expectedSessions) {
      const session = summary.sessions?.[expected.label];
      if (!session) { reasons.push(`session_not_observed:${expected.label}`); continue; }
      for (const route of READ_ONLY_ROUTES) if ((session.routes[route]?.successes ?? 0) < MIN_SUCCESSFUL_SAMPLES_PER_ROUTE_PER_SESSION) reasons.push(`session_route_coverage:${expected.label}:${route}`);
    }
  }
  return { passed: reasons.length === 0, profile, limits, reasons };
}
