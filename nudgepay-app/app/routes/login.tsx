import {
  Form,
  Link,
  redirect,
  useActionData,
  useNavigation,
  useSearchParams,
  type ActionFunctionArgs,
} from "react-router";
import { getEnv } from "../lib/env.server";
import { createSupabaseUserClient } from "../lib/supabase.server";
import { resolveOrg } from "../lib/session.server";
import { safeReturnTo } from "../lib/return-to";
import { humanAuthError } from "../lib/auth-flow.server";
import { PublicLayout } from "../components/PublicLayout";
import { Button, inputClass } from "../components/ui";

export async function action({ request, context }: ActionFunctionArgs) {
  const env = getEnv(context as any);
  const form = await request.formData();
  const rawEmail = form.get("email");
  const email = typeof rawEmail === "string" ? rawEmail.trim() : "";
  const rawPassword = form.get("password");
  const password = typeof rawPassword === "string" ? rawPassword : "";
  const { supabase, headers } = createSupabaseUserClient(request, env);
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error || !data.user) {
    return { error: humanAuthError(error?.message ?? "Login failed") };
  }

  // Honor returnTo BEFORE resolveOrg — an org-less invitee must land on
  // /accept/<token>, not /onboarding.
  const returnTo = safeReturnTo(form.get("returnTo"), "");
  if (returnTo) return redirect(returnTo, { headers });

  const org = await resolveOrg(supabase, data.user.id);
  return redirect(org ? "/dashboard" : "/onboarding", { headers });
}

export default function Login() {
  const actionData = useActionData<typeof action>();
  const busy = useNavigation().state !== "idle";
  const [searchParams] = useSearchParams();
  const returnTo = searchParams.get("returnTo") ?? "";
  const signupHref = returnTo
    ? `/signup?returnTo=${encodeURIComponent(returnTo)}`
    : "/signup";

  const error = actionData?.error;
  // The generic "Invalid login credentials" copy nudges toward signup; turn
  // that mention into a real link when present, preserving returnTo.
  const [before, after] = error?.includes("create an account")
    ? error.split("create an account")
    : [error, undefined];

  return (
    <PublicLayout title="Log in to NudgePay" width="card">
      <Form method="post" className="grid gap-4">
        {error && (
          <p role="alert" className="text-sm text-hot">
            {after !== undefined ? (
              <>
                {before}
                <Link to={signupHref} className="underline">create an account</Link>
                {after}
              </>
            ) : (
              error
            )}
          </p>
        )}
        <input type="hidden" name="returnTo" value={returnTo} />
        <label className="grid gap-1 text-sm font-medium text-text">
          Email
          <input name="email" type="email" required className={inputClass} />
        </label>
        <label className="grid gap-1 text-sm font-medium text-text">
          Password
          <input name="password" type="password" required className={inputClass} />
        </label>
        <Button type="submit" disabled={busy}>{busy ? "Signing in…" : "Log in"}</Button>
        <p className="text-center text-sm text-muted">
          Don&apos;t have an account? <Link to={signupHref} className="font-medium text-text underline">Sign up</Link>
        </p>
      </Form>
    </PublicLayout>
  );
}
