import { redirect, type ActionFunctionArgs } from "react-router";
import { getEnv } from "../lib/env.server";
import { requireUser, resolveOrg } from "../lib/session.server";
import { safeReturnTo } from "../lib/return-to";

export async function action({ request, context }: ActionFunctionArgs) {
  const env = getEnv(context as any);
  const { supabase, headers, user } = await requireUser(request, env);
  const org = await resolveOrg(supabase, user.id);
  if (!org) throw redirect("/onboarding", { headers });

  const form = await request.formData();
  const returnTo = safeReturnTo(form.get("returnTo"));
  const customerId = typeof form.get("customerId") === "string" ? (form.get("customerId") as string) : "";
  const notesRaw = form.get("notes");
  const notes = typeof notesRaw === "string" ? notesRaw : "";
  if (!customerId) return redirect(returnTo, { headers });

  // Explicit org-scope guard: bind to the resolved dashboard org — RLS alone permits every org
  // the caller is a member of, so a multi-org user could otherwise touch another org's customer.
  const { data: cust } = await supabase
    .from("customers").select("id").eq("org_id", org.org_id).eq("id", customerId).maybeSingle();
  if (!cust) return redirect(returnTo, { headers });

  const { error } = await supabase.from("customers")
    .update({
      notes: notes.trim() === "" ? null : notes,
      notes_updated_at: new Date().toISOString(),
      notes_updated_by: user.id,
    })
    .eq("org_id", org.org_id).eq("id", customerId);
  // Don't swallow a failed write — a silent redirect would imply the notes
  // saved when they didn't. Surface it to the error boundary.
  if (error) throw new Error(`Failed to save notes: ${error.message}`);
  return redirect(returnTo, { headers });
}

export function loader() {
  return redirect("/accounts");
}
