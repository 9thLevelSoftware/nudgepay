import { describe, it, expect, vi } from "vitest";
import { trySendInviteEmail } from "../app/lib/invite-email.server";

function mockFetch(status: number, body: unknown) {
  return vi.fn(async () => new Response(JSON.stringify(body), { status }));
}

function emailConfigService(row: { from_address?: string; from_name?: string } | null) {
  return {
    from: vi.fn((table: string) => {
      expect(table).toBe("email_config");
      return {
        select: vi.fn((cols: string) => {
          expect(cols).not.toMatch(/email_enabled/);
          return {
            eq: vi.fn().mockReturnValue({
              maybeSingle: vi.fn(async () => ({ data: row, error: null })),
            }),
          };
        }),
      };
    }),
  } as any;
}

const args = {
  orgId: "org-1",
  orgName: "Acme HVAC",
  to: "teammate@example.com",
  acceptUrl: "https://app.nudgepay.test/accept/tok",
};

describe("trySendInviteEmail", () => {
  it("skips when Resend env is absent", async () => {
    const fetchFn = mockFetch(200, { id: "re_1" });
    const result = await trySendInviteEmail(
      { fetchFn: fetchFn as any, service: emailConfigService({ from_address: "ops@x.com" }), email: null },
      args,
    );
    expect(result).toBe("skipped");
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("skips when from_address is missing even if a send key exists", async () => {
    const fetchFn = mockFetch(200, { id: "re_1" });
    const result = await trySendInviteEmail(
      { fetchFn: fetchFn as any, service: emailConfigService({ from_address: "", from_name: "Ops" }), email: { apiKey: "key", allowedFrom: "ops@x.com" } },
      args,
    );
    expect(result).toBe("skipped");
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("sends using from_address even when customer email_enabled is not selected", async () => {
    const fetchFn = mockFetch(200, { id: "re_inv" });
    const result = await trySendInviteEmail(
      {
        fetchFn: fetchFn as any,
        service: emailConfigService({ from_address: "ops@x.com", from_name: "Acme" }),
        email: { apiKey: "key", allowedFrom: "ops@x.com" },
      },
      args,
    );
    expect(result).toBe("sent");
    const payload = JSON.parse((fetchFn.mock.calls[0][1] as any).body);
    expect(payload.from).toBe("Acme <ops@x.com>");
    expect(payload.to).toBe("teammate@example.com");
    expect(payload.subject).toContain("Acme HVAC");
    expect(payload.text).toContain(args.acceptUrl);
    expect(payload).not.toHaveProperty("reply_to");
  });

  it("returns failed and does not throw when Resend errors", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const fetchFn = mockFetch(422, { message: "teammate@example.com token=provider-secret" });
    const result = await trySendInviteEmail(
      {
        fetchFn: fetchFn as any,
        service: emailConfigService({ from_address: "ops@x.com" }),
        email: { apiKey: "key", allowedFrom: "ops@x.com" },
      },
      args,
    );
    expect(result).toBe("failed");
    expect(error).toHaveBeenCalledWith(expect.objectContaining({
      event: "invite_email_failed",
      orgId: "org-1",
      errorName: "ProviderSendRejectedError",
      status: 422,
    }));
    expect(JSON.stringify(error.mock.calls[0][0])).not.toMatch(/teammate@example\.com|provider-secret|accept\/tok/);
    error.mockRestore();
  });

  it("returns failed when email_config lookup throws", async () => {
    const fetchFn = mockFetch(200, { id: "re_1" });
    const service = { from: vi.fn(() => { throw new Error("db down"); }) } as any;
    const result = await trySendInviteEmail(
      { fetchFn: fetchFn as any, service, email: { apiKey: "key", allowedFrom: "ops@x.com" } },
      args,
    );
    expect(result).toBe("failed");
    expect(fetchFn).not.toHaveBeenCalled();
  });
});
