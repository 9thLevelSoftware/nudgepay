import {
  Form,
  redirect,
  useActionData,
  useNavigation,
  type ActionFunctionArgs,
  type LoaderFunctionArgs,
} from "react-router";
import { getEnv, getEmailEnvOrNull, getPublicBaseUrls, resendTransport } from "../lib/env.server";
import { createSupabaseServiceClient } from "../lib/supabase.server";
import { requireUser, resolveOrg } from "../lib/session.server";
import { trySendInviteEmail } from "../lib/invite-email.server";
import { PublicLayout } from "../components/PublicLayout";
import { Button, inputClass } from "../components/ui";
import { pageTitle } from "../lib/meta";
import type { Route } from "./+types/invite";

export const meta: Route.MetaFunction = () => pageTitle("Invite a teammate");

export async function loader({ request, context }: LoaderFunctionArgs) {
  const env = getEnv(context as any);
  const { supabase, headers, user } = await requireUser(request, env);
  const org = await resolveOrg(supabase, user.id, request);
  if (!org) throw redirect("/onboarding", { headers });
  if (org.role !== "owner") throw redirect("/dashboard", { headers });
  return new Response(null, { headers });
}

export async function action({ request, context }: ActionFunctionArgs) {
  const env = getEnv(context as any);
  const { supabase, user } = await requireUser(request, env);
  const org = await resolveOrg(supabase, user.id, request);
  if (!org || org.role !== "owner") return { error: "Only owners can invite" };
  const form = await request.formData();
  const raw = form.get("email");
  const email = typeof raw === "string" ? raw.trim().toLowerCase() : "";
  if (!email) return { error: "Email required" };
  const service = createSupabaseServiceClient(env);
  const { data, error } = await service.from("invites")
    .insert({ org_id: org.org_id, email }).select("token").single();
  if (error) return { error: "Could not create that invite. Check the email and try again." };
  const base = getPublicBaseUrls(context as any).appBaseUrl ?? new URL(request.url).origin;
  const link = `${base.replace(/\/$/, "")}/accept/${data!.token}`;
  let sent = false;
  try {
    const { data: orgRow } = await service.from("organizations")
      .select("name").eq("id", org.org_id).maybeSingle();
    const emailEnv = getEmailEnvOrNull(context as any);
    const result = await trySendInviteEmail(
      {
        fetchFn: fetch,
        service,
        email: emailEnv ? resendTransport(emailEnv) : null,
      },
      {
        orgId: org.org_id,
        orgName: ((orgRow?.name as string) ?? "").trim() || "your workspace",
        to: email,
        acceptUrl: link,
      },
    );
    sent = result === "sent";
  } catch {
    // Invite row already exists — still return the copyable link.
  }
  return { ok: true, link, sent };
}

export default function Invite() {
  const actionData = useActionData<typeof action>();
  const busy = useNavigation().state !== "idle";
  return (
    <PublicLayout title="Invite a teammate" width="card">
      <Form method="post" className="grid gap-4">
        {actionData?.error && <p role="alert" className="text-sm text-hot">{actionData.error}</p>}
        {actionData?.ok && (
          <p className="text-sm text-muted">
            {actionData.sent ? "Invite email sent. Link: " : "Invite created. Copy this link: "}
            <code className="rounded bg-surface px-1.5 py-0.5 text-text">{actionData.link}</code>
          </p>
        )}
        <label className="grid gap-1 text-sm font-medium text-text">
          Email
          <input name="email" type="email" placeholder="teammate@company.com" required autoComplete="email" className={inputClass} />
        </label>
        <Button type="submit" disabled={busy}>{busy ? "Sending invite…" : "Send invite"}</Button>
      </Form>
    </PublicLayout>
  );
}
