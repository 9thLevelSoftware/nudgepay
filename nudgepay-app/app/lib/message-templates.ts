// Pure module: org message template resolution + parse helpers.
// No I/O, no .server suffix.

import { DEFAULT_SMS_TEMPLATES } from "./sms-templates";
import { DEFAULT_EMAIL_TEMPLATES } from "./email-templates";

export type MessageTemplateRow = {
  id: string;
  channel: string;
  slug: string;
  label: string;
  subject: string | null;
  body: string;
  sort: number;
};

export type OrgTemplates = {
  sms: MessageTemplateRow[];
  email: MessageTemplateRow[];
};

// Resolve templates: if the org has DB rows for a channel, use them;
// otherwise fall back to defaults (covers orgs created between migration and deploy).
export function resolveTemplates(
  rows: MessageTemplateRow[],
): OrgTemplates {
  const sms = rows.filter(r => r.channel === "sms").sort((a, b) => a.sort - b.sort);
  const email = rows.filter(r => r.channel === "email").sort((a, b) => a.sort - b.sort);
  return {
    sms: sms.length > 0 ? sms : DEFAULT_SMS_TEMPLATES.map((t, i) => ({
      id: t.id, channel: "sms" as const, slug: t.id, label: t.label,
      subject: null, body: t.body, sort: i,
    })),
    email: email.length > 0 ? email : DEFAULT_EMAIL_TEMPLATES.map((t, i) => ({
      id: t.id, channel: "email" as const, slug: t.id, label: t.label,
      subject: t.subject, body: t.body, sort: i,
    })),
  };
}

// Slugify a label for use as a template slug
export function slugify(label: string): string {
  return label.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60);
}

// Parse an upsert request from form data
export type TemplateUpsertResult =
  | { ok: true; value: { channel: string; slug: string; label: string; subject: string | null; body: string; sort: number } }
  | { ok: false; error: string };

export function parseTemplateUpsert(form: FormData): TemplateUpsertResult {
  const channel = (form.get("channel") as string ?? "").trim();
  if (channel !== "sms" && channel !== "email") return { ok: false, error: "channel" };

  const label = (form.get("label") as string ?? "").trim();
  if (label.length < 1 || label.length > 80) return { ok: false, error: "label" };

  const slug = (form.get("slug") as string ?? "").trim() || slugify(label);
  if (!/^[a-z0-9-]{1,60}$/.test(slug)) return { ok: false, error: "slug" };

  const body = (form.get("body") as string ?? "").trim();
  if (body.length < 1 || body.length > 2000) return { ok: false, error: "body" };

  const subject = channel === "email" ? (form.get("subject") as string ?? "").trim() || null : null;

  const sortRaw = form.get("sort");
  const sort = sortRaw != null ? Number(sortRaw) : 0;

  return { ok: true, value: { channel, slug, label, subject, body, sort } };
}

export type TemplateDeleteResult =
  | { ok: true; value: { channel: string; slug: string } }
  | { ok: false; error: string };

export function parseTemplateDelete(form: FormData): TemplateDeleteResult {
  const channel = (form.get("channel") as string ?? "").trim();
  if (channel !== "sms" && channel !== "email") return { ok: false, error: "channel" };
  const slug = (form.get("slug") as string ?? "").trim();
  if (!slug) return { ok: false, error: "slug" };
  return { ok: true, value: { channel, slug } };
}
