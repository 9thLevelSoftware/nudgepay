import { expect, test } from "vitest";
import { MAX_RESPONSE_BODY_BYTES, MetricsAccumulator, PILOT_PROFILE, assertPilotFixtureContract, assertStagingOrigin, isSuccessfulAuthenticatedHtml, parseCookieFixture, parsePositiveInteger, parseSessionFixture, profileMinimums, qualificationOutcome, readResponseBody } from "../scripts/pilot-load-lib.mjs";

test("requires exact allowlisted staging and rejects the configured production host", () => {
  expect(assertStagingOrigin("https://staging.nudgepay.example", ["https://staging.nudgepay.example"])).toBe("https://staging.nudgepay.example");
  expect(() => assertStagingOrigin("https://nudgepay.9thlevelsoftware.com", ["https://nudgepay.9thlevelsoftware.com"])).toThrow(/production/);
  expect(() => assertStagingOrigin("https://staging.nudgepay.example/admin", ["https://staging.nudgepay.example"])).toThrow(/exact HTTPS origin/);
  expect(() => assertStagingOrigin("https://unlisted.example", [])).toThrow(/allowlist/);
});

test("strictly validates cookie fixture shape and distinct session contexts", () => {
  expect(parseCookieFixture('{"cookies":["session=a","session=b"]}')).toEqual(["session=a", "session=b"]);
  expect(() => parseCookieFixture('{"cookies":["session=a","session=a"]}')).toThrow(/distinct/);
  expect(() => parseCookieFixture('{"cookie":"session=a","other":true}')).toThrow(/exactly/);
  expect(() => parseCookieFixture('{not-json')).toThrow(/invalid/);
  expect(() => parseCookieFixture("session=a\r\nX-Injected: yes")).toThrow(/Cookie/);
});

test("requires meaningful authenticated app HTML", () => {
  expect(isSuccessfulAuthenticatedHtml(200, "text/html", '<!doctype html><html><main id="main-content">Queue</main></html>')).toBe(true);
  expect(isSuccessfulAuthenticatedHtml(200, "text/html", "<html></html>")).toBe(false);
  expect(isSuccessfulAuthenticatedHtml(200, "text/html", '<html><title>Log in · NudgePay</title><main id="main-content"></main></html>')).toBe(false);
  expect(isSuccessfulAuthenticatedHtml(302, "text/html", '<html><main id="main-content"></main></html>')).toBe(false);
});

