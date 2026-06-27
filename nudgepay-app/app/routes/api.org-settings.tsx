import { redirect, type ActionFunctionArgs } from "react-router";
import { getEnv } from "../lib/env.server";
import { requireUser, resolveOrg } from "../lib/session.server";
import { safeReturnTo } from "../lib/return-to";
import { parseOrgSettingsUpdate, parseHolidayDate } from "../lib/org-settings";

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
    if (date) {
      await supabase.from("org_holidays").delete()
        .eq("org_id", org.org_id).eq("holiday_date", date);
    }
    return redirect(flag(returnTo, "saved", "1"), { headers });
  }

  return redirect(returnTo, { headers });
}

export function loader() {
  return redirect("/settings");
}
