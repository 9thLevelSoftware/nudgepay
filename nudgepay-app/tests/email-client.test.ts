import { describe, it, expect, vi } from "vitest";
import { sendEmail } from "../app/lib/email-client.server";

function mockFetch(status: number, body: unknown) {
  return vi.fn(async () => new Response(JSON.stringify(body), { status }));
}

describe("sendEmail", () => {
  it("POSTs to Resend with bearer auth and returns the id", async () => {
    const f = mockFetch(200, { id: "re_123" });
    const res = await sendEmail(f as any, { apiKey: "key" },
      { from: "A <a@x.com>", to: "b@y.com", subject: "Hi", text: "body" });
    expect(res).toEqual({ id: "re_123" });
    const [url, init] = f.mock.calls[0];
    expect(url).toBe("https://api.resend.com/emails");
    expect((init as any).method).toBe("POST");
    expect((init as any).headers.Authorization).toBe("Bearer key");
    expect(JSON.parse((init as any).body)).toEqual({ from: "A <a@x.com>", to: "b@y.com", subject: "Hi", text: "body" });
  });
  it("throws on non-2xx including the provider body", async () => {
    const f = mockFetch(422, { message: "domain not verified" });
    await expect(sendEmail(f as any, { apiKey: "k" },
      { from: "a@x.com", to: "b@y.com", subject: "s", text: "t" })).rejects.toThrow(/domain not verified/);
  });
});