test("requires route and tenant markers on the same authenticated main element", () => {
  const expected = { route: "/messages", orgId: "a4f2fdb8-02e8-4f29-9cd9-3a4c0b8b70d7", userId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" };
  const qualifiedHtml = '<!doctype html><html><main id="main-content" data-org-id="a4f2fdb8-02e8-4f29-9cd9-3a4c0b8b70d7" data-user-id="bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" data-route-path="/messages">Messages<span data-load-complete="true"></span></main></html>';
  expect(isSuccessfulAuthenticatedHtml(200, "text/html", qualifiedHtml, expected)).toBe(true);
  expect(isSuccessfulAuthenticatedHtml(200, "text/html", qualifiedHtml.replace("/messages", "/accounts"), expected)).toBe(false);
  expect(isSuccessfulAuthenticatedHtml(200, "text/html", qualifiedHtml.replace("a4f2fdb8-02e8-4f29-9cd9-3a4c0b8b70d7", "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"), expected)).toBe(false);
  expect(isSuccessfulAuthenticatedHtml(200, "text/html", `<html><main id="main-content" data-route-path="/messages">${qualifiedHtml}</main></html>`, expected)).toBe(false);
  for (const inertTag of ["comment", "script", "template"]) {
    const inert = inertTag === "comment" ? `<!--${qualifiedHtml}-->` : `<!doctype html><html><${inertTag}>${qualifiedHtml}</${inertTag}></html>`;
    expect(isSuccessfulAuthenticatedHtml(200, "text/html", inert, expected)).toBe(false);
  }
  expect(isSuccessfulAuthenticatedHtml(200, "text/html", qualifiedHtml.slice(0, qualifiedHtml.indexOf("data-load-complete")), expected)).toBe(false);
});

test("cancels response bodies over the fixed qualification byte ceiling", async () => {
  let cancelled = false;
  const stream = new ReadableStream({
    start(controller) { controller.enqueue(new Uint8Array(MAX_RESPONSE_BODY_BYTES + 1)); },
    cancel() { cancelled = true; },
  });
  await expect(readResponseBody(new Response(stream))).resolves.toEqual({ ok: false, error: "response_too_large" });
  expect(cancelled).toBe(true);
});

test("requires each qualified route to meet latency and error limits independently", () => {
  const metrics = new MetricsAccumulator();
  for (const route of ["/dashboard", "/accounts", "/promises", "/messages"]) {
    for (let index = 0; index < 100; index++) {
      metrics.record({
        route,
        durationMs: route === "/messages" && index >= 94 ? 2_100 : 100,
        ok: !(route === "/messages" && index === 0),
        status: route === "/messages" && index === 0 ? 500 : 200,
        error: route === "/messages" && index === 0 ? "server_error" : undefined,
      });
    }
  }

  const outcome = qualificationOutcome(metrics.summary());
  expect(outcome).toMatchObject({ passed: false });
  expect(outcome.reasons).toContain("route_p95_limit:/messages");
  expect(outcome.reasons).toContain("route_error_rate_limit:/messages");
});

test("uses bounded aggregate metrics and threshold outcomes", () => {
  const metrics = new MetricsAccumulator(["/dashboard"]);
  for (let index = 0; index < 200; index++) metrics.record({ route: "/dashboard", durationMs: index < 189 ? 100 : 2_100, ok: index !== 0, status: index ? 200 : 500, error: index ? undefined : "server_error" });
  const summary = metrics.summary();
  expect(summary).toMatchObject({ requests: 200, errors: 1, p95Ms: 2100, errorRate: 0.005 });
  expect(qualificationOutcome(summary)).toMatchObject({ passed: false, qualified: false, qualificationStatus: "diagnostic_not_qualified" });
  expect(qualificationOutcome(summary).reasons).toContain("p95_limit");
  expect(qualificationOutcome({ ...summary, p95Ms: 100, errorRate: 0.01 }).reasons).toContain("error_rate_limit");
});

test("pilot qualification requires every route for every observed session", () => {
  const metrics = new MetricsAccumulator();
  const expectedSessions = Array.from({ length: 50 }, (_, index) => ({ label: `pilot-session-${String(index + 1).padStart(2, "0")}`, workspace: `pilot-workspace-${String((index % 10) + 1).padStart(2, "0")}` }));
  metrics.record({ route: "/dashboard", sessionLabel: "pilot-session-01", workspace: "pilot-workspace-01", durationMs: 100, ok: true, status: 200 });
  const outcome = qualificationOutcome(metrics.summary(), undefined, PILOT_PROFILE, expectedSessions);
  expect(outcome).toMatchObject({ passed: false });
  expect(outcome.reasons).toContain("route_coverage:/accounts");
  expect(outcome.reasons).toContain("session_route_coverage:pilot-session-01:/accounts");
  expect(outcome.reasons).toContain("session_not_observed:pilot-session-50");
});

test("pilot qualification accepts complete route and session coverage", () => {
  const metrics = new MetricsAccumulator();
  const expectedSessions = Array.from({ length: 50 }, (_, index) => ({ label: `pilot-session-${String(index + 1).padStart(2, "0")}`, workspace: `pilot-workspace-${String(Math.floor(index / 5) + 1).padStart(2, "0")}` }));
  for (const { label: sessionLabel, workspace } of expectedSessions) {
    for (const route of ["/dashboard", "/accounts", "/promises", "/messages"]) {
      metrics.record({ route, sessionLabel, workspace, durationMs: 100, ok: true, status: 200 });
    }
  }
  const summary = metrics.summary();
  expect(summary.sessionUtilization).toMatchObject({ contextsObserved: 50, workspacesObserved: 10 });
  expect(qualificationOutcome(summary, undefined, PILOT_PROFILE, expectedSessions)).toMatchObject({ passed: true, qualified: true, qualificationStatus: "qualified", profile: "pilot" });
});

test("labeled pilot sessions require fixture provenance and ten workspaces", () => {
  const origin = "https://staging.nudgepay.example";
  const workspaces = Array.from({ length: 10 }, (_, index) => ({ workspace: `pilot-workspace-${String(index + 1).padStart(2, "0")}`, orgId: `00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`, invoices: 5_000, cases: 5_000, messages: 5_000 }));
  const sessions = Array.from({ length: 50 }, (_, index) => ({ cookie: `session=${index + 1}`, session: `pilot-session-${String(index + 1).padStart(2, "0")}`, workspace: `pilot-workspace-${String(Math.floor(index / 5) + 1).padStart(2, "0")}`, orgId: `00000000-0000-4000-8000-${String(Math.floor(index / 5) + 1).padStart(12, "0")}`, userId: `10000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}` }));
  const fixture = parseSessionFixture(JSON.stringify({ format: "nudgepay-pilot-session-fixture/v1", localOnly: false, source: { kind: "staging-pilot-fixture", origin, prefix: "pilot-load-20260905", totals: { organizations: 10, users: 50, invoices: 50000, cases: 50000, messages: 50000 }, workspaces }, sessions }));
  expect(assertPilotFixtureContract(fixture, origin)).toMatchObject({ distinctWorkspaceLabels: 10 });
  expect(() => assertPilotFixtureContract({ ...fixture, sessions: fixture.sessions.map((session, index) => index === 0 ? { ...session, orgId: null } : session) }, origin)).toThrow(/organization and user IDs/);
  expect(() => assertPilotFixtureContract({ ...fixture, sessions: fixture.sessions.map((session, index) => index === 1 ? { ...session, userId: fixture.sessions[0].userId } : session) }, origin)).toThrow(/distinct user IDs/);
  expect(() => assertPilotFixtureContract({ ...fixture, provenance: { ...fixture.provenance, workspaces: fixture.provenance.workspaces.map((workspace, index) => index === 1 ? { ...workspace, orgId: fixture.provenance.workspaces[0].orgId } : workspace) } }, origin)).toThrow(/bijective/);
  expect(() => assertPilotFixtureContract(fixture, "https://other-staging.example")).toThrow(/exact runner origin/);
  const invalidWorkspaceCountFixture = { ...fixture, provenance: { ...fixture.provenance, workspaces: fixture.provenance.workspaces.map((workspace, index) => index === 0 ? { ...workspace, invoices: 4_998 } : workspace) } };
  expect(() => assertPilotFixtureContract(invalidWorkspaceCountFixture, origin)).toThrow(/exactly 5,000/);
  expect(() => assertPilotFixtureContract({ ...fixture, sessions: fixture.sessions.slice(0, 49) }, origin)).toThrow(/exactly 50/);
  const localFixture = parseSessionFixture(JSON.stringify({ format: "nudgepay-pilot-session-fixture/v1", localOnly: true, source: { ...fixture.provenance, kind: "local-pilot-fixture" }, sessions }));
  expect(() => assertPilotFixtureContract(localFixture, origin)).toThrow(/staging fixture/);
});

test("rejects malformed numeric flags", () => {
  expect(parsePositiveInteger(undefined, "--duration-seconds", 30)).toBe(30);
  expect(parsePositiveInteger("86400", "--duration-seconds", 30, { max: 86400 })).toBe(86400);
  expect(() => parsePositiveInteger("1.5", "--duration-seconds", 30)).toThrow(/safe integer/);
  expect(() => parsePositiveInteger("0", "--duration-seconds", 30)).toThrow(/safe integer/);
  expect(() => parsePositiveInteger("51", "--concurrency", 1, { max: 50 })).toThrow(/1 through 50/);
  expect(() => parsePositiveInteger("99", "--timeout-ms", 10000, { min: 100, max: 120000 })).toThrow(/100 through/);
  expect(profileMinimums(PILOT_PROFILE)).toEqual({ durationSeconds: 3600, concurrency: 50 });
  expect(() => parsePositiveInteger("3599", "--duration-seconds", 3600, { min: profileMinimums(PILOT_PROFILE).durationSeconds, max: 86400 })).toThrow(/3600 through/);
  expect(() => parsePositiveInteger("1", "--concurrency", 50, { min: profileMinimums(PILOT_PROFILE).concurrency, max: 50 })).toThrow(/50 through 50/);
});
