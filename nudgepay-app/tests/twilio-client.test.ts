import { expect, test, vi } from "vitest";
import { sendSms } from "../app/lib/twilio-client.server";

const cfg = { accountSid: "AC123", authToken: "tok" };

function jsonResponse(body: unknown, status = 201) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

test("sendSms posts To/Body/From with Basic auth and parses sid+status", async () => {
  const fetchFn = vi.fn(async () => jsonResponse({ sid: "SM1", status: "queued" }));
  const res = await sendSms(fetchFn as any, cfg, {
    to: "+12295550101", body: "Hi", sender: { from: "+15005550006" },
  });
  expect(res).toEqual({ sid: "SM1", status: "queued" });
  const [url, init] = fetchFn.mock.calls[0];
  expect(String(url)).toBe("https://api.twilio.com/2010-04-01/Accounts/AC123/Messages.json");
  expect((init as RequestInit).method).toBe("POST");
  const body = String((init as any).body);
  expect(body).toContain("To=%2B12295550101");
  expect(body).toContain("Body=Hi");
  expect(body).toContain("From=%2B15005550006");
  expect(body).not.toContain("MessagingServiceSid");
  expect((init as any).headers.Authorization).toBe("Basic " + btoa("AC123:tok"));
});

test("sendSms uses MessagingServiceSid when the sender is a messaging service", async () => {
  const fetchFn = vi.fn(async () => jsonResponse({ sid: "SM2", status: "accepted" }));
  await sendSms(fetchFn as any, cfg, {
    to: "+12295550101", body: "Yo", sender: { messagingServiceSid: "MG999" },
    statusCallback: "https://x/webhooks/twilio/status",
  });
  const body = String((fetchFn.mock.calls[0][1] as any).body);
  expect(body).toContain("MessagingServiceSid=MG999");
  expect(body).not.toContain("From=");
  expect(body).toContain("StatusCallback=https%3A%2F%2Fx%2Fwebhooks%2Ftwilio%2Fstatus");
});

test("sendSms throws on a non-2xx response", async () => {
  const fetchFn = vi.fn(async () => jsonResponse({ message: "bad" }, 400));
  await expect(sendSms(fetchFn as any, cfg, {
    to: "+1", body: "x", sender: { from: "+2" },
  })).rejects.toThrow();
});
