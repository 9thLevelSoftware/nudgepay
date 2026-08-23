import { describe, it, expect, vi } from "vitest";
import { sendEmail, fetchReceivingEmail } from "../app/lib/email-client.server";

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
  it("omits reply_to unless a received mailbox is passed", async () => {
    const f = mockFetch(200, { id: "re_1" });
    await sendEmail(f as any, { apiKey: "key" },
      { from: "a@x.com", to: "b@y.com", subject: "Hi", text: "body" });
    expect(JSON.parse((f.mock.calls[0][1] as any).body)).not.toHaveProperty("reply_to");
  });
  it("includes reply_to when replyTo is set", async () => {
    const f = mockFetch(200, { id: "re_2" });
    await sendEmail(f as any, { apiKey: "key" },
      { from: "a@x.com", to: "b@y.com", subject: "Hi", text: "body", replyTo: "inbox@x.com" });
    expect(JSON.parse((f.mock.calls[0][1] as any).body).reply_to).toBe("inbox@x.com");
  });
});

describe("fetchReceivingEmail", () => {
  it("GETs /emails/receiving/{id} with bearer auth and maps text/html", async () => {
    const timeout = vi.spyOn(AbortSignal, "timeout");
    try {
      const f = mockFetch(200, {
        text: "hello",
        html: "<p>hello</p>",
        from: "a@x.com",
        to: ["b@y.com"],
        subject: "Hi",
      });
      const res = await fetchReceivingEmail(f as any, { apiKey: "key" }, "abc-123");
      expect(res).toEqual({
        text: "hello",
        html: "<p>hello</p>",
        from: "a@x.com",
        to: "b@y.com",
        subject: "Hi",
      });
      const [url, init] = f.mock.calls[0];
      expect(url).toBe("https://api.resend.com/emails/receiving/abc-123");
      expect((init as any).method).toBe("GET");
      expect((init as any).headers.Authorization).toBe("Bearer key");
      expect((init as any).signal).toBeInstanceOf(AbortSignal);
      expect(timeout).toHaveBeenCalledWith(5000);
    } finally {
      timeout.mockRestore();
    }
  });

  it("maps html-only bodies when text is null", async () => {
    const f = mockFetch(200, {
      text: null,
      html: "<p>only</p>",
      from: "a@x.com",
      to: "b@y.com",
      subject: "Hi",
    });
    const res = await fetchReceivingEmail(f as any, { apiKey: "k" }, "html-only");
    expect(res).toEqual({
      text: "",
      html: "<p>only</p>",
      from: "a@x.com",
      to: "b@y.com",
      subject: "Hi",
    });
  });

  it("returns null on 404", async () => {
    const f = mockFetch(404, { message: "not found" });
    await expect(fetchReceivingEmail(f as any, { apiKey: "k" }, "missing")).resolves.toBeNull();
  });

  it("throws on non-2xx including the provider body", async () => {
    const f = mockFetch(500, { message: "upstream" });
    await expect(fetchReceivingEmail(f as any, { apiKey: "k" }, "id"))
      .rejects.toThrow(/upstream/);
  });

  it("propagates abort and uses a provided signal instead of the default timeout", async () => {
    const timeout = vi.spyOn(AbortSignal, "timeout");
    try {
      const err = new DOMException("The operation was aborted.", "AbortError");
      const f = vi.fn(async () => { throw err; });
      const signal = AbortSignal.abort();
      await expect(fetchReceivingEmail(f as any, { apiKey: "k" }, "id", signal)).rejects.toThrow();
      expect((f.mock.calls[0][1] as any).signal).toBe(signal);
      expect(timeout).not.toHaveBeenCalled();
    } finally {
      timeout.mockRestore();
    }
  });
});
