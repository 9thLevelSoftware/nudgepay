import { describe, it, expect } from "vitest";
import { mapResendEvent } from "../app/lib/email-events";

describe("mapResendEvent", () => {
  it("maps delivered", () => {
    expect(mapResendEvent({ type: "email.delivered", data: { email_id: "re_1" } }))
      .toMatchObject({ kind: "status", providerMessageId: "re_1", status: "delivered", optOut: false });
  });
  it("maps a permanent bounce to opt-out", () => {
    expect(mapResendEvent({ type: "email.bounced", data: { email_id: "re_2", bounce: { type: "Permanent" } } }))
      .toMatchObject({ kind: "status", status: "bounced", optOut: true });
  });
  it("maps a transient bounce without opt-out", () => {
    expect(mapResendEvent({ type: "email.delivery_delayed", data: { email_id: "re_3" } }))
      .toMatchObject({ kind: "status", status: "delayed", optOut: false });
  });
  it("maps a complaint to opt-out", () => {
    expect(mapResendEvent({ type: "email.complained", data: { email_id: "re_4" } }))
      .toMatchObject({ kind: "status", status: "complained", optOut: true });
  });
  it("maps inbound email.received (Resend receiving API)", () => {
    expect(mapResendEvent({ type: "email.received", data: {
      from: ["C <c@x.com>"], to: ["billing@us.com"], subject: "Re: invoice", text: "ok", email_id: "in_1" } }))
      .toMatchObject({ kind: "inbound", from: "C <c@x.com>", to: "billing@us.com", subject: "Re: invoice", body: "ok" });
  });
  it("maps email.failed and email.suppressed", () => {
    expect(mapResendEvent({ type: "email.failed", data: { email_id: "re_5" } }))
      .toMatchObject({ kind: "status", status: "failed", optOut: false });
    expect(mapResendEvent({ type: "email.suppressed", data: { email_id: "re_6" } }))
      .toMatchObject({ kind: "status", status: "failed", optOut: true });
  });
  it("ignores opened/clicked/unknown", () => {
    expect(mapResendEvent({ type: "email.opened", data: {} }).kind).toBe("ignore");
    expect(mapResendEvent({ type: "something.else", data: {} }).kind).toBe("ignore");
  });
});
