import { expect, test } from "vitest";
import { serviceClient, TEST_ENV } from "./helpers";
import { runScheduledCdc } from "../app/lib/qbo-cron.server";
import { action as webhookAction } from "../app/routes/webhooks.qbo";
import { signQboPayload } from "../app/lib/qbo-webhook.server";

function ctx() {
  return { cloudflare: { env: TEST_ENV } } as any;
}

test("cron records a 'cdc' sync_error for a connected-but-tokenless org", async () => {
  const svc = serviceClient();
  const { data: org } = await svc.from("organizations").insert({ name: "Cron Wiring Org" }).select("id").single();
  const orgId = org!.id as string;
  // status 'connected' but no refresh token => getValidAccessToken throws.
  await svc.from("qbo_connections").insert({ org_id: orgId, realm_id: "CRON-R1", status: "connected" });

  await runScheduledCdc(TEST_ENV);

  const { data } = await svc.from("sync_errors")
    .select("source, scope, resolved_at").eq("org_id", orgId);
  expect(data!.length).toBe(1);
  expect(data![0].source).toBe("cron");
  expect(data![0].scope).toBe("cdc");
  expect(data![0].resolved_at).toBe(null);
});

test("webhook isolates a failing event: records it and returns 500", async () => {
  const svc = serviceClient();
  const { data: org } = await svc.from("organizations").insert({ name: "WH Wiring Org" }).select("id").single();
  const orgId = org!.id as string;
  await svc.from("qbo_connections").insert({ org_id: orgId, realm_id: "WH-R1", status: "connected" });

  // Legacy webhook payload shape: one Invoice event for our realm.
  const body = JSON.stringify({
    eventNotifications: [{
      realmId: "WH-R1",
      dataChangeEvent: { entities: [{ name: "Invoice", id: "777", operation: "Update" }] },
    }],
  });
  const signature = await signQboPayload(body, TEST_ENV.QBO_WEBHOOK_VERIFIER_TOKEN);
  const request = new Request("http://localhost/webhooks/qbo", {
    method: "POST", headers: { "intuit-signature": signature }, body,
  });

  const res = await webhookAction({ request, context: ctx(), params: {} } as any);
  expect(res.status).toBe(500); // hadFailure -> Intuit retries

  const { data } = await svc.from("sync_errors").select("source, scope").eq("org_id", orgId);
  expect(data!.length).toBe(1);
  expect(data![0].source).toBe("webhook");
  expect(data![0].scope).toBe("invoice:777");
});
