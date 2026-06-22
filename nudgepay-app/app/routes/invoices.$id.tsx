import { Form, useLoaderData, redirect, data, type LoaderFunctionArgs, type ActionFunctionArgs } from "react-router";
import { getEnv } from "../lib/env.server";
import { requireUser, resolveOrg } from "../lib/session.server";

type Message = {
  id: string;
  direction: string;
  body: string | null;
  status: string | null;
  created_at: string;
};

export async function loader({ request, context, params }: LoaderFunctionArgs) {
  const env = getEnv(context as any);
  const { supabase, headers, user } = await requireUser(request, env);
  const org = await resolveOrg(supabase, user.id);
  if (!org) throw redirect("/onboarding", { headers });
  const invoiceId = params.id as string;

  const { data: inv } = await supabase
    .from("invoices")
    .select("id, qbo_doc_number, balance, due_date, status, customer_id, customers(name, phone, sms_consent)")
    .eq("org_id", org.org_id).eq("id", invoiceId).maybeSingle();
  if (!inv) throw redirect("/dashboard", { headers });

  const { data: messages } = await supabase
    .from("text_messages")
    .select("id, direction, body, status, created_at")
    .eq("org_id", org.org_id).eq("invoice_id", invoiceId)
    .order("created_at", { ascending: true });

  const customer = (inv as any).customers as { name: string | null; phone: string | null; sms_consent: boolean } | null;
  const url = new URL(request.url);
  return data(
    {
      invoiceId,
      docNumber: (inv as any).qbo_doc_number as string | null,
      balance: (inv as any).balance as number | null,
      customerName: customer?.name ?? null,
      customerPhone: customer?.phone ?? null,
      consent: customer?.sms_consent ?? false,
      messages: (messages as unknown as Message[]) ?? [],
      sms: url.searchParams.get("sms"),
    },
    { headers },
  );
}

export async function action({ request, context, params }: ActionFunctionArgs) {
  const env = getEnv(context as any);
  const { supabase, headers, user } = await requireUser(request, env);
  const org = await resolveOrg(supabase, user.id);
  if (!org) return redirect("/onboarding", { headers });
  const invoiceId = params.id as string;

  // Consent toggle: a member attests the customer consented (or revokes it).
  const form = await request.formData();
  const consent = form.get("consent") === "true";
  const { data: inv } = await supabase
    .from("invoices").select("customer_id").eq("org_id", org.org_id).eq("id", invoiceId).maybeSingle();
  if (inv?.customer_id) {
    await supabase.from("customers").update({ sms_consent: consent }).eq("id", inv.customer_id as string);
  }
  return redirect(`/invoices/${invoiceId}`, { headers });
}

export default function InvoiceThread() {
  const { invoiceId, docNumber, balance, customerName, customerPhone, consent, messages, sms } =
    useLoaderData<typeof loader>();
  return (
    <main style={{ maxWidth: 640, margin: "48px auto", fontFamily: "sans-serif" }}>
      <p><a href="/dashboard">&larr; Dashboard</a></p>
      <h1>Invoice {docNumber ?? invoiceId}</h1>
      <p>{customerName ?? "(no customer)"} {customerPhone ? `· ${customerPhone}` : ""}
        {balance != null ? ` · Balance $${Number(balance).toFixed(2)}` : ""}</p>

      {sms === "sent" && <p>Text sent.</p>}
      {sms === "noconsent" && <p>Not sent — customer has not consented to SMS.</p>}
      {sms === "error" && <p>Could not send the text.</p>}

      <p>SMS consent: <strong>{consent ? "yes" : "no"}</strong>{" "}
        <Form method="post" style={{ display: "inline" }}>
          <input type="hidden" name="consent" value={consent ? "false" : "true"} />
          <button type="submit">{consent ? "Revoke consent" : "Mark consented"}</button>
        </Form>
      </p>

      <section style={{ border: "1px solid #ddd", borderRadius: 8, padding: 12, minHeight: 80 }}>
        {messages.length === 0 ? (
          <p>No messages yet.</p>
        ) : (
          messages.map((m) => (
            <div key={m.id} style={{ textAlign: m.direction === "outbound" ? "right" : "left", margin: "6px 0" }}>
              <span style={{
                display: "inline-block", padding: "6px 10px", borderRadius: 12,
                background: m.direction === "outbound" ? "#0b5cff" : "#eee",
                color: m.direction === "outbound" ? "#fff" : "#000",
              }}>{m.body}</span>
              <div style={{ fontSize: 11, color: "#888" }}>
                {m.direction}{m.status ? ` · ${m.status}` : ""}
              </div>
            </div>
          ))
        )}
      </section>

      <Form method="post" action="/api/text/send" style={{ marginTop: 12 }}>
        <input type="hidden" name="invoiceId" value={invoiceId} />
        <textarea name="body" rows={3} style={{ width: "100%" }} placeholder="Type a message…" required />
        <button type="submit" disabled={!consent}>Send text</button>
        {!consent && <span style={{ marginLeft: 8, color: "#888" }}>Mark consent to enable sending.</span>}
      </Form>
    </main>
  );
}
