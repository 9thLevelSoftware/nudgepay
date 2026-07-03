import { describe, it, expect } from "vitest";
import {
  resolveCompanyProfile,
  parseCompanyProfileUpdate,
  DEFAULT_COMPANY_PROFILE,
} from "../app/lib/org-profile";

describe("resolveCompanyProfile", () => {
  it("returns defaults for null row", () => {
    expect(resolveCompanyProfile(null)).toEqual(DEFAULT_COMPANY_PROFILE);
  });

  it("returns defaults for row with all nulls", () => {
    const row = { company_website: null, company_phone: null, payment_portal_url: null, timezone: null };
    const result = resolveCompanyProfile(row);
    expect(result.timezone).toBe("America/New_York");
    expect(result.website).toBeNull();
  });

  it("passes through populated values", () => {
    const row = {
      company_website: "https://example.com",
      company_phone: "(555) 123-4567",
      payment_portal_url: "https://pay.example.com",
      timezone: "America/Chicago",
    };
    expect(resolveCompanyProfile(row)).toEqual({
      website: "https://example.com",
      phone: "(555) 123-4567",
      paymentPortalUrl: "https://pay.example.com",
      timezone: "America/Chicago",
    });
  });
});

describe("parseCompanyProfileUpdate", () => {
  function form(entries: Record<string, string>) {
    const f = new FormData();
    for (const [k, v] of Object.entries(entries)) f.set(k, v);
    return f;
  }

  const validBase = {
    name: "Acme Corp",
    company_website: "",
    company_phone: "",
    payment_portal_url: "",
    timezone: "America/New_York",
  };

  it("accepts minimal valid input", () => {
    const result = parseCompanyProfileUpdate(form(validBase));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.name).toBe("Acme Corp");
      expect(result.patch.company_website).toBeNull();
      expect(result.patch.company_phone).toBeNull();
      expect(result.patch.payment_portal_url).toBeNull();
      expect(result.patch.timezone).toBe("America/New_York");
    }
  });

  it("accepts full valid input", () => {
    const result = parseCompanyProfileUpdate(form({
      ...validBase,
      company_website: "https://acme.com",
      company_phone: "(555) 123-4567",
      payment_portal_url: "https://pay.acme.com/invoices",
      timezone: "America/Chicago",
    }));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.name).toBe("Acme Corp");
      expect(result.patch.company_website).toBe("https://acme.com/");
      expect(result.patch.company_phone).toBe("(555) 123-4567");
      expect(result.patch.payment_portal_url).toBe("https://pay.acme.com/invoices");
      expect(result.patch.timezone).toBe("America/Chicago");
    }
  });

  it("rejects empty name", () => {
    const result = parseCompanyProfileUpdate(form({ ...validBase, name: "" }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("name");
  });

  it("rejects name over 120 chars", () => {
    const result = parseCompanyProfileUpdate(form({ ...validBase, name: "x".repeat(121) }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("name");
  });

  it("rejects non-http(s) website URL", () => {
    const result = parseCompanyProfileUpdate(form({ ...validBase, company_website: "ftp://files.example.com" }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("website");
  });

  it("rejects invalid website URL", () => {
    const result = parseCompanyProfileUpdate(form({ ...validBase, company_website: "not a url" }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("website");
  });

  it("rejects invalid payment portal URL", () => {
    const result = parseCompanyProfileUpdate(form({ ...validBase, payment_portal_url: "notaurl" }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("portal");
  });

  it("rejects invalid timezone", () => {
    const result = parseCompanyProfileUpdate(form({ ...validBase, timezone: "Not/A_Zone" }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("timezone");
  });

  it("rejects empty timezone", () => {
    const result = parseCompanyProfileUpdate(form({ ...validBase, timezone: "" }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("timezone");
  });

  it("trims whitespace from phone", () => {
    const result = parseCompanyProfileUpdate(form({ ...validBase, company_phone: "  (555) 123-4567  " }));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.patch.company_phone).toBe("(555) 123-4567");
  });

  it("treats whitespace-only phone as null", () => {
    const result = parseCompanyProfileUpdate(form({ ...validBase, company_phone: "   " }));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.patch.company_phone).toBeNull();
  });

  it("defaults digest_hour_local to 8 when omitted", () => {
    const result = parseCompanyProfileUpdate(form(validBase));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.patch.digest_hour_local).toBe(8);
  });

  it("accepts a valid digest_hour_local", () => {
    const result = parseCompanyProfileUpdate(form({ ...validBase, digest_hour_local: "14" }));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.patch.digest_hour_local).toBe(14);
  });

  it("rejects digest_hour_local out of range", () => {
    const result = parseCompanyProfileUpdate(form({ ...validBase, digest_hour_local: "24" }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("digest_hour");
  });

  it("rejects negative digest_hour_local", () => {
    const result = parseCompanyProfileUpdate(form({ ...validBase, digest_hour_local: "-1" }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("digest_hour");
  });

  it("rejects non-integer digest_hour_local", () => {
    const result = parseCompanyProfileUpdate(form({ ...validBase, digest_hour_local: "8.5" }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("digest_hour");
  });
});
