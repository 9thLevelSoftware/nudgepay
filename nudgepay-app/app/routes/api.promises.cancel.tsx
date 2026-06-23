import { redirect, type ActionFunctionArgs } from "react-router";
import { getEnv } from "../lib/env.server";
import { requireUser, resolveOrg } from "../lib/session.server";
import { safeReturnTo } from "../lib/return-to";
import { cancelPromise } from "../lib/promise-cancel.server";

function withError(returnTo: string, code: string): string {
  const sep = returnTo.includes("?") ? "&" : "?";
  return `${returnTo}${sep}promise=1&promiseError=${encodeURIComponent(code)}`;
}

export async function action({ request, context }: ActionFunctionArgs) {
  const env = getEnv(context as any);
  const { supabase, headers, user } = await requireUser(request, env);
  const org = await resolveOrg(supabase, user.id);
  if (!org) throw redirect("/onboarding", { headers });

  const form = await request.formData();
  const returnTo = safeReturnTo(form.get("returnTo"));
  const promiseId = form.get("promiseId");
  if (typeof promiseId !== "string" || promiseId === "") {
    return redirect(withError(returnTo, "missing-promise"), { headers });
  }

  const today = new Date().toISOString().slice(0, 10);
  const res = await cancelPromise(supabase, promiseId, today);
  if (!res.ok) return redirect(withError(returnTo, "cancel-failed"), { headers });
  return redirect(returnTo, { headers });
}
