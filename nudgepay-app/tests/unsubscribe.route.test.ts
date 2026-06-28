import { describe, it, expect } from "vitest";
import { loader } from "../app/routes/unsubscribe";
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
        APP_PUBLIC_BASE_URL: "https://app.example.com",
      },
    },
  } as any;
}

describe("unsubscribe route", () => {
  it("valid token sets do_not_email", async () => {
    const { data: org } = await svc
      .from("organizations")
      .insert({ name: `Unsub-valid ${Math.random()}` })
      .select("id")
      .single();
    const orgId = org!.id as string;

    const { data: cust } = await svc
      .from("customers")
      .insert({ org_id: orgId, name: "Test Customer", email: "test@chancey.test" })
      .select("id, do_not_email")
      .single();
    const customerId = cust!.id as string;
    expect(cust!.do_not_email).toBe(false);

    const token = await signUnsubscribeToken(UNSUBSCRIBE_SECRET, orgId, customerId);
    const result = await loader({
      request: new Request(`https://x/unsubscribe?token=${token}`),
      context: ctx(),
      params: {},
    } as any);

    // data() from React Router v7 returns DataWithResponseInit { type, data, init }.
    const json = (result as any).data as { ok: boolean };
    expect(json.ok).toBe(true);

    const { data: updated } = await svc
      .from("customers")
      .select("do_not_email")
      .eq("id", customerId)
      .single();
    expect(updated!.do_not_email).toBe(true);
  });

  it("invalid token leaves do_not_email unchanged and does not throw", async () => {
    const { data: org } = await svc
      .from("organizations")
      .insert({ name: `Unsub-invalid ${Math.random()}` })
      .select("id")
      .single();
    const orgId = org!.id as string;

    const { data: cust } = await svc
      .from("customers")
      .insert({ org_id: orgId, name: "No Change", email: "nochange@chancey.test" })
      .select("id, do_not_email")
      .single();
    const customerId = cust!.id as string;
    expect(cust!.do_not_email).toBe(false);

    const result = await loader({
      request: new Request("https://x/unsubscribe?token=bad-token"),
      context: ctx(),
      params: {},
    } as any);

    // data() from React Router v7 returns DataWithResponseInit { type, data, init }.
    const json = (result as any).data as { ok: boolean };
    expect(json.ok).toBe(false);

    const { data: unchanged } = await svc
      .from("customers")
      .select("do_not_email")
      .eq("id", customerId)
      .single();
    expect(unchanged!.do_not_email).toBe(false);
  });
});
