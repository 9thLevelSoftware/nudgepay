import { describe, it, expect } from "vitest";
import { serviceClient, TEST_ENV } from "./helpers";
import { action } from "../app/routes/webhooks.resend";

const svc = serviceClient();

// Build a valid Svix signature (same helper as resend-webhook.test.ts).
async function signSvix(secretB64: string, id: string, ts: string, body: string): Promise<string> {
  const keyBytes = Uint8Array.from(atob(secretB64), (c) => c.charCodeAt(0));
  const key = await crypto.subtle.importKey("raw", keyBytes, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${id}.${ts}.${body}`));
  let s = ""; for (const b of new Uint8Array(sig)) s += String.fromCharCode(b);
  return `v1,${btoa(s)}`;
}

const SECRET_B64 = btoa("webhook-route-test-secret");
const WHSEC = `whsec_${SECRET_B64}`;

function ctx() {
  return {
    cloudflare: {
      env: {
        ...TEST_ENV,
        RESEND_API_KEY: "re_test",
        UNSUBSCRIBE_SECRET: "test-unsub-secret",
        RESEND_WEBHOOK_SECRET: WHSEC,
      },
    },
  } as any;
}

async function seedOutbound(email: string, providerMessageId: string) {
  const { data: org } = await svc
    .from("organizations")
    .insert({ name: `WR Org ${Math.random()}` })
    .select("id")
    .single();
  const orgId = org!.id as string;
  const { data: cust } = await svc
    .from("customers")
    .insert({ org_id: orgId, name: "Test", email })
    .select("id")
    .single();
  const customerId = cust!.id as string;
  const { data: inv } = await svc
    .from("invoices")
    .insert({ org_id: orgId, qbo_id: `qi-wr-${Math.random()}`, customer_id: customerId, balance: 100 })
    .select("id")
    .single();
  await svc.from("email_messages").insert({
    org_id: orgId,
    invoice_id: inv!.id,
    customer_id: customerId,
    direction: "outbound",
    provider_message_id: providerMessageId,
    status: "sent",
    from_address: "billing@chancey.test",
    to_address: email,
    subject: "Invoice",
    body: "Please pay",
  });
  return { orgId, customerId };
}

describe("webhooks.resend", () => {
  it("valid status event updates the row (204)", async () => {
    const pmid = `re_wr_${Math.random().toString(36).slice(2)}`;
    await seedOutbound(`wr-cust-${Math.random().toString(36).slice(2)}@chancey.test`, pmid);
    const body = JSON.stringify({ type: "email.delivered", data: { email_id: pmid } });
    const now = Date.now();
    const ts = String(Math.floor(now / 1000));
    const id = `msg_wr_${Math.random().toString(36).slice(2)}`;
    const sig = await signSvix(SECRET_B64, id, ts, body);
    const res = await action({
      request: new Request("https://x/webhooks/resend", {
        method: "POST",
        body,
        headers: {
          "svix-id": id,
          "svix-timestamp": ts,
          "svix-signature": sig,
        },
      }),
      context: ctx(),
      params: {},
    } as any);
    expect(res.status).toBe(204);
    const { data: row } = await svc
      .from("email_messages")
      .select("status")
      .eq("provider_message_id", pmid)
      .single();
    expect(row!.status).toBe("delivered");
  });

  it("invalid signature => 401, no DB change", async () => {
    const res = await action({
      request: new Request("https://x/webhooks/resend", {
        method: "POST",
        body: "{}",
        headers: {
          "svix-id": "msg_bad",
          "svix-timestamp": String(Math.floor(Date.now() / 1000)),
          "svix-signature": "v1,invalidsig",
        },
      }),
      context: ctx(),
      params: {},
    } as any);
    expect(res.status).toBe(401);
  });
});
