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
    expect(result.sms).toHaveLength(1);
    expect(result.sms[0].slug).toBe("custom");
    expect(result.email).toHaveLength(DEFAULT_EMAIL_TEMPLATES.length);
  });

  it("uses DB rows when present, sorted by sort", () => {
    const rows: MessageTemplateRow[] = [
      { id: "2", channel: "sms", slug: "second", label: "Second", subject: null, body: "b", sort: 1 },
      { id: "1", channel: "sms", slug: "first", label: "First", subject: null, body: "a", sort: 0 },
    ];
    const result = resolveTemplates(rows);
    expect(result.sms.map((t) => t.slug)).toEqual(["first", "second"]);
  });

  it("sorts email rows by sort", () => {
    const rows: MessageTemplateRow[] = [
      { id: "2", channel: "email", slug: "second", label: "Second", subject: "S2", body: "b", sort: 3 },
      { id: "1", channel: "email", slug: "first", label: "First", subject: "S1", body: "a", sort: 1 },
    ];
    const result = resolveTemplates(rows);
    expect(result.email.map((t) => t.slug)).toEqual(["first", "second"]);
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
