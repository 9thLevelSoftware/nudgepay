import { describe, it, expect } from "vitest";
import {
  resolveTemplates,
  slugify,
  parseTemplateUpsert,
  parseTemplateDelete,
  type MessageTemplateRow,
} from "../app/lib/message-templates";
import { DEFAULT_SMS_TEMPLATES } from "../app/lib/sms-templates";
import { DEFAULT_EMAIL_TEMPLATES } from "../app/lib/email-templates";

describe("resolveTemplates", () => {
  it("falls back to defaults when there are no rows", () => {
    const result = resolveTemplates([]);
    expect(result.sms).toHaveLength(DEFAULT_SMS_TEMPLATES.length);
    expect(result.email).toHaveLength(DEFAULT_EMAIL_TEMPLATES.length);
    expect(result.sms.map((t) => t.slug)).toEqual(DEFAULT_SMS_TEMPLATES.map((t) => t.id));
    expect(result.email.map((t) => t.slug)).toEqual(DEFAULT_EMAIL_TEMPLATES.map((t) => t.id));
  });

  it("falls back per-channel independently", () => {
    const rows: MessageTemplateRow[] = [
      { id: "1", channel: "sms", slug: "custom", label: "Custom", subject: null, body: "Hi {customer}", sort: 0 },
    ];
    const result = resolveTemplates(rows);
    // SMS: DB row + missing defaults merged in
    expect(result.sms[0].slug).toBe("custom");
    expect(result.sms.length).toBeGreaterThan(1);
    // Email: no DB rows → pure defaults
    expect(result.email).toHaveLength(DEFAULT_EMAIL_TEMPLATES.length);
  });

  it("merges missing defaults when DB rows exist (edit-one-keep-rest)", () => {
    // Editing "friendly-reminder" slug should not drop the other 3 default templates
    const rows: MessageTemplateRow[] = [
      { id: "1", channel: "sms", slug: "friendly-reminder", label: "My Reminder", subject: null, body: "Custom body", sort: 0 },
    ];
    const result = resolveTemplates(rows);
    const slugs = result.sms.map((t) => t.slug);
    expect(slugs).toContain("friendly-reminder");
    expect(slugs).toContain("past-due");
    expect(slugs).toContain("final-notice");
    expect(slugs).toContain("payment-received");
    // The DB version wins for "friendly-reminder"
    expect(result.sms.find(t => t.slug === "friendly-reminder")!.body).toBe("Custom body");
  });

  it("uses DB rows when present, sorted by sort", () => {
    // Use all 4 default slugs so no defaults are appended
    const rows: MessageTemplateRow[] = [
      { id: "2", channel: "sms", slug: "past-due", label: "Second", subject: null, body: "b", sort: 1 },
      { id: "1", channel: "sms", slug: "friendly-reminder", label: "First", subject: null, body: "a", sort: 0 },
      { id: "3", channel: "sms", slug: "final-notice", label: "Third", subject: null, body: "c", sort: 2 },
      { id: "4", channel: "sms", slug: "payment-received", label: "Fourth", subject: null, body: "d", sort: 3 },
    ];
    const result = resolveTemplates(rows);
    expect(result.sms.map((t) => t.slug)).toEqual(["friendly-reminder", "past-due", "final-notice", "payment-received"]);
  });

  it("sorts email rows by sort", () => {
    const rows: MessageTemplateRow[] = [
      { id: "2", channel: "email", slug: "past-due", label: "Second", subject: "S2", body: "b", sort: 3 },
      { id: "1", channel: "email", slug: "friendly-reminder", label: "First", subject: "S1", body: "a", sort: 1 },
      { id: "3", channel: "email", slug: "final-notice", label: "Third", subject: "S3", body: "c", sort: 5 },
      { id: "4", channel: "email", slug: "payment-received", label: "Fourth", subject: "S4", body: "d", sort: 7 },
    ];
    const result = resolveTemplates(rows);
    expect(result.email.map((t) => t.slug)).toEqual(["friendly-reminder", "past-due", "final-notice", "payment-received"]);
  });
});

