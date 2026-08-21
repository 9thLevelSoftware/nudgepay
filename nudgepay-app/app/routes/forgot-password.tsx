import {
  Form,
  Link,
  useActionData,
  useNavigation,
  type ActionFunctionArgs,
} from "react-router";
import { getEnv } from "../lib/env.server";
import { createSupabaseUserClient } from "../lib/supabase.server";
import { requireSameOrigin } from "../lib/csrf.server";
import { PublicLayout } from "../components/PublicLayout";
import { Button, inputClass } from "../components/ui";
import { pageTitle } from "../lib/meta";
import type { Route } from "./+types/forgot-password";

export const meta: Route.MetaFunction = () => pageTitle("Forgot password");

const SUCCESS =
  "If that email is in our system, we sent a reset link. Check your inbox.";

function publicOrigin(request: Request, env: Record<string, string>): string {
  const configured = env.APP_PUBLIC_BASE_URL;
  if (configured) {
    try { return new URL(configured).origin; } catch { /* fall through */ }
  }
  return new URL(request.url).origin;
}

export async function action({ request, context }: ActionFunctionArgs) {
  requireSameOrigin(request);
  const env = getEnv(context as any);
  const form = await request.formData();
  const rawEmail = form.get("email");
  const email = typeof rawEmail === "string" ? rawEmail.trim() : "";
  const { supabase } = createSupabaseUserClient(request, env);
  const origin = publicOrigin(request, (context as { cloudflare: { env: Record<string, string> } }).cloudflare.env);
  if (email) {
    const redirectTo = `${origin}/auth/confirm?next=/reset-password`;
    await supabase.auth.resetPasswordForEmail(email, { redirectTo });
  }
  return { ok: true as const, message: SUCCESS };
}

export default function ForgotPassword() {
  const actionData = useActionData<typeof action>();
  const busy = useNavigation().state !== "idle";
  return (
    <PublicLayout title="Reset your password" width="card">
      {actionData?.ok ? (
        <p className="text-sm text-muted" role="status">{actionData.message}</p>
      ) : (
        <Form method="post" className="grid gap-4">
          <p className="text-sm text-muted">Enter the email on your account. We will send a reset link if it exists.</p>
          <label className="grid gap-1 text-sm font-medium text-text">
            Email
            <input name="email" type="email" required autoComplete="email" className={inputClass} />
          </label>
          <Button type="submit" disabled={busy}>{busy ? "Sending…" : "Send reset link"}</Button>
        </Form>
      )}
      <p className="mt-4 text-center text-sm text-muted">
        <Link to="/login" className="font-medium text-text underline">Back to log in</Link>
      </p>
    </PublicLayout>
  );
}
