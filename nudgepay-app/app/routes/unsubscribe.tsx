import { useLoaderData, useActionData, Form, data, type LoaderFunctionArgs, type ActionFunctionArgs } from "react-router";
import { getEnv, getUnsubscribeEnv } from "../lib/env.server";
import { createSupabaseServiceClient } from "../lib/supabase.server";
import { verifyUnsubscribeToken } from "../lib/unsubscribe-token";

// RFC 8058: a GET only renders a confirmation page; the opt-out mutation happens
// solely on POST. This prevents email security scanners / link prefetchers (which
// issue GETs against links in delivered mail) from silently opting the recipient
// out. The token is HMAC-signed and org/customer-scoped, so it is unforgeable.
export async function loader({ request, context }: LoaderFunctionArgs) {
  const emailEnv = getUnsubscribeEnv(context as any);
  const token = new URL(request.url).searchParams.get("token") ?? "";
  const parsed = await verifyUnsubscribeToken(emailEnv.UNSUBSCRIBE_SECRET, token);
  return data({ valid: !!parsed, token, done: false });
}

export async function action({ request, context }: ActionFunctionArgs) {
  const emailEnv = getUnsubscribeEnv(context as any);
  const form = await request.formData();
  const token = typeof form.get("token") === "string" ? (form.get("token") as string) : "";
  const parsed = await verifyUnsubscribeToken(emailEnv.UNSUBSCRIBE_SECRET, token);
  if (!parsed) return data({ valid: false, token: "", done: false });

  const env = getEnv(context as any);
  const service = createSupabaseServiceClient(env);
  // Idempotent opt-out scoped to the token's org + customer.
  const { error } = await service.from("customers")
    .update({ do_not_email: true })
    .eq("org_id", parsed.orgId).eq("id", parsed.customerId);
  if (error) return data({ valid: true, token, done: false });
  return data({ valid: true, token, done: true });
}

export default function Unsubscribe() {
  const l = useLoaderData<typeof loader>();
  const a = useActionData<typeof action>();
  const valid = a ? a.valid : l.valid;
  const done = a?.done ?? false;
  const token = a?.token ?? l.token;

  return (
    <main className="min-h-screen flex items-center justify-center bg-surface p-6">
      <div className="max-w-md rounded-lg border border-border bg-panel p-6 text-center">
        {!valid ? (
          <>
            <h1 className="text-lg font-semibold text-text">Link invalid or expired</h1>
            <p className="mt-2 text-sm text-muted">We couldn't process this unsubscribe link. Please contact us directly to update your preferences.</p>
          </>
        ) : done ? (
          <>
            <h1 className="text-lg font-semibold text-text">You're unsubscribed</h1>
            <p className="mt-2 text-sm text-muted">You will no longer receive collection emails from us. If this was a mistake, contact us and we'll re-enable email.</p>
          </>
        ) : (
          <>
            <h1 className="text-lg font-semibold text-text">Unsubscribe from emails?</h1>
            <p className="mt-2 text-sm text-muted">Click below to stop receiving collection emails from us.</p>
            <Form method="post" className="mt-4">
              <input type="hidden" name="token" value={token} />
              <button type="submit" className="rounded-md bg-copper px-4 py-2 text-sm font-semibold text-ink hover:bg-copper/90">Confirm unsubscribe</button>
            </Form>
          </>
        )}
      </div>
    </main>
  );
}
