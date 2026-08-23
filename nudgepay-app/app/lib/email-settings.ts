// Pure module — no I/O, no .server. Per-org email config derivation + form
// parsing, mirroring channel-settings.ts. Absent row => disabled (email defaults
// OFF). Address is format-validated.
//
// RESEND_ALLOWED_FROM is a comma-separated list of verified From addresses.
// Entries may be `email` (any workspace) or `orgId:email` (that workspace only).
// An address bound to one org is not usable by another, even if also listed
// unscoped. An empty allowlist rejects enable so tenants cannot pick a
// free-text From on the shared Resend key.

export type EmailSettings = { emailEnabled: boolean; fromAddress: string; fromName: string; postalAddress: string };

export type EmailConfigRow = {
  email_enabled?: boolean | null;
  from_address?: string | null;
  from_name?: string | null;
  postal_address?: string | null;
};

export function resolveEmailSettings(row: EmailConfigRow | null | undefined): EmailSettings {
  return {
    emailEnabled: Boolean(row?.email_enabled),
    fromAddress: (row?.from_address ?? "").trim(),
    fromName: (row?.from_name ?? "").trim(),
    postalAddress: (row?.postal_address ?? "").trim(),
  };
}

// Conservative RFC-5322-lite check: non-empty local + "@" + dotted domain.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export type EmailSettingsUpdate =
  | { ok: true; value: { email_enabled: boolean; from_address: string; from_name: string; postal_address: string } }
  | { ok: false; error: string };

const ORG_SCOPED_FROM = /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}):(.+)$/i;

export type AllowedFromEntry = { email: string; orgId: string | null };

export function parseAllowedFromEntries(raw: string | null | undefined): AllowedFromEntry[] {
  const out: AllowedFromEntry[] = [];
  for (const token of (raw ?? "").split(",")) {
    const trimmed = token.trim();
    if (!trimmed) continue;
    const scoped = trimmed.match(ORG_SCOPED_FROM);
    if (scoped) {
      const email = scoped[2]!.trim().toLowerCase();
      if (email) out.push({ email, orgId: scoped[1]!.toLowerCase() });
      continue;
    }
    out.push({ email: trimmed.toLowerCase(), orgId: null });
  }
  return out;
}

function allowlistEntries(allowlist: string[] | string | null | undefined): AllowedFromEntry[] {
  if (Array.isArray(allowlist)) {
    return allowlist
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean)
      .map((email) => ({ email, orgId: null as string | null }));
  }
  return parseAllowedFromEntries(allowlist);
}

export function fromAddressAllowed(
  fromAddress: string,
  allowlist: string[] | string | null | undefined,
  orgId?: string | null,
): boolean {
  const from = fromAddress.trim().toLowerCase();
  const entries = allowlistEntries(allowlist);
  if (!from || entries.length === 0) return false;
  const org = orgId?.trim().toLowerCase() || null;
  if (org && entries.some((e) => e.email === from && e.orgId === org)) return true;
  if (entries.some((e) => e.email === from && e.orgId && e.orgId !== org)) return false;
  return entries.some((e) => e.email === from && e.orgId === null);
}

export function assertFromAddressAllowed(
  fromAddress: string,
  allowedFromRaw: string | null | undefined,
  orgId?: string | null,
): void {
  if (!fromAddressAllowed(fromAddress, allowedFromRaw, orgId)) {
    throw new Error("From address is not on the Resend allowlist");
  }
}

export function parseEmailSettingsUpdate(
  form: FormData,
  allowlist: string[] | string | null | undefined = [],
  orgId?: string | null,
): EmailSettingsUpdate {
  const email_enabled = form.get("email_enabled") === "true";
  const from_address = (typeof form.get("from_address") === "string" ? (form.get("from_address") as string) : "").trim();
  const from_name = (typeof form.get("from_name") === "string" ? (form.get("from_name") as string) : "").trim();
  const postal_address = (typeof form.get("postal_address") === "string" ? (form.get("postal_address") as string) : "").trim();
  if (from_address !== "" && !EMAIL_RE.test(from_address)) {
    return { ok: false, error: "address" };
  }
  if (email_enabled) {
    if (!from_address) return { ok: false, error: "address" };
    if (!postal_address) return { ok: false, error: "postal" };
    if (!fromAddressAllowed(from_address, allowlist, orgId)) return { ok: false, error: "from_allowlist" };
  }
  return { ok: true, value: { email_enabled, from_address, from_name, postal_address } };
}

/** Upsert row for email_config — always stamps updated_at (no DB trigger). */
export function emailConfigUpsertRow(
  orgId: string,
  value: { email_enabled: boolean; from_address: string; from_name: string; postal_address: string },
  nowIso: string,
): Record<string, unknown> {
  return { org_id: orgId, ...value, updated_at: nowIso };
}
