import { describe, it, expect } from "vitest";
import { resolveEmailSettings, parseEmailSettingsUpdate, emailConfigUpsertRow, assertFromAddressAllowed } from "../app/lib/email-settings";

function fd(entries: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(entries)) f.set(k, v);
  return f;
}

describe("email settings", () => {
  it("defaults: absent row => disabled, empty strings", () => {
    expect(resolveEmailSettings(null)).toEqual({ emailEnabled: false, fromAddress: "", fromName: "", postalAddress: "" });
  });
  it("resolves a row", () => {
    expect(resolveEmailSettings({ email_enabled: true, from_address: "a@x.com", from_name: "A", postal_address: "1 Main St" }))
      .toEqual({ emailEnabled: true, fromAddress: "a@x.com", fromName: "A", postalAddress: "1 Main St" });
  });
  it("accepts a valid from address", () => {
    const r = parseEmailSettingsUpdate(
      fd({ email_enabled: "true", from_address: "billing@x.com", from_name: "Chancey", postal_address: "1 Main St" }),
      ["billing@x.com"],
    );
    expect(r).toEqual({ ok: true, value: { email_enabled: true, from_address: "billing@x.com", from_name: "Chancey", postal_address: "1 Main St" } });
  });
  it("requires postal when email is enabled (NP-AUD-2026-033-POSTAL)", () => {
    const r = parseEmailSettingsUpdate(fd({ email_enabled: "true", from_address: "billing@x.com", from_name: "" }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe("postal");
  });
  it("trims postal when enabled", () => {
    const r = parseEmailSettingsUpdate(
      fd({ email_enabled: "true", from_address: "billing@x.com", from_name: "", postal_address: "  1 Main St  " }),
      ["billing@x.com"],
    );
    expect(r.ok && r.value.postal_address).toBe("1 Main St");
  });
  it("rejects a malformed from address", () => {
    const r = parseEmailSettingsUpdate(fd({ email_enabled: "true", from_address: "not-an-email", from_name: "", postal_address: "1 Main" }));
    expect(r.ok).toBe(false);
  });
  it("allows empty from address when disabled", () => {
    const r = parseEmailSettingsUpdate(fd({ email_enabled: "false", from_address: "", from_name: "" }));
    expect(r.ok).toBe(true);
  });
  it("rejects a From outside the operator allowlist", () => {
    const r = parseEmailSettingsUpdate(
      fd({ email_enabled: "true", from_address: "other@x.com", postal_address: "1 Main" }),
      ["billing@x.com"],
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe("from_allowlist");
  });
  it("assertFromAddressAllowed throws when the allowlist is empty or the address is missing", () => {
    expect(() => assertFromAddressAllowed("billing@x.com", undefined)).toThrow(/allowlist/i);
    expect(() => assertFromAddressAllowed("other@x.com", "billing@x.com")).toThrow(/allowlist/i);
    expect(() => assertFromAddressAllowed("billing@x.com", "billing@x.com")).not.toThrow();
  });
  it("org-scoped allowlist entries are not interchangeable across workspaces", () => {
    const orgA = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
    const orgB = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
    const raw = `${orgA}:billing@a.test,${orgB}:billing@b.test`;
    expect(() => assertFromAddressAllowed("billing@a.test", raw, orgA)).not.toThrow();
    expect(() => assertFromAddressAllowed("billing@a.test", raw, orgB)).toThrow(/allowlist/i);
    expect(() => assertFromAddressAllowed("billing@b.test", raw, orgA)).toThrow(/allowlist/i);
    const mixed = `${orgA}:billing@a.test,billing@a.test`;
    expect(() => assertFromAddressAllowed("billing@a.test", mixed, orgB)).toThrow(/allowlist/i);
    const r = parseEmailSettingsUpdate(
      fd({ email_enabled: "true", from_address: "billing@a.test", postal_address: "1 Main" }),
      raw,
      orgB,
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe("from_allowlist");
  });
  it("rejects enable when the From allowlist is empty", () => {
    const r = parseEmailSettingsUpdate(
      fd({ email_enabled: "true", from_address: "billing@x.com", postal_address: "1 Main" }),
      [],
    );
    expect(r).toEqual({ ok: false, error: "from_allowlist" });
  });
  it("emailConfigUpsertRow always stamps updated_at", () => {
    const parsed = parseEmailSettingsUpdate(fd({
      email_enabled: "true", from_address: "billing@x.com", from_name: "A", postal_address: "1 Main",
    }), ["billing@x.com"]);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const row = emailConfigUpsertRow("org-1", parsed.value, "2026-08-21T00:00:00.000Z");
    expect(row.updated_at).toBe("2026-08-21T00:00:00.000Z");
    expect(row.org_id).toBe("org-1");
    expect(row.from_address).toBe("billing@x.com");
  });
});
