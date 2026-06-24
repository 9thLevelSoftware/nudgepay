import { redirect, type ActionFunctionArgs } from "react-router";
import { getEnv } from "../lib/env.server";
import { requireUser, resolveOrg } from "../lib/session.server";
import { safeReturnTo } from "../lib/return-to";

const LEVELS = ["critical", "high", "medium", "low"] as const;

export async function action({ request, context }: ActionFunctionArgs) {
  const env = getEnv(context as any);
  const { supabase, headers, user } = await requireUser(request, env);
  const org = await resolveOrg(supabase, user.id);
  if (!org) throw redirect("/onboarding", { headers });

  const form = await request.formData();
  const returnTo = safeReturnTo(form.get("returnTo"));
  const caseId = typeof form.get("caseId") === "string" ? (form.get("caseId") as string) : "";
  if (!caseId) return redirect(returnTo, { headers });

  // Cross-org guard: the RLS user client only sees own-org cases.
  const { data: cse } = await supabase
    .from("collection_cases").select("id").eq("id", caseId).maybeSingle();
  if (!cse) return redirect(returnTo, { headers });

  const levelRaw = form.get("level");
  const level = typeof levelRaw === "string" && (LEVELS as readonly string[]).includes(levelRaw)
    ? levelRaw : null; // anything else (incl. empty) = clear
  const reasonRaw = form.get("reason");
  const reason = level && typeof reasonRaw === "string" && reasonRaw.trim().length > 0
    ? reasonRaw.trim().slice(0, 280) : null;

  const { error } = await supabase.from("collection_cases").update({
    priority_override: level,
    priority_override_reason: reason,
    priority_override_by: level ? user.id : null,
    priority_override_at: level ? new Date().toISOString() : null,
  }).eq("id", caseId);
  // Don't swallow a failed write — a silent redirect would imply the override
  // saved when it didn't. Surface it to the error boundary.
  if (error) throw new Error(`Failed to update priority override: ${error.message}`);

  return redirect(returnTo, { headers });
}

export function loader() {
  return redirect("/dashboard");
}
