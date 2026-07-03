// Pure module: org company-profile parsing and resolution.
// No I/O, no .server suffix — safe in client bundle + tests.

import { ALL_TIMEZONE_VALUES } from "./timezones";

export type CompanyProfile = {
  website: string | null;
  phone: string | null;
  paymentPortalUrl: string | null;
  timezone: string;
};

export const DEFAULT_COMPANY_PROFILE: CompanyProfile = Object.freeze({
  website: null,
  phone: null,
  paymentPortalUrl: null,
  timezone: "America/New_York",
});

export function resolveCompanyProfile(
  row: { company_website?: string | null; company_phone?: string | null; payment_portal_url?: string | null; timezone?: string | null } | null,
): CompanyProfile {
  if (!row) return DEFAULT_COMPANY_PROFILE;
  return {
    website: row.company_website ?? null,
    phone: row.company_phone ?? null,
    paymentPortalUrl: row.payment_portal_url ?? null,
    timezone: row.timezone && row.timezone.length > 0 ? row.timezone : DEFAULT_COMPANY_PROFILE.timezone,
  };
}

// ── Form parsing ────────────────────────────────────────────────────

type ParseResult =
  | { ok: true; name: string; patch: { company_website: string | null; company_phone: string | null; payment_portal_url: string | null; timezone: string } }
  | { ok: false; error: string };

function parseUrl(raw: string): string | null {
  const trimmed = raw.trim();
  if (trimmed === "") return null;
  try {
    const u = new URL(trimmed);
    if (u.protocol !== "http:" && u.protocol !== "https:") return undefined as any; // signal invalid
    return u.href;
  } catch {
    return undefined as any; // signal invalid
  }
}

function isValidTimezone(tz: string): boolean {
  // First check our curated list (fast path)
  if (ALL_TIMEZONE_VALUES.has(tz)) return true;
  // Fall back to Intl for any IANA zone we didn't curate
  try {
    Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

export function parseCompanyProfileUpdate(form: FormData): ParseResult {
  const name = (form.get("name") as string ?? "").trim();
  if (name.length < 1 || name.length > 120) {
    return { ok: false, error: "name" };
  }

  const websiteRaw = (form.get("company_website") as string ?? "").trim();
  const website = websiteRaw === "" ? null : parseUrl(websiteRaw);
  if (websiteRaw !== "" && website === undefined) {
    return { ok: false, error: "website" };
  }

  const portalRaw = (form.get("payment_portal_url") as string ?? "").trim();
  const portal = portalRaw === "" ? null : parseUrl(portalRaw);
  if (portalRaw !== "" && portal === undefined) {
    return { ok: false, error: "portal" };
  }

  const phone = (form.get("company_phone") as string ?? "").trim() || null;

  const timezone = (form.get("timezone") as string ?? "").trim();
  if (!timezone || !isValidTimezone(timezone)) {
    return { ok: false, error: "timezone" };
  }

  return {
    ok: true,
    name,
    patch: {
      company_website: website as string | null,
      company_phone: phone,
      payment_portal_url: portal as string | null,
      timezone,
    },
  };
}
