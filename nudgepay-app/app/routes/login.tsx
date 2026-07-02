import {
  Form,
  Link,
  redirect,
  useActionData,
  useSearchParams,
  type ActionFunctionArgs,
} from "react-router";
import { getEnv } from "../lib/env.server";
import { createSupabaseUserClient } from "../lib/supabase.server";
import { resolveOrg } from "../lib/session.server";
import { safeReturnTo } from "../lib/return-to";

export async function action({ request, context }: ActionFunctionArgs) {
  const env = getEnv(context as any);
  const form = await request.formData();
  const rawEmail = form.get("email");
  const email = typeof rawEmail === "string" ? rawEmail.trim() : "";
  const rawPassword = form.get("password");
  const password = typeof rawPassword === "string" ? rawPassword : "";
  const { supabase, headers } = createSupabaseUserClient(request, env);
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error || !data.user) return { error: error?.message ?? "Login failed" };

  // Honor returnTo BEFORE resolveOrg — an org-less invitee must land on
  // /accept/<token>, not /onboarding.
  const returnTo = safeReturnTo(form.get("returnTo"), "");
  if (returnTo) return redirect(returnTo, { headers });

  const org = await resolveOrg(supabase, data.user.id);
  return redirect(org ? "/dashboard" : "/onboarding", { headers });
}

export default function Login() {
  const actionData = useActionData<typeof action>();
  const [searchParams] = useSearchParams();
  const returnTo = searchParams.get("returnTo") ?? "";
  const signupHref = returnTo
    ? `/signup?returnTo=${encodeURIComponent(returnTo)}`
    : "/signup";

  return (
    <Form method="post" style={{ maxWidth: 360, margin: "64px auto", display: "grid", gap: 12 }}>
      <h1>Log in to NudgePay</h1>
      {actionData?.error && <p className="text-hot">{actionData.error}</p>}
      <input type="hidden" name="returnTo" value={returnTo} />
      <input name="email" type="email" placeholder="Email" required />
      <input name="password" type="password" placeholder="Password" required />
      <button type="submit">Log in</button>
      <p style={{ textAlign: "center" }}>
        Don&apos;t have an account? <Link to={signupHref}>Sign up</Link>
      </p>
    </Form>
  );
}
