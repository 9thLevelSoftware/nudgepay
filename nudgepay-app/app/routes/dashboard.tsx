import { Form, useLoaderData, redirect, data, type LoaderFunctionArgs } from "react-router";
import { getEnv } from "../lib/env.server";
import { requireUser, resolveOrg } from "../lib/session.server";
import { getConnectionStatus } from "../lib/qbo-connection.server";
import { createSupabaseServiceClient } from "../lib/supabase.server";

export async function loader({ request, context }: LoaderFunctionArgs) {
  const env = getEnv(context as any);
  const { supabase, headers, user } = await requireUser(request, env);
  const org = await resolveOrg(supabase, user.id);
  if (!org) throw redirect("/onboarding", { headers });
  const { data: orgRow } = await supabase
    .from("organizations").select("name").eq("id", org.org_id).single();
  const service = createSupabaseServiceClient(env);
  const conn = await getConnectionStatus(service, org.org_id);
  const notice = new URL(request.url).searchParams.get("qbo");
  return data(
    {
      orgName: orgRow?.name ?? "(unknown)",
      email: user.email,
      role: org.role,
      qboConnected: conn?.status === "connected",
      isOwner: org.role === "owner",
      notice,
    },
    { headers }
  );
}

export default function Dashboard() {
  const { orgName, email, role, qboConnected, isOwner, notice } = useLoaderData<typeof loader>();
  return (
    <main style={{ maxWidth: 720, margin: "48px auto", fontFamily: "sans-serif" }}>
      <h1>{orgName}</h1>
      <p>Signed in as {email} ({role}).</p>
      <p>Invoice list arrives in Phase 2 (QBO sync).</p>
      <Form method="post" action="/logout"><button type="submit">Log out</button></Form>

      {notice && <p>QuickBooks: {notice}</p>}
      <section>
        <h2>QuickBooks</h2>
        {qboConnected ? (
          <>
            <p>Status: Connected</p>
            {isOwner && (
              <Form method="post" action="/api/qbo/disconnect">
                <button type="submit">Disconnect QuickBooks</button>
              </Form>
            )}
          </>
        ) : (
          <>
            <p>Status: Not connected</p>
            {isOwner ? (
              <Form method="post" action="/api/qbo/connect">
                <button type="submit">Connect QuickBooks</button>
              </Form>
            ) : (
              <p>Ask an owner to connect QuickBooks.</p>
            )}
          </>
        )}
      </section>
    </main>
  );
}
