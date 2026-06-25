import { redirect, type ActionFunctionArgs } from "react-router";
import { getEnv } from "../lib/env.server";
import { requireUser, resolveOrg } from "../lib/session.server";
import { safeReturnTo } from "../lib/return-to";
import { clampBatch } from "../lib/bulk";

function parseIds(form: FormData): string[] {
  const raw = form.get("caseIds");
  if (typeof raw !== "string" || raw.length === 0) return [];
  return raw.split(",").map((s) => s.trim()).filter(Boolean);
}

function withParams(returnTo: string, params: Record<string, string>): string {
  const url = new URL(returnTo, "http://x");
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  return url.pathname + url.search;
}

export async function action({ request, context }: ActionFunctionArgs) {
  const env = getEnv(context as any);
  const { supabase, headers, user } = await requireUser(request, env);
  const org = await resolveOrg(supabase, user.id);
  if (!org) throw redirect("/onboarding", { headers });

  const form = await request.formData();
  const returnTo = safeReturnTo(form.get("returnTo"));
  const caseIds = clampBatch(parseIds(form));
  const ownerRaw = form.get("ownerId");
  const ownerId = typeof ownerRaw === "string" && ownerRaw.length > 0 ? ownerRaw : null;
  if (caseIds.length === 0) return redirect(returnTo, { headers });

  // Membership guard: never assign to a user outside the caller's org.
  if (ownerId) {
    const { data: member } = await supabase
      .from("memberships").select("user_id").eq("org_id", org.org_id).eq("user_id", ownerId).maybeSingle();
    if (!member) return redirect(returnTo, { headers });
  }

  // Map selected case ids -> customer ids, bound to the resolved org (RLS permits
  // every member org, so bind explicitly).
  const { data: caseRows, error: caseErr } = await supabase
    .from("collection_cases").select("customer_id").eq("org_id", org.org_id).in("id", caseIds);
  if (caseErr) throw new Error(`Failed to load cases: ${caseErr.message}`);
  const customerIds = [...new Set(((caseRows as { customer_id: string }[]) ?? []).map((r) => r.customer_id).filter(Boolean))];
  if (customerIds.length === 0) return redirect(returnTo, { headers });

  // One org-scoped bulk update. Throw on error — a silent redirect would imply
  // the assignment saved when it did not.
  const { error } = await supabase
    .from("customers").update({ owner: ownerId }).eq("org_id", org.org_id).in("id", customerIds);
  if (error) throw new Error(`Failed to assign owner: ${error.message}`);

  return redirect(withParams(returnTo, { bulkAssign: "done", count: String(customerIds.length) }), { headers });
}

export function loader() {
  return redirect("/dashboard");
}
