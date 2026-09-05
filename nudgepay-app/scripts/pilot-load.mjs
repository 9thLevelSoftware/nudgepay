#!/usr/bin/env node
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { DIAGNOSTIC_PROFILE, PILOT_PROFILE, MetricsAccumulator, READ_ONLY_ROUTES, assertPilotFixtureContract, assertStagingOrigin, isSuccessfulAuthenticatedHtml, parsePositiveInteger, parseSessionFixture, profileMinimums, qualificationOutcome } from "./pilot-load-lib.mjs";

const VALUE_FLAGS = new Set(["origin", "cookie-file", "duration-seconds", "concurrency", "timeout-ms", "output", "profile"]);
function usage() { return "Usage: PILOT_LOAD_ALLOWED_ORIGINS=https://staging.example.com node scripts/pilot-load.mjs --origin https://staging.example.com --cookie-file C:\\secure\\fixture.json [--profile diagnostic|pilot] [--duration-seconds 30] [--concurrency 1] [--timeout-ms 10000] [--output C:\\qualification\\pilot.json] [--dry-run]"; }
function options(argv) {
  const parsed = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--dry-run" || arg === "--help") { if (parsed[arg]) throw new Error(`Duplicate flag: ${arg}`); parsed[arg] = true; continue; }
    if (!arg.startsWith("--") || !VALUE_FLAGS.has(arg.slice(2))) throw new Error(`Unknown argument: ${arg}`);
    if (parsed[arg.slice(2)] !== undefined) throw new Error(`Duplicate flag: ${arg}`);
    const value = argv[++i];
    if (!value || value.startsWith("--")) throw new Error(`${arg} requires a value.`);
    parsed[arg.slice(2)] = value;
  }
  return parsed;
}
async function request(origin, route, session, timeoutMs) {
  const started = performance.now();
  try {
    const response = await fetch(`${origin}${route}`, { headers: { cookie: session.cookie, accept: "text/html,application/xhtml+xml" }, redirect: "manual", signal: AbortSignal.timeout(timeoutMs) });
    const body = await response.text();
    const ok = isSuccessfulAuthenticatedHtml(response.status, response.headers.get("content-type") ?? "", body);
    return { route, sessionLabel: session.label, workspace: session.workspace, durationMs: Math.round(performance.now() - started), ok, status: response.status, error: ok ? undefined : "unexpected_status_or_content" };
  } catch (error) { return { route, sessionLabel: session.label, workspace: session.workspace, durationMs: Math.round(performance.now() - started), ok: false, error: error instanceof Error ? error.name : "request_failed" }; }
}
async function main() {
  const args = options(process.argv.slice(2));
  if (args["--help"]) { console.log(usage()); return; }
  if (!args.origin || !args["cookie-file"]) throw new Error(usage());
  const allowedOrigins = (process.env.PILOT_LOAD_ALLOWED_ORIGINS ?? "").split(",").map((value) => value.trim()).filter(Boolean);
  const origin = assertStagingOrigin(args.origin, allowedOrigins);
  const profile = args.profile ?? DIAGNOSTIC_PROFILE;
  if (![DIAGNOSTIC_PROFILE, PILOT_PROFILE].includes(profile)) throw new Error("--profile must be diagnostic or pilot.");
  const minimums = profileMinimums(profile);
  const durationSeconds = parsePositiveInteger(args["duration-seconds"], "--duration-seconds", profile === PILOT_PROFILE ? minimums.durationSeconds : 30, { min: minimums.durationSeconds, max: 86_400 });
  const concurrency = parsePositiveInteger(args.concurrency, "--concurrency", profile === PILOT_PROFILE ? minimums.concurrency : 1, { min: minimums.concurrency, max: 50 });
  const timeoutMs = parsePositiveInteger(args["timeout-ms"], "--timeout-ms", 10_000, { min: 100, max: 120_000 });
  const output = resolve(args.output ?? `${tmpdir()}/nudgepay-pilot-load/pilot-load-${new Date().toISOString().replaceAll(":", "-")}.json`);
  const fixture = parseSessionFixture(readFileSync(resolve(args["cookie-file"]), "utf8"));
  const fixtureContract = profile === PILOT_PROFILE ? assertPilotFixtureContract(fixture, origin) : null;
  const workloadMode = fixture.sessions.length === 1 ? "single-session" : "multi-session";
  const plan = { origin, routes: READ_ONLY_ROUTES, durationSeconds, concurrency, timeoutMs, output, profile, workloadMode, fixtureContract, dryRun: !!args["--dry-run"] };
  if (plan.dryRun) { console.log(JSON.stringify({ ...plan, mode: "dry-run" }, null, 2)); return; }
  const startedAt = new Date().toISOString();
  const deadline = Date.now() + durationSeconds * 1000;
  const metrics = new MetricsAccumulator(); let cursor = 0;
  async function worker() { while (Date.now() < deadline) { const index = cursor++; const route = READ_ONLY_ROUTES[index % READ_ONLY_ROUTES.length]; const session = fixture.sessions[Math.floor(index / READ_ONLY_ROUTES.length) % fixture.sessions.length]; metrics.record(await request(origin, route, session, timeoutMs)); } }
  await Promise.all(Array.from({ length: concurrency }, worker));
  const summary = metrics.summary();
  const report = { startedAt, completedAt: new Date().toISOString(), ...plan, summary, outcome: qualificationOutcome(summary, undefined, profile, fixture.sessions) };
  mkdirSync(dirname(output), { recursive: true });
  writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
  console.log(JSON.stringify({ output, summary, outcome: report.outcome }, null, 2));
  if (!report.outcome.passed) process.exitCode = 1;
}
main().catch((error) => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });
