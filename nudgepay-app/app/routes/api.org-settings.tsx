import { redirect, type ActionFunctionArgs } from "react-router";
import { getEnv } from "../lib/env.server";
import { requireUser, resolveOrg } from "../lib/session.server";
import { safeReturnTo } from "../lib/return-to";
import { parseOrgSettingsUpdate, parseHolidayDate, parseHolidayLabel, parseLateFeeSettingsUpdate, parsePriorityThresholdsUpdate, parseWorkflowKnobsUpdate } from "../lib/org-settings";
import { parseChannelSettingsUpdate, parseSmsSenderUpdate, parseQuietHoursUpdate } from "../lib/channel-settings";
import { parseEmailSettingsUpdate } from "../lib/email-settings";
import { parseCompanyProfileUpdate } from "../lib/org-profile";
import { parseTemplateUpsert, parseTemplateDelete } from "../lib/message-templates";
import { DEFAULT_SMS_TEMPLATES } from "../lib/sms-templates";
import { DEFAULT_EMAIL_TEMPLATES } from "../lib/email-templates";

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

  if (intent === "save_company_profile") {
    const parsed = parseCompanyProfileUpdate(form);
    if (!parsed.ok) return redirect(flag(returnTo, "error", parsed.error), { headers });
    // Upsert profile columns first — more likely to fail due to constraints.
    // If this succeeds but the rename below fails, the user sees the old name
    // with updated settings: a benign partial state they can retry.
    const { error } = await supabase.from("org_settings")
      .upsert({ org_id: org.org_id, ...parsed.patch }, { onConflict: "org_id" });
    if (error) return redirect(flag(returnTo, "error", "save"), { headers });
    // Rename the org (user client → org_owner_update RLS is the real boundary)
    const { error: nameErr } = await supabase.from("organizations")
      .update({ name: parsed.name }).eq("id", org.org_id);
    if (nameErr) return redirect(flag(returnTo, "error", "save"), { headers });
    return redirect(flag(returnTo, "saved", "profile"), { headers });
  }

  if (intent === "save_channels") {
    const { sms_enabled } = parseChannelSettingsUpdate(form);
    // Upsert only org_id + sms_enabled; an existing row's sender / messaging_service_sid
    // are left untouched (upsert updates just the provided columns on conflict).
    const { error } = await supabase.from("messaging_config")
      .upsert({ org_id: org.org_id, sms_enabled }, { onConflict: "org_id" });
    if (error) return redirect(flag(returnTo, "error", "save"), { headers });
    return redirect(flag(returnTo, "saved", "1"), { headers });
  }

  if (intent === "save_sms_sender") {
    const parsed = parseSmsSenderUpdate(form);
    if (!parsed.ok) return redirect(flag(returnTo, "error", parsed.error), { headers });
    const { error } = await supabase.from("messaging_config")
      .upsert({ org_id: org.org_id, ...parsed.value }, { onConflict: "org_id" });
    if (error) return redirect(flag(returnTo, "error", "save"), { headers });
    return redirect(flag(returnTo, "sms_saved", "1"), { headers });
  }

  if (intent === "save_quiet_hours") {
    const parsed = parseQuietHoursUpdate(form);
    if (!parsed.ok) return redirect(flag(returnTo, "error", parsed.error), { headers });
    const { error } = await supabase.from("org_settings")
      .upsert({ org_id: org.org_id, ...parsed.patch }, { onConflict: "org_id" });
    if (error) return redirect(flag(returnTo, "error", "save"), { headers });
    return redirect(flag(returnTo, "saved", "quiet_hours"), { headers });
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
    const label = parseHolidayLabel(form.get("holiday_label"));
    const { error } = await supabase.from("org_holidays")
      .upsert({ org_id: org.org_id, holiday_date: date, label }, { onConflict: "org_id,holiday_date" });
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

  if (intent === "save_priority_thresholds") {
    const parsed = parsePriorityThresholdsUpdate(form);
    if (!parsed.ok) return redirect(flag(returnTo, "error", parsed.error), { headers });
    const { error } = await supabase.from("org_settings")
      .upsert({ org_id: org.org_id, ...parsed.patch }, { onConflict: "org_id" });
    if (error) return redirect(flag(returnTo, "error", "save"), { headers });
    return redirect(flag(returnTo, "saved", "1"), { headers });
  }

  if (intent === "save_workflow") {
    const parsed = parseWorkflowKnobsUpdate(form);
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

  if (intent === "save_template") {
    const parsed = parseTemplateUpsert(form);
    if (!parsed.ok) return redirect(flag(returnTo, "error", parsed.error), { headers });
    const { error } = await supabase.from("message_templates")
      .upsert(
        { org_id: org.org_id, ...parsed.value },
        { onConflict: "org_id,channel,slug" },
      );
    if (error) return redirect(flag(returnTo, "error", "save"), { headers });
    return redirect(flag(returnTo, "saved", "template"), { headers });
  }

  if (intent === "delete_template") {
    const parsed = parseTemplateDelete(form);
    if (!parsed.ok) return redirect(flag(returnTo, "error", parsed.error), { headers });
    const { error } = await supabase.from("message_templates")
      .delete()
      .eq("org_id", org.org_id)
      .eq("channel", parsed.value.channel)
      .eq("slug", parsed.value.slug);
    if (error) return redirect(flag(returnTo, "error", "delete"), { headers });
    return redirect(flag(returnTo, "saved", "template"), { headers });
  }

  if (intent === "reset_templates") {
    const channel = (form.get("channel") as string ?? "").trim();
    if (channel !== "sms" && channel !== "email") return redirect(flag(returnTo, "error", "channel"), { headers });
    // Delete existing
    await supabase.from("message_templates")
      .delete().eq("org_id", org.org_id).eq("channel", channel);
    // Re-insert defaults
    const defaults = channel === "sms" ? DEFAULT_SMS_TEMPLATES : DEFAULT_EMAIL_TEMPLATES;
    const rows = defaults.map((t, i) => ({
      org_id: org.org_id, channel, slug: t.id, label: t.label,
      subject: channel === "email" ? (t as any).subject : null,
      body: t.body, sort: i,
    }));
    const { error } = await supabase.from("message_templates").insert(rows);
    if (error) return redirect(flag(returnTo, "error", "save"), { headers });
    return redirect(flag(returnTo, "saved", "template"), { headers });
  }

  return redirect(returnTo, { headers });
}

export function loader() {
  return redirect("/settings");
}
