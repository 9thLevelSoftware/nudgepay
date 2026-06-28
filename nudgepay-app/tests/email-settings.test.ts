import { describe, it, expect } from "vitest";
import { resolveEmailSettings, parseEmailSettingsUpdate } from "../app/lib/email-settings";

function fd(entries: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(entries)) f.set(k, v);
  return f;
}

describe("email settings", () => {
  it("defaults: absent row => disabled, empty strings", () => {
    expect(resolveEmailSettings(null)).toEqual({ emailEnabled: false, fromAddress: "", fromName: "" });
  });
  it("resolves a row", () => {
    expect(resolveEmailSettings({ email_enabled: true, from_address: "a@x.com", from_name: "A" }))
      .toEqual({ emailEnabled: true, fromAddress: "a@x.com", fromName: "A" });
  });
  it("accepts a valid from address", () => {
    const r = parseEmailSettingsUpdate(fd({ email_enabled: "true", from_address: "billing@x.com", from_name: "Chancey" }));
    expect(r).toEqual({ ok: true, value: { email_enabled: true, from_address: "billing@x.com", from_name: "Chancey" } });
  });
  it("rejects a malformed from address", () => {
    const r = parseEmailSettingsUpdate(fd({ email_enabled: "true", from_address: "not-an-email", from_name: "" }));
    expect(r.ok).toBe(false);
  });
  it("allows empty from address when disabled", () => {
    const r = parseEmailSettingsUpdate(fd({ email_enabled: "false", from_address: "", from_name: "" }));
    expect(r.ok).toBe(true);
  });
});
