import { Form, useLoaderData, redirect, data, type LoaderFunctionArgs } from "react-router";
import { getEnv } from "../lib/env.server";
import { requireUser, resolveOrg } from "../lib/session.server";

export async function loader({ request, context }: LoaderFunctionArgs) {
  const env = getEnv(context as any);
  const { supabase, headers, user } = await requireUser(request, env);
  const org = await resolveOrg(supabase, user.id);
  if (!org) throw redirect("/onboarding", { headers });
  const { data: orgRow } = await supabase
    .from("organizations").select("name").eq("id", org.org_id).single();
  return data(
    { orgName: orgRow?.name ?? "(unknown)", email: user.email, role: org.role },
    { headers }
  );
}

export default function Dashboard() {
  const { orgName, email, role } = useLoaderData<typeof loader>();
  return (
    <main style={{ maxWidth: 720, margin: "48px auto", fontFamily: "sans-serif" }}>
      <h1>{orgName}</h1>
      <p>Signed in as {email} ({role}).</p>
      <p>Invoice list arrives in Phase 2 (QBO sync).</p>
      <Form method="post" action="/logout"><button type="submit">Log out</button></Form>
    </main>
  );
}
