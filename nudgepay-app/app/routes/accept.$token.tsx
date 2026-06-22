import {
  Form,
  data,
  redirect,
  useActionData,
  useLoaderData,
  type ActionFunctionArgs,
  type LoaderFunctionArgs,
} from "react-router";
import { getEnv } from "../lib/env.server";
import { createSupabaseServiceClient } from "../lib/supabase.server";
import { requireUser } from "../lib/session.server";
import { acceptInvite } from "../lib/orgs.server";

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

  const wrapStyle = { maxWidth: 420, margin: "64px auto", display: "grid", gap: 12 } as const;

  if (notFound) {
    return (
      <div style={wrapStyle}>
        <h1>Invite not found</h1>
        <p>This invite link is invalid or has been removed.</p>
      </div>
    );
  }
  if (alreadyAccepted) {
    return (
      <div style={wrapStyle}>
        <h1>Invite already accepted</h1>
        <p>This invite has already been used.</p>
      </div>
    );
  }
  if (emailMismatch) {
    return (
      <div style={wrapStyle}>
        <h1>Wrong account</h1>
        <p>This invite was sent to a different email address. Sign in with the invited account to accept it.</p>
      </div>
    );
  }

  return (
    <Form method="post" style={wrapStyle}>
      <h1>Join {orgName}?</h1>
      {actionData?.error && <p style={{ color: "#C0202A" }}>{actionData.error}</p>}
      <button type="submit">Accept invite</button>
    </Form>
  );
}
