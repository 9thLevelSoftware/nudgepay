// CompanyProfileForm — editable org identity: name, website, phone, payment portal, timezone.
// Owner-only — members see a read-only summary.

import { Form, useNavigation, useSearchParams } from "react-router";
import { TIMEZONE_GROUPS, ALL_TIMEZONE_VALUES } from "../lib/timezones";
import type { CompanyProfile } from "../lib/org-profile";

// 12-hour labels for the digest-hour select (0-23 local hour values).
const DIGEST_HOUR_OPTIONS: { value: number; label: string }[] = Array.from({ length: 24 }, (_, h) => {
  const period = h < 12 ? "AM" : "PM";
  const twelve = h % 12 === 0 ? 12 : h % 12;
  return { value: h, label: `${twelve}:00 ${period}` };
});

export function CompanyProfileForm({
  orgName,
  profile,
  digestHourLocal,
  isOwner,
  returnTo,
}: {
  orgName: string;
  profile: CompanyProfile;
  digestHourLocal: number;
  isOwner: boolean;
  returnTo: string;
}) {
  const navigation = useNavigation();
  const busy =
    navigation.state !== "idle" &&
    navigation.formAction === "/api/org-settings" &&
    navigation.formData?.get("intent") === "save_company_profile";
  const [sp] = useSearchParams();
  const saved = sp.get("saved") === "profile";
  const errorCode = sp.get("error");

  if (!isOwner) {
    return (
      <section className="rounded-lg border border-border bg-surface p-5">
        <h2 className="font-display text-base font-semibold text-text">Company</h2>
        <dl className="mt-3 flex flex-col gap-1.5 text-sm">
          <div className="flex gap-2"><dt className="text-muted w-28">Name</dt><dd className="text-text">{orgName}</dd></div>
          {profile.website && <div className="flex gap-2"><dt className="text-muted w-28">Website</dt><dd className="text-text truncate">{profile.website}</dd></div>}
          {profile.phone && <div className="flex gap-2"><dt className="text-muted w-28">Phone</dt><dd className="text-text">{profile.phone}</dd></div>}
          {profile.paymentPortalUrl && <div className="flex gap-2"><dt className="text-muted w-28">Payment portal</dt><dd className="text-text truncate">{profile.paymentPortalUrl}</dd></div>}
          <div className="flex gap-2"><dt className="text-muted w-28">Timezone</dt><dd className="text-text">{profile.timezone}</dd></div>
          <div className="flex gap-2"><dt className="text-muted w-28">Digest sent at</dt><dd className="text-text">{DIGEST_HOUR_OPTIONS[digestHourLocal]?.label ?? "8:00 AM"}</dd></div>
        </dl>
        <p className="mt-2 text-xs text-muted">Only an owner can edit these settings.</p>
      </section>
    );
  }

  return (
    <section className="rounded-lg border border-border bg-surface p-5">
      <h2 className="font-display text-base font-semibold text-text">Company</h2>
      <p className="mt-1 text-xs text-muted">
        Your company identity — will be available in message templates as the <code className="rounded bg-panel px-1 py-0.5 font-mono text-[11px]">{"{company}"}</code> token,
        and for timezone-aware scheduling.
      </p>
      {errorCode === "save" && (
        <p className="mt-2 rounded-md border border-hot/30 bg-hot/10 px-3 py-2 text-xs text-hot" role="alert">
          Something went wrong saving your profile. Please try again.
        </p>
      )}
      <Form method="post" action="/api/org-settings" className="mt-3 flex flex-col gap-3">
        <input type="hidden" name="intent" value="save_company_profile" />
        <input type="hidden" name="returnTo" value={returnTo} />

        <label className="flex flex-col gap-1 text-sm font-medium text-text">
          Company name
          <input
            name="name" type="text" required maxLength={120} defaultValue={orgName}
            className="h-9 rounded-md border border-border bg-panel px-3 text-sm text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-copper"
          />
          {errorCode === "name" && <p className="text-xs text-hot" role="alert">Enter a company name (1–120 characters).</p>}
        </label>

        <label className="flex flex-col gap-1 text-sm font-medium text-text">
          Website
          <input
            name="company_website" type="url" defaultValue={profile.website ?? ""}
            placeholder="https://yourcompany.com"
            className="h-9 rounded-md border border-border bg-panel px-3 text-sm text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-copper"
          />
          {errorCode === "website" && <p className="text-xs text-hot" role="alert">Enter a valid URL (https://…) or leave blank.</p>}
        </label>

        <label className="flex flex-col gap-1 text-sm font-medium text-text">
          Company phone
          <input
            name="company_phone" type="tel" defaultValue={profile.phone ?? ""}
            placeholder="(555) 123-4567"
            className="h-9 rounded-md border border-border bg-panel px-3 text-sm text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-copper"
          />
          <span className="text-xs text-muted font-normal">Will be available in templates as the <code className="rounded bg-panel px-1 py-0.5 font-mono text-[11px]">{"{phone}"}</code> token. Not used for dialing.</span>
        </label>

        <label className="flex flex-col gap-1 text-sm font-medium text-text">
          Payment portal URL
          <input
            name="payment_portal_url" type="url" defaultValue={profile.paymentPortalUrl ?? ""}
            placeholder="https://pay.yourcompany.com"
            className="h-9 rounded-md border border-border bg-panel px-3 text-sm text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-copper"
          />
          <span className="text-xs text-muted font-normal">Will be available in templates as <code className="rounded bg-panel px-1 py-0.5 font-mono text-[11px]">{"{paymentLink}"}</code>. Leave blank if you don't have one.</span>
          {errorCode === "portal" && <p className="text-xs text-hot" role="alert">Enter a valid URL (https://…) or leave blank.</p>}
        </label>

        <label className="flex flex-col gap-1 text-sm font-medium text-text">
          Timezone
          <select
            name="timezone" defaultValue={profile.timezone}
            className="h-9 rounded-md border border-border bg-panel px-2 text-sm text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-copper"
          >
            {/* Fallback: if current value isn't in curated list, render it so the select doesn't silently default */}
            {!ALL_TIMEZONE_VALUES.has(profile.timezone) && (
              <option value={profile.timezone}>{profile.timezone}</option>
            )}
            {TIMEZONE_GROUPS.map((g) => (
              <optgroup key={g.region} label={g.region}>
                {g.zones.map((z) => (
                  <option key={z.value} value={z.value}>{z.label}</option>
                ))}
              </optgroup>
            ))}
          </select>
          {errorCode === "timezone" && <p className="text-xs text-hot" role="alert">Select a valid timezone.</p>}
          <span className="text-xs text-muted font-normal">Used for digest scheduling and quiet-hours enforcement.</span>
        </label>

        <label className="flex flex-col gap-1 text-sm font-medium text-text">
          Daily digest send time
          <select
            name="digest_hour_local" defaultValue={digestHourLocal}
            className="h-9 rounded-md border border-border bg-panel px-2 text-sm text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-copper"
          >
            {DIGEST_HOUR_OPTIONS.map((h) => (
              <option key={h.value} value={h.value}>{h.label}</option>
            ))}
          </select>
          {errorCode === "digest_hour" && <p className="text-xs text-hot" role="alert">Select a valid send time.</p>}
          <span className="text-xs text-muted font-normal">The follow-ups-due digest email sends at this local time each day.</span>
        </label>

        <div className="flex items-center gap-3">
          <button
            type="submit" disabled={busy}
            className="rounded-md bg-copper px-3 py-1.5 text-xs font-semibold text-ink hover:bg-copper/90 disabled:opacity-60 disabled:cursor-not-allowed"
          >
            {busy ? "Saving…" : "Save"}
          </button>
          {saved && <span className="text-xs text-cool" role="status">Company profile saved.</span>}
        </div>
      </Form>
    </section>
  );
}
