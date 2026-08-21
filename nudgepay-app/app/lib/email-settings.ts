// Pure module — no I/O, no .server. Per-org email config derivation + form
// parsing, mirroring channel-settings.ts. Absent row => disabled (email defaults
// OFF). Address is format-validated; domain verification is an operator concern.

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

export function parseAllowedFromList(raw: string | null | undefined): string[] {
  return (raw ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

export function fromAddressAllowed(fromAddress: string, allowlist: string[]): boolean {
  if (allowlist.length === 0) return true;
  return allowlist.includes(fromAddress.trim().toLowerCase());
}

export function parseEmailSettingsUpdate(
  form: FormData,
  allowlist: string[] = [],
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
    if (!fromAddressAllowed(from_address, allowlist)) return { ok: false, error: "from_allowlist" };
  }
  return { ok: true, value: { email_enabled, from_address, from_name, postal_address } };
}
