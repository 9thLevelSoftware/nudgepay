import { expect, test } from "vitest";
import { TEST_ENV } from "./helpers";
import { action as inboundAction } from "../app/routes/webhooks.twilio.inbound";
import { action as statusAction } from "../app/routes/webhooks.twilio.status";

function ctx() {
  return { cloudflare: { env: TEST_ENV } } as any;
}

test("inbound webhook rejects a bad signature with 403 before any DB work", async () => {
  const request = new Request("http://localhost/webhooks/twilio/inbound", {
    method: "POST",
    headers: { "X-Twilio-Signature": "wrong", "Content-Type": "application/x-www-form-urlencoded" },
    body: "From=%2B12295550101&Body=hi&MessageSid=SMx",
  });
  const res = await inboundAction({ request, context: ctx(), params: {} } as any);
  expect(res.status).toBe(403);
});

test("inbound webhook rejects a missing signature header with 403", async () => {
  const request = new Request("http://localhost/webhooks/twilio/inbound", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: "From=%2B1&Body=hi",
  });
  const res = await inboundAction({ request, context: ctx(), params: {} } as any);
  expect(res.status).toBe(403);
});

test("status webhook rejects a bad signature with 403", async () => {
  const request = new Request("http://localhost/webhooks/twilio/status", {
    method: "POST",
    headers: { "X-Twilio-Signature": "wrong", "Content-Type": "application/x-www-form-urlencoded" },
    body: "MessageSid=SMx&MessageStatus=delivered",
  });
  const res = await statusAction({ request, context: ctx(), params: {} } as any);
  expect(res.status).toBe(403);
});
