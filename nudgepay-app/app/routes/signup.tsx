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
import { signupOutcome } from "../lib/auth-flow.server";
import { safeReturnTo } from "../lib/return-to";

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
  if (error) return { error: error.message };

  const outcome = signupOutcome(Boolean(data.session), returnTo);
  if ("redirectTo" in outcome) return redirect(outcome.redirectTo, { headers });
  return { confirmEmail: true as const, returnTo: outcome.returnTo };
}

export default function Signup() {
  const actionData = useActionData<typeof action>();
  const [searchParams] = useSearchParams();
  const returnTo = searchParams.get("returnTo") ?? "";

  if (actionData && "confirmEmail" in actionData && actionData.confirmEmail) {
    const loginHref = actionData.returnTo
      ? `/login?returnTo=${encodeURIComponent(actionData.returnTo)}`
      : "/login";
    return (
      <main style={{ maxWidth: 360, margin: "64px auto" }}>
        <h1>Check your email</h1>
        <p>We sent a confirmation link to your inbox. Click it to finish creating
          your NudgePay account, then <Link to={loginHref}>sign in</Link>.</p>
      </main>
    );
  }

  const loginHref = returnTo
    ? `/login?returnTo=${encodeURIComponent(returnTo)}`
    : "/login";

  return (
    <Form method="post" style={{ maxWidth: 360, margin: "64px auto", display: "grid", gap: 12 }}>
      <h1>Create your NudgePay account</h1>
      {actionData && "error" in actionData && actionData.error && (
        <p className="text-hot">{actionData.error}</p>
      )}
      <input type="hidden" name="returnTo" value={returnTo} />
      <input name="email" type="email" placeholder="Email" required />
      <input name="password" type="password" placeholder="Password" required minLength={8} />
      <button type="submit">Sign up</button>
      <p style={{ textAlign: "center" }}>
        Already have an account? <Link to={loginHref}>Log in</Link>
      </p>
    </Form>
  );
}
