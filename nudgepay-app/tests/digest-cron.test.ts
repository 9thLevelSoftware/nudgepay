import { expect, test, vi } from "vitest";
import { serviceClient, makeUserClient, TEST_ENV } from "./helpers";
import { storeConnection } from "../app/lib/qbo-connection.server";
import { runScheduledDigest } from "../app/lib/digest-cron.server";

const KEY = TEST_ENV.QBO_ENCRYPTION_KEY;

// getEmailEnvOrNull requires these three; not present in .env.test (kept
// email-optional there for the rest of the suite) so they're added inline.
const DIGEST_ENV: Record<string, string> = {
  ...TEST_ENV,
  RESEND_API_KEY: "test-resend-key",
  UNSUBSCRIBE_SECRET: "test-unsub-secret",
  RESEND_WEBHOOK_SECRET: "test-resend-webhook-secret",
  APP_PUBLIC_BASE_URL: "https://app.nudgepay.test",
};

async function setUpOrg(email: string, opts: { digestHourLocal: number; timezone: string; nextActionAt: string }) {
  const svc = serviceClient();
  const user = await makeUserClient(email);
  const { data: org } = await svc.from("organizations").insert({ name: `Digest Org ${user.userId}` }).select("id").single();
  const orgId = org!.id as string;
  await svc.from("memberships").insert({ org_id: orgId, user_id: user.userId, role: "owner" });
  await storeConnection(svc, KEY, orgId, `realm-digest-${user.userId}`, { accessToken: "AT", refreshToken: "RT", expiresIn: 3600 });
  await svc.from("email_config").insert({ org_id: orgId, email_enabled: true, from_address: "alerts@nudgepay.test", from_name: "NudgePay" });
  await svc.from("org_settings").insert({
    org_id: orgId, timezone: opts.timezone, digest_hour_local: opts.digestHourLocal, last_digest_date: null,
  });
  const { data: cust } = await svc.from("customers")
    .insert({ org_id: orgId, qbo_id: `digest-cust-${user.userId}`, name: "Acme Digest Co", owner: user.userId })
    .select("id").single();
  await svc.from("collection_cases").insert({
    org_id: orgId, customer_id: cust!.id, status: "working",
    next_action_type: "follow_up", next_action_at: opts.nextActionAt,
  });
  return { svc, orgId, user, email };
}

// runScheduledDigest scans EVERY connected org system-wide, so the shared test
// DB means other orgs (from this file's own earlier tests, or the wider
// suite) can legitimately fire at the same injected `now`. Assertions below
// therefore key on "was *this* recipient emailed" (by inspecting the Resend
// call bodies) rather than a raw global call count.
function mockResendFetch() {
  const realFetch = globalThis.fetch;
  const sentTo: string[] = [];
  const fetchFn = vi.fn(async (url: string, init?: RequestInit) => {
    if (String(url).includes("api.resend.com")) {
      const body = init?.body ? JSON.parse(String(init.body)) : {};
      if (body.to) sentTo.push(String(body.to));
      return new Response(JSON.stringify({ id: "resend-test-id" }), { status: 200, headers: { "Content-Type": "application/json" } });
    }
    return realFetch(url, init);
  });
  return { fetchFn, sentTo, realFetch };
}

async function withMockedFetch<T>(fn: (m: ReturnType<typeof mockResendFetch>) => Promise<T>): Promise<T> {
  const mock = mockResendFetch();
  globalThis.fetch = mock.fetchFn as any;
  try {
    return await fn(mock);
  } finally {
    globalThis.fetch = mock.realFetch;
  }
}

test("does not fire before the org-local digest hour", async () => {
  const { svc, orgId, email } = await setUpOrg("digest-before@example.com", {
    digestHourLocal: 8, timezone: "America/New_York", nextActionAt: "2026-01-15",
  });
  const { sentTo } = await withMockedFetch((m) =>
    // 11:00Z = 06:00 EST — before the configured 8am local hour.
    runScheduledDigest(DIGEST_ENV, new Date("2026-01-15T11:00:00Z")).then(() => m),
  );
  expect(sentTo).not.toContain(email);

  const { data: settings } = await svc.from("org_settings").select("last_digest_date").eq("org_id", orgId).single();
  expect(settings!.last_digest_date).toBeNull();
});

test("fires once the org-local hour reaches digest_hour_local and records last_digest_date", async () => {
  const { svc, orgId, email } = await setUpOrg("digest-fire@example.com", {
    digestHourLocal: 8, timezone: "America/New_York", nextActionAt: "2026-01-15",
  });
  const { sentTo } = await withMockedFetch((m) =>
    // 13:00Z = 08:00 EST — exactly the configured send hour.
    runScheduledDigest(DIGEST_ENV, new Date("2026-01-15T13:00:00Z")).then(() => m),
  );
  expect(sentTo.filter((t) => t === email).length).toBe(1);

  const { data: settings } = await svc.from("org_settings").select("last_digest_date").eq("org_id", orgId).single();
  expect(settings!.last_digest_date).toBe("2026-01-15");
});

test("does not fire twice on the same org-local day", async () => {
  const { svc, orgId, email } = await setUpOrg("digest-once@example.com", {
    digestHourLocal: 8, timezone: "America/New_York", nextActionAt: "2026-01-15",
  });

  const first = await withMockedFetch((m) =>
    runScheduledDigest(DIGEST_ENV, new Date("2026-01-15T13:00:00Z")).then(() => m), // 08:00 EST
  );
  expect(first.sentTo.filter((t) => t === email).length).toBe(1);

  const second = await withMockedFetch((m) =>
    // Same org-local day, several hours later — must not re-send to this recipient.
    runScheduledDigest(DIGEST_ENV, new Date("2026-01-15T18:00:00Z")).then(() => m), // 13:00 EST
  );
  expect(second.sentTo).not.toContain(email);

  const { data: settings } = await svc.from("org_settings").select("last_digest_date").eq("org_id", orgId).single();
  expect(settings!.last_digest_date).toBe("2026-01-15");
});

test("catches up the day after a missed send", async () => {
  const { svc, orgId, email } = await setUpOrg("digest-catchup@example.com", {
    digestHourLocal: 8, timezone: "America/New_York", nextActionAt: "2026-01-15",
  });
  await svc.from("org_settings").update({ last_digest_date: "2026-01-14" }).eq("org_id", orgId);

  const { sentTo } = await withMockedFetch((m) =>
    // 13:00Z = 08:00 EST on 2026-01-15 — last_digest_date is the day before.
    runScheduledDigest(DIGEST_ENV, new Date("2026-01-15T13:00:00Z")).then(() => m),
  );
  expect(sentTo.filter((t) => t === email).length).toBe(1);

  const { data: settings } = await svc.from("org_settings").select("last_digest_date").eq("org_id", orgId).single();
  expect(settings!.last_digest_date).toBe("2026-01-15");
});
