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
import { createOrgForUser } from "../lib/orgs.server";
import { PublicLayout } from "../components/PublicLayout";
import { Button, inputClass } from "../components/ui";

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
  const busy = useNavigation().state !== "idle";
  return (
    <PublicLayout title="Name your organization" width="card">
      <Form method="post" className="grid gap-4">
        {actionData?.error && <p role="alert" className="text-sm text-hot">{actionData.error}</p>}
        <label className="grid gap-1 text-sm font-medium text-text">
          Organization name
          <input name="orgName" placeholder="e.g. Chancey Heating & Cooling" required className={inputClass} />
        </label>
        <Button type="submit" disabled={busy}>{busy ? "Creating organization…" : "Create organization"}</Button>
      </Form>
    </PublicLayout>
  );
}
