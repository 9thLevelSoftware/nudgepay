import { describe, it, expect } from "vitest";
import { loader, action } from "../app/routes/unsubscribe";
import { signUnsubscribeToken } from "../app/lib/unsubscribe-token";
import { serviceClient, TEST_ENV } from "./helpers";

const svc = serviceClient();

const UNSUBSCRIBE_SECRET = "test-unsubscribe-secret";

function ctx() {
  return {
    cloudflare: {
      env: {
        ...TEST_ENV,
        RESEND_API_KEY: "test-resend-key",
        UNSUBSCRIBE_SECRET,
        RESEND_WEBHOOK_SECRET: "whsec_dGVzdA==",
        APP_PUBLIC_BASE_URL: "https://app.example.com",
      },
    },
  } as any;
}

async function seedCustomer(label: string): Promise<{ orgId: string; customerId: string }> {
  const { data: org } = await svc
    .from("organizations")
    .insert({ name: `Unsub-${label} ${Math.random()}` })
    .select("id")
    .single();
  const orgId = org!.id as string;
  const { data: cust } = await svc
    .from("customers")
    .insert({ org_id: orgId, name: "Test Customer", email: `unsub-${label}-${Math.random()}@chancey.test` })
    .select("id, do_not_email")
    .single();
  expect(cust!.do_not_email).toBe(false);
  return { orgId, customerId: cust!.id as string };
}

// RFC 8058: GET (loader) only confirms; POST (action) performs the opt-out.
describe("unsubscribe route", () => {
  it("GET with a valid token does NOT mutate (renders confirm page)", async () => {
    const { orgId, customerId } = await seedCustomer("get");
    const token = await signUnsubscribeToken(UNSUBSCRIBE_SECRET, orgId, customerId);
    const result = await loader({
      request: new Request(`https://x/unsubscribe?token=${token}`),
      context: ctx(),
      params: {},
    } as any);
    const json = (result as any).data as { valid: boolean; done: boolean };
    expect(json.valid).toBe(true);
    expect(json.done).toBe(false);

    const { data: c } = await svc.from("customers").select("do_not_email").eq("id", customerId).single();
    expect(c!.do_not_email).toBe(false); // unchanged by GET
  });

  it("POST with a valid token sets do_not_email", async () => {
    const { orgId, customerId } = await seedCustomer("post");
    const token = await signUnsubscribeToken(UNSUBSCRIBE_SECRET, orgId, customerId);
    const result = await action({
      request: new Request("https://x/unsubscribe", { method: "POST", body: new URLSearchParams({ token }) }),
      context: ctx(),
      params: {},
    } as any);
    const json = (result as any).data as { valid: boolean; done: boolean };
    expect(json.done).toBe(true);

    const { data: c } = await svc.from("customers").select("do_not_email").eq("id", customerId).single();
    expect(c!.do_not_email).toBe(true);
  });

  it("renders without RESEND_API_KEY — the public opt-out is decoupled from the send key", async () => {
    const { orgId, customerId } = await seedCustomer("nokey");
    const token = await signUnsubscribeToken(UNSUBSCRIBE_SECRET, orgId, customerId);
    // Context deliberately omits RESEND_API_KEY / RESEND_WEBHOOK_SECRET.
    const noSendKeyCtx = {
      cloudflare: { env: { ...TEST_ENV, UNSUBSCRIBE_SECRET } },
    } as any;

    const get = await loader({
      request: new Request(`https://x/unsubscribe?token=${token}`),
      context: noSendKeyCtx,
      params: {},
    } as any);
    expect(((get as any).data as { valid: boolean }).valid).toBe(true);

    const post = await action({
      request: new Request("https://x/unsubscribe", { method: "POST", body: new URLSearchParams({ token }) }),
      context: noSendKeyCtx,
      params: {},
    } as any);
    expect(((post as any).data as { done: boolean }).done).toBe(true);

    const { data: c } = await svc.from("customers").select("do_not_email").eq("id", customerId).single();
    expect(c!.do_not_email).toBe(true);
  });

  it("POST with an invalid token leaves do_not_email unchanged and does not throw", async () => {
    const { customerId } = await seedCustomer("bad");
    const result = await action({
      request: new Request("https://x/unsubscribe", { method: "POST", body: new URLSearchParams({ token: "bad-token" }) }),
      context: ctx(),
      params: {},
    } as any);
    const json = (result as any).data as { valid: boolean };
    expect(json.valid).toBe(false);

    const { data: c } = await svc.from("customers").select("do_not_email").eq("id", customerId).single();
    expect(c!.do_not_email).toBe(false);
  });
});
