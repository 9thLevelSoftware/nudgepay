import {
  Form,
  redirect,
  useActionData,
  useNavigation,
  type ActionFunctionArgs,
  type LoaderFunctionArgs,
} from "react-router";
import { getEnv } from "../lib/env.server";
import { requireUser } from "../lib/session.server";
import { PublicLayout } from "../components/PublicLayout";
import { Button, inputClass } from "../components/ui";
import { pageTitle } from "../lib/meta";
import type { Route } from "./+types/reset-password";

export const meta: Route.MetaFunction = () => pageTitle("Set new password");

export async function loader({ request, context }: LoaderFunctionArgs) {
  const env = getEnv(context as any);
  await requireUser(request, env);
  return null;
}

export async function action({ request, context }: ActionFunctionArgs) {
  const env = getEnv(context as any);
  const { supabase, headers } = await requireUser(request, env);
  const form = await request.formData();
  const password = typeof form.get("password") === "string" ? (form.get("password") as string) : "";
  const confirm = typeof form.get("confirm") === "string" ? (form.get("confirm") as string) : "";
  if (password.length < 8) return { error: "Use at least 8 characters." };
  if (password !== confirm) return { error: "Passwords do not match." };
  const { error } = await supabase.auth.updateUser({ password });
  if (error) return { error: "Could not update password. Try the reset link again." };
  return redirect("/dashboard", { headers });
}

export default function ResetPassword() {
  const actionData = useActionData<typeof action>();
  const busy = useNavigation().state !== "idle";
  return (
    <PublicLayout title="Choose a new password" width="card">
      <Form method="post" className="grid gap-4">
        {actionData && "error" in actionData && actionData.error ? (
          <p role="alert" className="text-sm text-hot">{actionData.error}</p>
        ) : null}
        <label className="grid gap-1 text-sm font-medium text-text">
          New password
          <input name="password" type="password" required minLength={8} autoComplete="new-password" className={inputClass} />
        </label>
        <label className="grid gap-1 text-sm font-medium text-text">
          Confirm password
          <input name="confirm" type="password" required minLength={8} autoComplete="new-password" className={inputClass} />
        </label>
        <Button type="submit" disabled={busy}>{busy ? "Saving…" : "Update password"}</Button>
      </Form>
    </PublicLayout>
  );
}
