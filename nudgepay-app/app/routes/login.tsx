import { Form, redirect, useActionData, type ActionFunctionArgs } from "react-router";
import { getEnv } from "../lib/env.server";
import { createSupabaseUserClient } from "../lib/supabase.server";
import { resolveOrg } from "../lib/session.server";

export async function action({ request, context }: ActionFunctionArgs) {
  const env = getEnv(context as any);
  const form = await request.formData();
  const email = String(form.get("email"));
  const password = String(form.get("password"));
  const { supabase, headers } = createSupabaseUserClient(request, env);
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error || !data.user) return { error: error?.message ?? "Login failed" };
  const org = await resolveOrg(supabase, data.user.id);
  return redirect(org ? "/dashboard" : "/onboarding", { headers });
}

export default function Login() {
  const actionData = useActionData<typeof action>();
  return (
    <Form method="post" style={{ maxWidth: 360, margin: "64px auto", display: "grid", gap: 12 }}>
      <h1>Log in to NudgePay</h1>
      {actionData?.error && <p style={{ color: "#C0202A" }}>{actionData.error}</p>}
      <input name="email" type="email" placeholder="Email" required />
      <input name="password" type="password" placeholder="Password" required />
      <button type="submit">Log in</button>
    </Form>
  );
}
