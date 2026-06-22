import { expect, test } from "vitest";
import { TEST_ENV } from "./helpers";
import { action } from "../app/routes/webhooks.qbo";

function ctx() {
  return { cloudflare: { env: TEST_ENV } } as any;
}

test("rejects a request with a bad signature (401) before any processing", async () => {
  const request = new Request("http://localhost/webhooks/qbo", {
    method: "POST",
    headers: { "intuit-signature": "not-a-valid-signature" },
    body: JSON.stringify({ eventNotifications: [] }),
  });
  const res = await action({ request, context: ctx(), params: {} } as any);
  expect(res.status).toBe(401);
});

test("rejects a request with no signature header (401)", async () => {
  const request = new Request("http://localhost/webhooks/qbo", {
    method: "POST",
    body: JSON.stringify({ eventNotifications: [] }),
  });
  const res = await action({ request, context: ctx(), params: {} } as any);
  expect(res.status).toBe(401);
});
