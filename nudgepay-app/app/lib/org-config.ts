// Pure resolution of per-org scheduling config (C7). No I/O, no .server suffix.
// The .server loader reads the rows; this module turns them into an OrgConfig,
// filling every missing piece from DEFAULT_ORG_CONFIG. Default values are owned
// by business-days.ts (grace, working days) and follow-up-cadence.ts (cadence) —
// this module composes them, so there is a single source of default truth.

import type { PriorityLevel } from "./priority";
import { CADENCE_DAYS } from "./follow-up-cadence";
import { GRACE_BUSINESS_DAYS, DEFAULT_WORKING_DAYS, NO_HOLIDAYS } from "./business-days";
import { DEFAULT_LATE_FEE_CONFIG, type LateFeeConfig } from "./late-fees";
import { resolveCompanyProfile, DEFAULT_COMPANY_PROFILE, type CompanyProfile } from "./org-profile";

export type OrgConfig = {
  promiseGraceDays: number;
  workingDays: ReadonlySet<number>;
  holidays: ReadonlySet<string>;
  cadenceDays: Readonly<Record<PriorityLevel, number>>;
  lateFee: LateFeeConfig;
  companyProfile: CompanyProfile;
};

// Nullable to match a SELECT against optional columns / an absent row.
export type OrgSettingsRow = {
  promise_grace_days: number | null;
  working_days: number[] | null;
  cadence_critical: number | null;
  cadence_high: number | null;
  cadence_medium: number | null;
  cadence_low: number | null;
  late_fee_enabled: boolean | null;
  late_fee_grace_days: number | null;
  late_fee_monthly_percent: number | null;
  late_fee_flat_amount: number | null;
  // Company profile (Phase 2)
  company_website: string | null;
  company_phone: string | null;
  payment_portal_url: string | null;
  timezone: string | null;
};

export const DEFAULT_ORG_CONFIG: OrgConfig = Object.freeze({
  promiseGraceDays: GRACE_BUSINESS_DAYS,
  workingDays: DEFAULT_WORKING_DAYS,
  holidays: NO_HOLIDAYS,
  cadenceDays: CADENCE_DAYS,
  lateFee: DEFAULT_LATE_FEE_CONFIG,
  companyProfile: DEFAULT_COMPANY_PROFILE,
});

export function resolveOrgConfig(
  settings: OrgSettingsRow | null,
  holidays: { holiday_date: string }[],
): OrgConfig {
  const holidaySet: ReadonlySet<string> = new Set(holidays.map((h) => h.holiday_date));
  if (!settings) {
    return { ...DEFAULT_ORG_CONFIG, holidays: holidaySet, companyProfile: DEFAULT_COMPANY_PROFILE };
  }
  const workingDays: ReadonlySet<number> =
    settings.working_days && settings.working_days.length > 0
      ? new Set(settings.working_days)
      : DEFAULT_WORKING_DAYS;
  return {
    promiseGraceDays: settings.promise_grace_days ?? GRACE_BUSINESS_DAYS,
    workingDays,
    holidays: holidaySet,
    cadenceDays: {
      Critical: settings.cadence_critical ?? CADENCE_DAYS.Critical,
      High: settings.cadence_high ?? CADENCE_DAYS.High,
      Medium: settings.cadence_medium ?? CADENCE_DAYS.Medium,
      Low: settings.cadence_low ?? CADENCE_DAYS.Low,
    },
    lateFee: {
      enabled: settings.late_fee_enabled ?? DEFAULT_LATE_FEE_CONFIG.enabled,
      graceDays: settings.late_fee_grace_days ?? DEFAULT_LATE_FEE_CONFIG.graceDays,
      monthlyPercent: Number(settings.late_fee_monthly_percent ?? DEFAULT_LATE_FEE_CONFIG.monthlyPercent),
      flatAmount: Number(settings.late_fee_flat_amount ?? DEFAULT_LATE_FEE_CONFIG.flatAmount),
    },
    companyProfile: resolveCompanyProfile(settings),
  };
}
