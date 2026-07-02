import {
  Form,
  redirect,
  useActionData,
  useNavigation,
  type ActionFunctionArgs,
  type LoaderFunctionArgs,
} from "react-router";
import { getEnv } from "../lib/env.server";
import { createSupabaseServiceClient } from "../lib/supabase.server";
import { requireUser, resolveOrg } from "../lib/session.server";
import { PublicLayout } from "../components/PublicLayout";
import { Button, inputClass } from "../components/ui";

export async function loader({ request, context }: LoaderFunctionArgs) {
  const env = getEnv(context as any);
  const { supabase, headers, user } = await requireUser(request, env);
  const org = await resolveOrg(supabase, user.id);
  if (!org) throw redirect("/onboarding", { headers });
  if (org.role !== "owner") throw redirect("/dashboard", { headers });
  return new Response(null, { headers });
}

export async function action({ request, context }: ActionFunctionArgs) {
  const env = getEnv(context as any);
  const { supabase, user } = await requireUser(request, env);
  const org = await resolveOrg(supabase, user.id);
  if (!org || org.role !== "owner") return { error: "Only owners can invite" };
  const form = await request.formData();
  const raw = form.get("email");
  const email = typeof raw === "string" ? raw.trim() : "";
  if (!email) return { error: "Email required" };
  const service = createSupabaseServiceClient(env);
  const { data, error } = await service.from("invites")
    .insert({ org_id: org.org_id, email }).select("token").single();
  if (error) return { error: error.message };
  return { ok: true, link: `/accept/${data!.token}` };
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
            Invite link: <code className="rounded bg-surface px-1.5 py-0.5 text-text">{actionData.link}</code>
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
