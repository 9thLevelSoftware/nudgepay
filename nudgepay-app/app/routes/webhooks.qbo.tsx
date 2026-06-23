import type { ActionFunctionArgs } from "react-router";
import { getEnv, getQboEnv } from "../lib/env.server";
import { createSupabaseServiceClient } from "../lib/supabase.server";
import { verifyQboSignature, parseQboWebhook } from "../lib/qbo-webhook.server";
import { qboApiBaseUrl } from "../lib/qbo-api.server";
import {
  applyInvoiceWebhook, applyCustomerWebhook, applyPaymentWebhook, type SyncDeps,
} from "../lib/qbo-sync.server";

export async function action({ request, context }: ActionFunctionArgs) {
  const qbo = getQboEnv(context as any);
  const rawBody = await request.text();

  // Verify BEFORE touching the DB or QBO. Bad/absent signature => 401.
  const ok = await verifyQboSignature(
    rawBody, request.headers.get("intuit-signature"), qbo.QBO_WEBHOOK_VERIFIER_TOKEN,
  );
  if (!ok) return new Response("invalid signature", { status: 401 });

  const env = getEnv(context as any);
  const service = createSupabaseServiceClient(env);
  const deps: SyncDeps = {
    fetchFn: fetch,
    service,
    cfg: { clientId: qbo.QBO_CLIENT_ID, clientSecret: qbo.QBO_CLIENT_SECRET, redirectUri: qbo.QBO_REDIRECT_URI },
    api: { baseUrl: qboApiBaseUrl(qbo.QBO_SANDBOX) },
    key: qbo.QBO_ENCRYPTION_KEY,
  };

  try {
    for (const ev of parseQboWebhook(rawBody)) {
      const { data: conn } = await service.from("qbo_connections")
        .select("org_id").eq("realm_id", ev.realmId).eq("status", "connected").maybeSingle();
      if (!conn) continue; // unknown/disconnected realm — ignore
      const orgId = conn.org_id as string;
      if (ev.entityName === "Invoice") await applyInvoiceWebhook(deps, orgId, ev.id);
      else if (ev.entityName === "Customer") await applyCustomerWebhook(deps, orgId, ev.id);
      else if (ev.entityName === "Payment") await applyPaymentWebhook(deps, orgId, ev.id, "payment");
      else if (ev.entityName === "CreditMemo") await applyPaymentWebhook(deps, orgId, ev.id, "credit_memo");
      // other entity types are ignored
    }
  } catch (err) {
    console.error("QBO webhook processing failed", err);
    // Idempotent upserts make Intuit's retry safe.
    return new Response("processing error", { status: 500 });
  }
  return new Response("ok", { status: 200 });
}
