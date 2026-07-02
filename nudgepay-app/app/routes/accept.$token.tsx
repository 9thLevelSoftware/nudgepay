import {
  Form,
  data,
  redirect,
  useActionData,
  useLoaderData,
  useNavigation,
  type ActionFunctionArgs,
  type LoaderFunctionArgs,
} from "react-router";
import { getEnv } from "../lib/env.server";
import { createSupabaseServiceClient } from "../lib/supabase.server";
import { requireUser } from "../lib/session.server";
import { acceptInvite } from "../lib/orgs.server";
import { PublicLayout } from "../components/PublicLayout";
import { Button } from "../components/ui";

export async function loader({ request, params, context }: LoaderFunctionArgs) {
  const env = getEnv(context as any);
  const { headers, user } = await requireUser(request, env);
  const service = createSupabaseServiceClient(env);
  const { data: inv } = await service
    .from("invites")
    .select("org_id, email, accepted_at, organizations(name)")
    .eq("token", String(params.token))
    .maybeSingle();

  const org = (inv?.organizations ?? null) as { name: string } | { name: string }[] | null;
  const orgName = Array.isArray(org) ? org[0]?.name ?? null : org?.name ?? null;

  return data(
    {
      orgName,
      notFound: !inv,
      alreadyAccepted: Boolean(inv?.accepted_at),
      emailMismatch: Boolean(
        inv && inv.email.toLowerCase() !== (user.email ?? "").toLowerCase()
      ),
    },
    { headers }
  );
}

export async function action({ request, params, context }: ActionFunctionArgs) {
  const env = getEnv(context as any);
  const { headers, user } = await requireUser(request, env);
  const service = createSupabaseServiceClient(env);
  try {
    await acceptInvite(service, String(params.token), user.id, user.email ?? "");
  } catch (e) {
    return data({ error: (e as Error).message }, { headers });
  }
  return redirect("/dashboard", { headers });
}

export default function Accept() {
  const { orgName, notFound, alreadyAccepted, emailMismatch } =
    useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const busy = useNavigation().state !== "idle";

  if (notFound) {
    return (
      <PublicLayout width="card" title="Invite not found">
        <p className="text-sm text-muted">This invite link is invalid or has been removed.</p>
      </PublicLayout>
    );
  }
  if (alreadyAccepted) {
    return (
      <PublicLayout width="card" title="Invite already accepted">
        <p className="text-sm text-muted">This invite has already been used.</p>
      </PublicLayout>
    );
  }
  if (emailMismatch) {
    return (
      <PublicLayout width="card" title="Wrong account">
        <p className="text-sm text-muted">This invite was sent to a different email address. Sign in with the invited account to accept it.</p>
      </PublicLayout>
    );
  }

  return (
    <PublicLayout width="card" title={orgName ? `Join ${orgName}?` : "Join organization?"}>
      <Form method="post" className="grid gap-4">
        {actionData?.error && <p role="alert" className="text-sm text-hot">{actionData.error}</p>}
        <Button type="submit" disabled={busy}>{busy ? "Joining…" : "Accept invite"}</Button>
      </Form>
    </PublicLayout>
  );
}
