import { useLoaderData, data, type LoaderFunctionArgs } from "react-router";
import { getEnv, getEmailEnv } from "../lib/env.server";
import { createSupabaseServiceClient } from "../lib/supabase.server";
import { verifyUnsubscribeToken } from "../lib/unsubscribe-token";

export async function loader({ request, context }: LoaderFunctionArgs) {
  const emailEnv = getEmailEnv(context as any);
  const token = new URL(request.url).searchParams.get("token") ?? "";
  const parsed = await verifyUnsubscribeToken(emailEnv.UNSUBSCRIBE_SECRET, token);
  if (!parsed) return data({ ok: false });

  const env = getEnv(context as any);
  const service = createSupabaseServiceClient(env);
  // Idempotent opt-out scoped to the token's org + customer.
  const { error } = await service.from("customers")
    .update({ do_not_email: true })
    .eq("org_id", parsed.orgId).eq("id", parsed.customerId);
  if (error) return data({ ok: false });
  return data({ ok: true });
}

export default function Unsubscribe() {
  const d = useLoaderData<typeof loader>();
  return (
    <main className="min-h-screen flex items-center justify-center bg-surface p-6">
      <div className="max-w-md rounded-lg border border-border bg-panel p-6 text-center">
        {d.ok ? (
          <>
            <h1 className="text-lg font-semibold text-text">You're unsubscribed</h1>
            <p className="mt-2 text-sm text-muted">You will no longer receive collection emails from us. If this was a mistake, contact us and we'll re-enable email.</p>
          </>
        ) : (
          <>
            <h1 className="text-lg font-semibold text-text">Link invalid or expired</h1>
            <p className="mt-2 text-sm text-muted">We couldn't process this unsubscribe link. Please contact us directly to update your preferences.</p>
          </>
        )}
      </div>
    </main>
  );
}
