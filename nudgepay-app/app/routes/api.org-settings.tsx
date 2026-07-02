import { redirect, type ActionFunctionArgs } from "react-router";
import { getEnv } from "../lib/env.server";
import { requireUser, resolveOrg } from "../lib/session.server";
import { safeReturnTo } from "../lib/return-to";
import { parseOrgSettingsUpdate, parseHolidayDate, parseLateFeeSettingsUpdate } from "../lib/org-settings";
import { parseChannelSettingsUpdate } from "../lib/channel-settings";
import { parseEmailSettingsUpdate } from "../lib/email-settings";

function flag(returnTo: string, key: string, val: string): string {
  return `${returnTo}${returnTo.includes("?") ? "&" : "?"}${key}=${val}`;
}

export async function action({ request, context }: ActionFunctionArgs) {
  const env = getEnv(context as any);
  const { supabase, headers, user } = await requireUser(request, env);
  const org = await resolveOrg(supabase, user.id);
  if (!org) throw redirect("/onboarding", { headers });

  const form = await request.formData();
  const returnTo = safeReturnTo(form.get("returnTo"), "/settings");
  // Owner-only surface gate; RLS (is_org_owner) is the real boundary.
  if (org.role !== "owner") return redirect(returnTo, { headers });

  const intent = form.get("intent");

  if (intent === "save_channels") {
    const { sms_enabled } = parseChannelSettingsUpdate(form);
    // Upsert only org_id + sms_enabled; an existing row's sender / messaging_service_sid
    // are left untouched (upsert updates just the provided columns on conflict).
    const { error } = await supabase.from("messaging_config")
      .upsert({ org_id: org.org_id, sms_enabled }, { onConflict: "org_id" });
    if (error) return redirect(flag(returnTo, "error", "save"), { headers });
    return redirect(flag(returnTo, "saved", "1"), { headers });
  }

  if (intent === "save_rules") {
    const parsed = parseOrgSettingsUpdate(form);
    if (!parsed.ok) return redirect(flag(returnTo, "error", parsed.error), { headers });
    const { error } = await supabase.from("org_settings")
      .upsert({ org_id: org.org_id, ...parsed.patch }, { onConflict: "org_id" });
    if (error) return redirect(flag(returnTo, "error", "save"), { headers });
    return redirect(flag(returnTo, "saved", "1"), { headers });
  }

  if (intent === "add_holiday") {
    const date = parseHolidayDate(form.get("holiday_date"));
    if (!date) return redirect(flag(returnTo, "error", "holiday"), { headers });
    const { error } = await supabase.from("org_holidays")
      .upsert({ org_id: org.org_id, holiday_date: date }, { onConflict: "org_id,holiday_date" });
    if (error) return redirect(flag(returnTo, "error", "holiday"), { headers });
    return redirect(flag(returnTo, "saved", "1"), { headers });
  }

  if (intent === "remove_holiday") {
    const date = parseHolidayDate(form.get("holiday_date"));
    if (!date) return redirect(flag(returnTo, "error", "holiday"), { headers });
    const { error } = await supabase.from("org_holidays").delete()
      .eq("org_id", org.org_id).eq("holiday_date", date);
    if (error) return redirect(flag(returnTo, "error", "delete"), { headers });
    return redirect(flag(returnTo, "saved", "1"), { headers });
  }

  if (intent === "save_late_fees") {
    const parsed = parseLateFeeSettingsUpdate(form);
    if (!parsed.ok) return redirect(flag(returnTo, "error", parsed.error), { headers });
    const { error } = await supabase.from("org_settings")
      .upsert({ org_id: org.org_id, ...parsed.patch }, { onConflict: "org_id" });
    if (error) return redirect(flag(returnTo, "error", "save"), { headers });
    return redirect(flag(returnTo, "saved", "1"), { headers });
  }

  if (intent === "save_email") {
    const parsed = parseEmailSettingsUpdate(form);
    if (!parsed.ok) return redirect(flag(returnTo, "error", "email"), { headers });
    const { error } = await supabase.from("email_config")
      .upsert({ org_id: org.org_id, ...parsed.value }, { onConflict: "org_id" });
    if (error) return redirect(flag(returnTo, "error", "save"), { headers });
    // Distinct success marker so the email panel's "Saved." banner does not light
    // up after unrelated settings saves (save_channels/save_rules also use ?saved=1).
    return redirect(flag(returnTo, "email_saved", "1"), { headers });
  }

  return redirect(returnTo, { headers });
}

export function loader() {
  return redirect("/settings");
}
