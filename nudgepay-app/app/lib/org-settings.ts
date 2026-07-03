// Pure parsing/validation for the C7 collections-rules editor. No I/O, no .server.
// Mirrors parseCommPrefsUpdate: turn the submitted form into a validated
// org_settings patch, or a typed error. Validation rules mirror the DB CHECKs in
// migration 0016 (grace >= 0; working_days a non-empty subset of {0..6}; each
// cadence > 0).

export type OrgSettingsPatch = {
  promise_grace_days: number;
  working_days: number[];
  cadence_critical: number;
  cadence_high: number;
  cadence_medium: number;
  cadence_low: number;
};

export type ParseResult =
  | { ok: true; patch: OrgSettingsPatch }
  | { ok: false; error: string };

function intField(form: FormData, name: string): number | null {
  const raw = form.get(name);
  if (typeof raw !== "string" || raw.trim() === "") return null;
  const n = Number(raw);
  return Number.isInteger(n) ? n : null;
}

export function parseOrgSettingsUpdate(form: FormData): ParseResult {
  const grace = intField(form, "promise_grace_days");
  if (grace === null || grace < 0) return { ok: false, error: "grace" };

  const days = form.getAll("working_days")
    .filter((v): v is string => typeof v === "string")
    .map((v) => Number(v));
  if (days.length === 0 || days.some((d) => !Number.isInteger(d) || d < 0 || d > 6)) {
    return { ok: false, error: "working_days" };
  }
  const working_days = [...new Set(days)].sort((a, b) => a - b);

  const c = intField(form, "cadence_critical");
  const h = intField(form, "cadence_high");
  const m = intField(form, "cadence_medium");
  const l = intField(form, "cadence_low");
  if ([c, h, m, l].some((x) => x === null || (x as number) <= 0)) {
    return { ok: false, error: "cadence" };
  }

  return {
    ok: true,
    patch: {
      promise_grace_days: grace,
      working_days,
      cadence_critical: c as number,
      cadence_high: h as number,
      cadence_medium: m as number,
      cadence_low: l as number,
    },
  };
}

// ---------------------------------------------------------------------------
// Late-fee settings (C2 gap closure, display-only). Mirrors the pattern above.
// ---------------------------------------------------------------------------

export type LateFeePatch = {
  late_fee_enabled: boolean;
  late_fee_grace_days: number;
  late_fee_monthly_percent: number;
  late_fee_flat_amount: number;
};

export type LateFeeParseResult =
  | { ok: true; patch: LateFeePatch }
  | { ok: false; error: string };

export function parseLateFeeSettingsUpdate(form: FormData): LateFeeParseResult {
  const enabled = form.get("late_fee_enabled") === "true";
  const grace = intField(form, "late_fee_grace_days");
  if (grace === null || grace < 0) return { ok: false, error: "late_fee_grace" };

  const rawPercent = form.get("late_fee_monthly_percent");
  const percent = typeof rawPercent === "string" ? Number(rawPercent) : null;
  if (percent === null || Number.isNaN(percent) || percent < 0 || percent > 100) {
    return { ok: false, error: "late_fee_percent" };
  }

  const rawFlat = form.get("late_fee_flat_amount");
  const flat = typeof rawFlat === "string" ? Number(rawFlat) : null;
  if (flat === null || Number.isNaN(flat) || flat < 0) {
    return { ok: false, error: "late_fee_flat" };
  }

  return {
    ok: true,
    patch: {
      late_fee_enabled: enabled,
      late_fee_grace_days: grace,
      late_fee_monthly_percent: Math.round(percent * 100) / 100, // up to 2dp
      late_fee_flat_amount: Math.round(flat * 100) / 100,
    },
  };
}

// ---------------------------------------------------------------------------
// Priority thresholds (Phase 4): org-configurable high-value + level cutoffs.
// Mirrors the pattern above. Ordering mirrors the DB CHECK in migration 0027:
// critical > high > medium > 0; high_value_threshold > 0.
// ---------------------------------------------------------------------------

export type PriorityThresholdsPatch = {
  high_value_threshold: number;
  priority_critical_min: number;
  priority_high_min: number;
  priority_medium_min: number;
};

export type PriorityThresholdsParseResult =
  | { ok: true; patch: PriorityThresholdsPatch }
  | { ok: false; error: string };

export function parsePriorityThresholdsUpdate(form: FormData): PriorityThresholdsParseResult {
  const rawHighValue = form.get("high_value_threshold");
  const highValue = typeof rawHighValue === "string" ? Number(rawHighValue) : NaN;
  if (!Number.isFinite(highValue) || highValue <= 0) return { ok: false, error: "high_value_threshold" };

  const critical = intField(form, "priority_critical_min");
  const high = intField(form, "priority_high_min");
  const medium = intField(form, "priority_medium_min");
  if (critical === null || high === null || medium === null) {
    return { ok: false, error: "priority_thresholds" };
  }
  if (!(critical > high && high > medium && medium > 0)) {
    return { ok: false, error: "priority_thresholds_order" };
  }

  return {
    ok: true,
    patch: {
      high_value_threshold: Math.round(highValue * 100) / 100, // up to 2dp
      priority_critical_min: critical,
      priority_high_min: high,
      priority_medium_min: medium,
    },
  };
}

// Validates a single YYYY-MM-DD holiday date (for add/remove). Returns the
// normalized string, or null when malformed or not a real calendar day.
export function parseHolidayDate(value: FormDataEntryValue | null): string | null {
  if (typeof value !== "string") return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const d = new Date(value + "T00:00:00Z");
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10) === value ? value : null; // round-trip rejects 2026-02-31
}
