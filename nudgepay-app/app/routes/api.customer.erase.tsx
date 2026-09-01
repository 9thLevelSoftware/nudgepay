import { redirect, type ActionFunctionArgs } from "react-router";
import { getEnv } from "../lib/env.server";
import { requireUser, resolveOrg } from "../lib/session.server";
import { createSupabaseServiceClient } from "../lib/supabase.server";
import { customerErasureDecision } from "../lib/customer-erasure";
import { safeReturnTo } from "../lib/return-to";

function flag(returnTo: string, key: string, val: string): string {
  return `${returnTo}${returnTo.includes("?") ? "&" : "?"}${key}=${val}`;
}

export async function action({ request, context }: ActionFunctionArgs) {
  const env = getEnv(context as any);
  const { headers, user, supabase } = await requireUser(request, env);
  const org = await resolveOrg(supabase, user.id, request);
  if (!org) throw redirect("/onboarding", { headers });

  const form = await request.formData();
  const returnTo = safeReturnTo(form.get("returnTo"), "/accounts");
  const customerId = typeof form.get("customerId") === "string" ? form.get("customerId") as string : "";

  const service = createSupabaseServiceClient(env);
  const { data: cust } = await service
    .from("customers")
    .select("name, erased_at")
    .eq("org_id", org.org_id)
    .eq("id", customerId)
    .maybeSingle();
  const customerName = typeof cust?.name === "string" ? cust.name : "";
  const decision = customerErasureDecision({
    isOwner: org.role === "owner" || org.role === "admin",
    alreadyErased: cust?.erased_at != null,
    typedName: form.get("confirm"),
    customerName,
  });
  if (!decision.ok) {
    return redirect(flag(returnTo, "eraseError", decision.error), { headers });
  }

  const { error } = await service.rpc("erase_customer_pii", {
    p_org_id: org.org_id,
    p_customer_id: customerId,
    p_erased_by: user.id,
    p_customer_name: customerName,
  });
  if (error) {
    const already = /already erased/i.test(error.message ?? "");
    const forbidden = /not an owner/i.test(error.message ?? "");
    const confirm = /name mismatch/i.test(error.message ?? "");
    const code = already ? "already" : forbidden ? "forbidden" : confirm ? "confirm" : "erase";
    return redirect(flag(returnTo, "eraseError", code), { headers });
  }

  return redirect(returnTo, { headers });
}

export function loader() {
  return redirect("/accounts");
}
