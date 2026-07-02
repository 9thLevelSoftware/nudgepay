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
import { signupOutcome, humanAuthError } from "../lib/auth-flow.server";
import { safeReturnTo } from "../lib/return-to";
import { PublicLayout } from "../components/PublicLayout";
import { Button, inputClass } from "../components/ui";

export async function action({ request, context }: ActionFunctionArgs) {
  const env = getEnv(context as any);
  const form = await request.formData();
  const rawEmail = form.get("email");
  const email = typeof rawEmail === "string" ? rawEmail.trim() : "";
  const rawPassword = form.get("password");
  const password = typeof rawPassword === "string" ? rawPassword : "";
  const returnTo = safeReturnTo(form.get("returnTo"), "");
  const { supabase, headers } = createSupabaseUserClient(request, env);
  const { data, error } = await supabase.auth.signUp({ email, password });
  if (error) return { error: humanAuthError(error.message) };

  const outcome = signupOutcome(Boolean(data.session), returnTo);
  if ("redirectTo" in outcome) return redirect(outcome.redirectTo, { headers });
  return { confirmEmail: true as const, returnTo: outcome.returnTo };
}

export default function Signup() {
  const actionData = useActionData<typeof action>();
  const busy = useNavigation().state !== "idle";
  const [searchParams] = useSearchParams();
  const returnTo = searchParams.get("returnTo") ?? "";

  if (actionData && "confirmEmail" in actionData && actionData.confirmEmail) {
    const loginHref = actionData.returnTo
      ? `/login?returnTo=${encodeURIComponent(actionData.returnTo)}`
      : "/login";
    return (
      <PublicLayout title="Check your email" width="card">
        <p className="text-sm text-muted">
          We sent a confirmation link to your inbox. Click it to finish creating
          your NudgePay account, then <Link to={loginHref} className="font-medium text-text underline">sign in</Link>.
        </p>
      </PublicLayout>
    );
  }

  const loginHref = returnTo
    ? `/login?returnTo=${encodeURIComponent(returnTo)}`
    : "/login";

  const error = actionData && "error" in actionData ? actionData.error : undefined;
  // Turn the "log in instead" suggestion into a real link, preserving returnTo.
  const [before, after] = error?.includes("log in instead")
    ? error.split("log in instead")
    : [error, undefined];

  return (
    <PublicLayout title="Create your NudgePay account" width="card">
      <Form method="post" className="grid gap-4">
        {error && (
          <p role="alert" className="text-sm text-hot">
            {after !== undefined ? (
              <>
                {before}
                <Link to={loginHref} className="underline">log in instead</Link>
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
          <input name="email" type="email" required autoComplete="email" className={inputClass} />
        </label>
        <label className="grid gap-1 text-sm font-medium text-text">
          Password
          <input name="password" type="password" required minLength={8} autoComplete="new-password" className={inputClass} />
        </label>
        <Button type="submit" disabled={busy}>{busy ? "Creating account…" : "Sign up"}</Button>
        <p className="text-center text-sm text-muted">
          Already have an account? <Link to={loginHref} className="font-medium text-text underline">Log in</Link>
        </p>
      </Form>
    </PublicLayout>
  );
}
