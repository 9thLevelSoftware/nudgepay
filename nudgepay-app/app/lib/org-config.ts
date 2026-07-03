// Pure resolution of per-org scheduling config (C7). No I/O, no .server suffix.
// The .server loader reads the rows; this module turns them into an OrgConfig,
// filling every missing piece from DEFAULT_ORG_CONFIG. Default values are owned
// by business-days.ts (grace, working days) and follow-up-cadence.ts (cadence) —
// this module composes them, so there is a single source of default truth.

import type { PriorityLevel } from "./priority";
import { DEFAULT_PRIORITY_THRESHOLDS } from "./priority";
import { CADENCE_DAYS } from "./follow-up-cadence";
import { GRACE_BUSINESS_DAYS, DEFAULT_WORKING_DAYS, NO_HOLIDAYS } from "./business-days";
import { DEFAULT_LATE_FEE_CONFIG, type LateFeeConfig } from "./late-fees";
import { resolveCompanyProfile, DEFAULT_COMPANY_PROFILE, type CompanyProfile } from "./org-profile";
import { HIGH_VALUE_THRESHOLD } from "./worklist";
import { COMING_DUE_DAYS } from "./coming-due";
import { DUE_SOON_BUSINESS_DAYS } from "./promise-ledger";
import { MAX_BATCH } from "./bulk";
import { resolveQuietHours, DEFAULT_QUIET_HOURS, type QuietHours } from "./quiet-hours";

export type PriorityConfig = {
  highValue: number;
  criticalMin: number;
  highMin: number;
  mediumMin: number;
};

// Phase 5 workflow knobs: coming-due lookahead window, the promise due-soon
// business-day window, and the bulk-op batch-size cap. Grouped like the other
// sections (lateFee, companyProfile, priority) rather than flattened onto
// OrgConfig directly.
export type WorkflowConfig = {
  comingDueDays: number;
  dueSoonBusinessDays: number;
  smsBatchLimit: number;
};

export type OrgConfig = {
  promiseGraceDays: number;
  workingDays: ReadonlySet<number>;
  holidays: ReadonlySet<string>;
  cadenceDays: Readonly<Record<PriorityLevel, number>>;
  lateFee: LateFeeConfig;
  companyProfile: CompanyProfile;
  priority: PriorityConfig;
  workflow: WorkflowConfig;
  /** Org-local hour (0-23) the daily digest cron gate fires at (Phase 6). */
  digestHourLocal: number;
  /** Org-local SMS send window (Phase 7) — same-day [startHour, endHour). */
  quietHours: QuietHours;
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
  // Priority thresholds (Phase 4)
  high_value_threshold: number | null;
  priority_critical_min: number | null;
  priority_high_min: number | null;
  priority_medium_min: number | null;
  // Workflow knobs (Phase 5)
  coming_due_days: number | null;
  due_soon_business_days: number | null;
  sms_batch_limit: number | null;
  // Digest schedule (Phase 6)
  digest_hour_local: number | null;
  // Quiet hours / SMS send window (Phase 7)
  sms_send_start_hour: number | null;
  sms_send_end_hour: number | null;
};

export const DEFAULT_PRIORITY_CONFIG: PriorityConfig = Object.freeze({
  highValue: HIGH_VALUE_THRESHOLD,
  criticalMin: DEFAULT_PRIORITY_THRESHOLDS.criticalMin,
  highMin: DEFAULT_PRIORITY_THRESHOLDS.highMin,
  mediumMin: DEFAULT_PRIORITY_THRESHOLDS.mediumMin,
});

export const DEFAULT_WORKFLOW_CONFIG: WorkflowConfig = Object.freeze({
  comingDueDays: COMING_DUE_DAYS,
  dueSoonBusinessDays: DUE_SOON_BUSINESS_DAYS,
  smsBatchLimit: MAX_BATCH,
});

// Matches org_settings.digest_hour_local's column default (0029 migration).
export const DEFAULT_DIGEST_HOUR_LOCAL = 8;

export const DEFAULT_ORG_CONFIG: OrgConfig = Object.freeze({
  promiseGraceDays: GRACE_BUSINESS_DAYS,
  workingDays: DEFAULT_WORKING_DAYS,
  holidays: NO_HOLIDAYS,
  cadenceDays: CADENCE_DAYS,
  lateFee: DEFAULT_LATE_FEE_CONFIG,
  companyProfile: DEFAULT_COMPANY_PROFILE,
  priority: DEFAULT_PRIORITY_CONFIG,
  workflow: DEFAULT_WORKFLOW_CONFIG,
  digestHourLocal: DEFAULT_DIGEST_HOUR_LOCAL,
  quietHours: DEFAULT_QUIET_HOURS,
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
    priority: {
      highValue: Number(settings.high_value_threshold ?? DEFAULT_PRIORITY_CONFIG.highValue),
      criticalMin: settings.priority_critical_min ?? DEFAULT_PRIORITY_CONFIG.criticalMin,
      highMin: settings.priority_high_min ?? DEFAULT_PRIORITY_CONFIG.highMin,
      mediumMin: settings.priority_medium_min ?? DEFAULT_PRIORITY_CONFIG.mediumMin,
    },
    workflow: {
      comingDueDays: settings.coming_due_days ?? DEFAULT_WORKFLOW_CONFIG.comingDueDays,
      dueSoonBusinessDays: settings.due_soon_business_days ?? DEFAULT_WORKFLOW_CONFIG.dueSoonBusinessDays,
      smsBatchLimit: settings.sms_batch_limit ?? DEFAULT_WORKFLOW_CONFIG.smsBatchLimit,
    },
    digestHourLocal: settings.digest_hour_local ?? DEFAULT_DIGEST_HOUR_LOCAL,
    quietHours: resolveQuietHours(settings),
  };
}
