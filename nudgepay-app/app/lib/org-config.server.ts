import type { SupabaseClient } from "@supabase/supabase-js";
import { resolveOrgConfig, type OrgConfig, type OrgSettingsRow } from "./org-config";

// Loads per-org scheduling config: one read of org_settings (optional row) plus
// the org's holiday rows. Absent rows resolve to DEFAULT_ORG_CONFIG. All reads go
// through the supplied client (user/RLS client in the loader; service in tests).
export async function loadOrgConfig(client: SupabaseClient, orgId: string): Promise<OrgConfig> {
  const [settingsRes, holidaysRes] = await Promise.all([
    client
      .from("org_settings")
      .select("promise_grace_days, working_days, cadence_critical, cadence_high, cadence_medium, cadence_low, late_fee_enabled, late_fee_grace_days, late_fee_monthly_percent, late_fee_flat_amount")
      .eq("org_id", orgId)
      .maybeSingle(),
    client.from("org_holidays").select("holiday_date").eq("org_id", orgId),
  ]);
  if (settingsRes.error) throw settingsRes.error;
  if (holidaysRes.error) throw holidaysRes.error;
  const settings = settingsRes.data as OrgSettingsRow | null;
  const holidays = (holidaysRes.data ?? []) as { holiday_date: string }[];
  return resolveOrgConfig(settings, holidays);
}
