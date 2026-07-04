import { test, expect, vi } from "vitest";
import { sendTestSms, sendTestEmail } from "../app/lib/test-message.server";

// ---------------------------------------------------------------------------
// Mock helpers
// ---------------------------------------------------------------------------

function mockFetch(json: any, ok = true): typeof fetch {
  return vi.fn().mockResolvedValue({
    ok,
    status: ok ? 200 : 400,
    json: async () => json,
    text: async () => JSON.stringify(json),
  });
}

function mockService(overrides: Record<string, any> = {}) {
  const builder = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue({ data: overrides.messagingConfig ?? null, error: null }),
  };
  return {
    from: vi.fn((table: string) => {
      if (table === "messaging_config") {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              maybeSingle: vi.fn().mockResolvedValue({ data: overrides.messagingConfig ?? null, error: null }),
            }),
          }),
        };
      }
      if (table === "email_config") {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              maybeSingle: vi.fn().mockResolvedValue({ data: overrides.emailConfig ?? null, error: null }),
            }),
          }),
        };
      }
      return builder;
    }),
  } as any;
}

// ---------------------------------------------------------------------------
// sendTestSms
// ---------------------------------------------------------------------------

test("sendTestSms: ignores org sender override and uses env default", async () => {
  const fetchFn = mockFetch({ sid: "SM123", status: "queued" });
  const service = mockService({
    messagingConfig: { messaging_service_sid: "MG" + "a".repeat(32), sender: "+15559990000" },
  });
  const result = await sendTestSms(
    {
      fetchFn,
      service,
      twilio: { accountSid: "AC123", authToken: "tok" },
      defaultSender: { from: "+15550001111" },
    },
    { orgId: "org1", to: "+15551234567" },
  );
  expect(result).toEqual({ sid: "SM123", status: "queued" });
  const body = (fetchFn as any).mock.calls[0][1].body as string;
  expect(body).toContain("From=%2B15550001111");
  expect(body).not.toContain("MessagingServiceSid=");
});

test("sendTestSms: falls back to env default when no org override", async () => {
  const fetchFn = mockFetch({ sid: "SM456", status: "queued" });
  const service = mockService({ messagingConfig: null });
  await sendTestSms(
    {
      fetchFn,
      service,
      twilio: { accountSid: "AC123", authToken: "tok" },
      defaultSender: { from: "+15550001111" },
    },
    { orgId: "org1", to: "+15551234567" },
  );
  const body = (fetchFn as any).mock.calls[0][1].body as string;
  expect(body).toContain("From=%2B15550001111");
});

test("sendTestSms: passes null statusCallback (no ledger pollution)", async () => {
  const fetchFn = mockFetch({ sid: "SM789", status: "queued" });
  const service = mockService({ messagingConfig: null });
  await sendTestSms(
    {
      fetchFn,
      service,
      twilio: { accountSid: "AC123", authToken: "tok" },
      defaultSender: { from: "+15550001111" },
    },
    { orgId: "org1", to: "+15551234567" },
  );
  const body = (fetchFn as any).mock.calls[0][1].body as string;
  expect(body).not.toContain("StatusCallback");
});

// ---------------------------------------------------------------------------
// sendTestEmail
// ---------------------------------------------------------------------------

test("sendTestEmail: returns nofrom when email_config has no from_address", async () => {
  const fetchFn = mockFetch({ id: "msg_1" });
  const service = mockService({ emailConfig: { from_address: "", from_name: "" } });
  const result = await sendTestEmail(
    { fetchFn, service, email: { apiKey: "re_test" } },
    { orgId: "org1", to: "owner@example.com" },
  );
  expect(result).toEqual({ ok: false, error: "nofrom" });
  expect(fetchFn).not.toHaveBeenCalled(); // no send attempt
});

test("sendTestEmail: returns nofrom when email_config row is absent", async () => {
  const fetchFn = mockFetch({ id: "msg_1" });
  const service = mockService({ emailConfig: null });
  const result = await sendTestEmail(
    { fetchFn, service, email: { apiKey: "re_test" } },
    { orgId: "org1", to: "owner@example.com" },
  );
  expect(result).toEqual({ ok: false, error: "nofrom" });
});

test("sendTestEmail: sends with org from_address and from_name", async () => {
  const fetchFn = mockFetch({ id: "msg_2" });
  const service = mockService({
    emailConfig: { from_address: "ar@example.com", from_name: "AR Team" },
  });
  const result = await sendTestEmail(
    { fetchFn, service, email: { apiKey: "re_test" } },
    { orgId: "org1", to: "owner@example.com" },
  );
  expect(result).toEqual({ ok: true, id: "msg_2" });
  const payload = JSON.parse((fetchFn as any).mock.calls[0][1].body);
  expect(payload.from).toBe("AR Team <ar@example.com>");
  expect(payload.to).toBe("owner@example.com");
  expect(payload.subject).toContain("test email");
});

test("sendTestEmail: uses bare address when from_name is empty", async () => {
  const fetchFn = mockFetch({ id: "msg_3" });
  const service = mockService({
    emailConfig: { from_address: "noreply@example.com", from_name: "" },
  });
  const result = await sendTestEmail(
    { fetchFn, service, email: { apiKey: "re_test" } },
    { orgId: "org1", to: "owner@example.com" },
  );
  expect(result).toEqual({ ok: true, id: "msg_3" });
  const payload = JSON.parse((fetchFn as any).mock.calls[0][1].body);
  expect(payload.from).toBe("noreply@example.com");
});
