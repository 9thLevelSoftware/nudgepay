import { Form, useLoaderData, redirect, data, type LoaderFunctionArgs } from "react-router";
import { getEnv } from "../lib/env.server";
import { requireUser, resolveOrg } from "../lib/session.server";
import { getConnectionStatus } from "../lib/qbo-connection.server";
import { createSupabaseServiceClient } from "../lib/supabase.server";

type InvoiceRow = {
  id: string;
  qbo_doc_number: string | null;
  balance: number | null;
  due_date: string | null;
  status: string | null;
  customers: { name: string | null } | null;
};

export async function loader({ request, context }: LoaderFunctionArgs) {
  const env = getEnv(context as any);
  const { supabase, headers, user } = await requireUser(request, env);
  const org = await resolveOrg(supabase, user.id);
  if (!org) throw redirect("/onboarding", { headers });

  const { data: orgRow } = await supabase
    .from("organizations").select("name").eq("id", org.org_id).single();

  const service = createSupabaseServiceClient(env);
  const conn = await getConnectionStatus(service, org.org_id);
  const connected = conn?.status === "connected";

  let invoices: InvoiceRow[] = [];
  let lastSyncAt: string | null = null;
  if (connected) {
    const { data: connMeta } = await service.from("qbo_connections")
      .select("last_sync_at").eq("org_id", org.org_id).maybeSingle();
    lastSyncAt = (connMeta?.last_sync_at as string) ?? null;
    // RLS-scoped read via the USER client (membership-gated).
    // Filter to true past-due worklist: balance > 0 and due_date < today.
    const today = new Date().toISOString().slice(0, 10);
    const { data: inv } = await supabase
      .from("invoices")
      .select("id, qbo_doc_number, balance, due_date, status, customers(name)")
      .eq("org_id", org.org_id)
      .gt("balance", 0)
      .lt("due_date", today)
      .order("due_date", { ascending: true });
    invoices = (inv as unknown as InvoiceRow[]) ?? [];
  }

  const url = new URL(request.url);
  return data(
    {
      orgName: orgRow?.name ?? "(unknown)",
      email: user.email,
      role: org.role,
      qboConnected: connected,
      isOwner: org.role === "owner",
      notice: url.searchParams.get("qbo"),
      sync: url.searchParams.get("sync"),
      lastSyncAt,
      invoices,
    },
    { headers },
  );
}

export default function Dashboard() {
  const {
    orgName, email, role, qboConnected, isOwner, notice, sync, lastSyncAt, invoices,
  } = useLoaderData<typeof loader>();
  return (
    <main style={{ maxWidth: 860, margin: "48px auto", fontFamily: "sans-serif" }}>
      <h1>{orgName}</h1>
      <p>Signed in as {email} ({role}).</p>
      <Form method="post" action="/logout"><button type="submit">Log out</button></Form>

      {notice && <p>QuickBooks: {notice}</p>}
      {sync && <p>Sync: {sync === "ok" ? "completed" : "failed"}</p>}

      <section>
        <h2>QuickBooks</h2>
        {qboConnected ? (
          <>
            <p>Status: Connected{lastSyncAt ? ` — last sync ${new Date(lastSyncAt).toLocaleString()}` : ""}</p>
            <Form method="post" action="/api/qbo/refresh">
              <button type="submit">Refresh from QuickBooks</button>
            </Form>
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

      {qboConnected && (
        <section>
          <h2>Past-due invoices ({invoices.length})</h2>
          {invoices.length === 0 ? (
            <p>No invoices synced yet. Use "Refresh from QuickBooks".</p>
          ) : (
            <table style={{ borderCollapse: "collapse", width: "100%" }}>
              <thead>
                <tr>
                  <th style={{ textAlign: "left" }}>Invoice</th>
                  <th style={{ textAlign: "left" }}>Customer</th>
                  <th style={{ textAlign: "right" }}>Balance</th>
                  <th style={{ textAlign: "left" }}>Due</th>
                  <th style={{ textAlign: "left" }}>Status</th>
                </tr>
              </thead>
              <tbody>
                {invoices.map((inv) => (
                  <tr key={inv.id}>
                    <td><a href={`/invoices/${inv.id}`}>{inv.qbo_doc_number ?? inv.id}</a></td>
                    <td>{inv.customers?.name ?? "—"}</td>
                    <td style={{ textAlign: "right" }}>
                      {inv.balance != null ? `$${Number(inv.balance).toFixed(2)}` : "—"}
                    </td>
                    <td>{inv.due_date ?? "—"}</td>
                    <td>{inv.status ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      )}
    </main>
  );
}
