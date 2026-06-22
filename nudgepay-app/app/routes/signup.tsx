import { Form, redirect, useActionData, type ActionFunctionArgs } from "react-router";
import { getEnv } from "../lib/env.server";
import { createSupabaseUserClient } from "../lib/supabase.server";

export async function action({ request, context }: ActionFunctionArgs) {
  const env = getEnv(context as any);
  const form = await request.formData();
  const rawEmail = form.get("email");
  const email = typeof rawEmail === "string" ? rawEmail.trim() : "";
  const rawPassword = form.get("password");
  const password = typeof rawPassword === "string" ? rawPassword : "";
  const { supabase, headers } = createSupabaseUserClient(request, env);
  const { error } = await supabase.auth.signUp({ email, password });
  if (error) return { error: error.message };
  return redirect("/onboarding", { headers });
}

export default function Signup() {
  const actionData = useActionData<typeof action>();
  return (
    <Form method="post" style={{ maxWidth: 360, margin: "64px auto", display: "grid", gap: 12 }}>
      <h1>Create your NudgePay account</h1>
      {actionData?.error && <p style={{ color: "#C0202A" }}>{actionData.error}</p>}
      <input name="email" type="email" placeholder="Email" required />
      <input name="password" type="password" placeholder="Password" required minLength={8} />
      <button type="submit">Sign up</button>
    </Form>
  );
}
