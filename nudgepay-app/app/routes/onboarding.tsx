import { Form, redirect, useActionData, type ActionFunctionArgs, type LoaderFunctionArgs } from "react-router";
import { getEnv } from "../lib/env.server";
import { createSupabaseServiceClient } from "../lib/supabase.server";
import { requireUser, resolveOrg } from "../lib/session.server";
import { createOrgForUser } from "../lib/orgs.server";

export async function loader({ request, context }: LoaderFunctionArgs) {
  const env = getEnv(context as any);
  const { supabase, headers, user } = await requireUser(request, env);
  const org = await resolveOrg(supabase, user.id);
  if (org) throw redirect("/dashboard", { headers });
  return new Response(null, { headers });
}

export async function action({ request, context }: ActionFunctionArgs) {
  const env = getEnv(context as any);
  const { headers, user } = await requireUser(request, env);
  const form = await request.formData();
  const raw = form.get("orgName");
  const name = typeof raw === "string" ? raw.trim() : "";
  if (!name) return { error: "Organization name is required" };
  const service = createSupabaseServiceClient(env);
  await createOrgForUser(service, user.id, name);
  return redirect("/dashboard", { headers });
}

export default function Onboarding() {
  const actionData = useActionData<typeof action>();
  return (
    <Form method="post" style={{ maxWidth: 360, margin: "64px auto", display: "grid", gap: 12 }}>
      <h1>Name your organization</h1>
      {actionData?.error && <p style={{ color: "#C0202A" }}>{actionData.error}</p>}
      <input name="orgName" placeholder="e.g. Chancey Heating & Cooling" required />
      <button type="submit">Create organization</button>
    </Form>
  );
}