describe("slugify", () => {
  it("lowercases and replaces spaces with hyphens", () => {
    expect(slugify("Friendly Reminder")).toBe("friendly-reminder");
  });

  it("strips special characters", () => {
    expect(slugify("Past Due!! (Final)")).toBe("past-due-final");
  });

  it("trims leading and trailing hyphens", () => {
    expect(slugify("  -- Hello --  ")).toBe("hello");
  });

  it("truncates to 60 characters", () => {
    const long = "a".repeat(100);
    const out = slugify(long);
    expect(out.length).toBe(60);
  });

  it("handles empty string", () => {
    expect(slugify("")).toBe("");
  });
});

function formData(fields: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
}

describe("parseTemplateUpsert", () => {
  it("accepts a valid sms upsert", () => {
    const result = parseTemplateUpsert(formData({
      channel: "sms", label: "Friendly reminder", body: "Hi {customer}",
    }));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.channel).toBe("sms");
      expect(result.value.slug).toBe("friendly-reminder");
      expect(result.value.subject).toBeNull();
    }
  });

  it("accepts an explicit slug", () => {
    const result = parseTemplateUpsert(formData({
      channel: "sms", label: "Friendly reminder", slug: "custom-slug", body: "Hi",
    }));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.slug).toBe("custom-slug");
  });

  it("accepts a valid email upsert with subject", () => {
    const result = parseTemplateUpsert(formData({
      channel: "email", label: "Past due", body: "Hi {customer}", subject: "Past due notice",
    }));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.subject).toBe("Past due notice");
  });

  it("rejects an invalid channel", () => {
    const result = parseTemplateUpsert(formData({ channel: "fax", label: "X", body: "Y" }));
    expect(result).toEqual({ ok: false, error: "channel" });
  });

  it("rejects an empty label", () => {
    const result = parseTemplateUpsert(formData({ channel: "sms", label: "", body: "Y" }));
    expect(result).toEqual({ ok: false, error: "label" });
  });

  it("rejects a label over 80 characters", () => {
    const result = parseTemplateUpsert(formData({ channel: "sms", label: "a".repeat(81), body: "Y" }));
    expect(result).toEqual({ ok: false, error: "label" });
  });

  it("rejects an invalid explicit slug", () => {
    const result = parseTemplateUpsert(formData({ channel: "sms", label: "X", slug: "Invalid Slug!", body: "Y" }));
    expect(result).toEqual({ ok: false, error: "slug" });
  });

  it("rejects an empty body", () => {
    const result = parseTemplateUpsert(formData({ channel: "sms", label: "X", body: "" }));
    expect(result).toEqual({ ok: false, error: "body" });
  });

  it("rejects a body over 2000 characters", () => {
    const result = parseTemplateUpsert(formData({ channel: "sms", label: "X", body: "a".repeat(2001) }));
    expect(result).toEqual({ ok: false, error: "body" });
  });

  it("defaults sort to 0 when absent", () => {
    const result = parseTemplateUpsert(formData({ channel: "sms", label: "X", body: "Y" }));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.sort).toBe(0);
  });

  it("parses an explicit sort value", () => {
    const result = parseTemplateUpsert(formData({ channel: "sms", label: "X", body: "Y", sort: "5" }));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.sort).toBe(5);
  });
});

describe("parseTemplateDelete", () => {
  it("accepts a valid delete request", () => {
    const result = parseTemplateDelete(formData({ channel: "email", slug: "past-due" }));
    expect(result).toEqual({ ok: true, value: { channel: "email", slug: "past-due" } });
  });

  it("rejects an invalid channel", () => {
    const result = parseTemplateDelete(formData({ channel: "fax", slug: "past-due" }));
    expect(result).toEqual({ ok: false, error: "channel" });
  });

  it("rejects an empty slug", () => {
    const result = parseTemplateDelete(formData({ channel: "sms", slug: "" }));
    expect(result).toEqual({ ok: false, error: "slug" });
  });
});
