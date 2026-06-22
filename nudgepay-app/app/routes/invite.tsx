import { Form, useActionData, type ActionFunctionArgs } from "react-router";
import { getEnv } from "../lib/env.server";
import { createSupabaseServiceClient } from "../lib/supabase.server";
import { requireUser, resolveOrg } from "../lib/session.server";

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
  return (
    <Form method="post" style={{ maxWidth: 420, margin: "64px auto", display: "grid", gap: 12 }}>
      <h1>Invite a teammate</h1>
      {actionData?.error && <p style={{ color: "#C0202A" }}>{actionData.error}</p>}
      {actionData?.ok && <p>Invite link: <code>{actionData.link}</code></p>}
      <input name="email" type="email" placeholder="teammate@company.com" required />
      <button type="submit">Send invite</button>
    </Form>
  );
}
