import type { ActionFunctionArgs } from "react-router";
import { getEnv, getQboEnv } from "../lib/env.server";
import { createSupabaseServiceClient } from "../lib/supabase.server";
import { verifyQboSignature, parseQboWebhook } from "../lib/qbo-webhook.server";
import { qboApiBaseUrl } from "../lib/qbo-api.server";
import {
  applyInvoiceWebhook, applyCustomerWebhook, applyPaymentWebhook, type SyncDeps,
} from "../lib/qbo-sync.server";
import { recordSyncError, resolveSyncErrors } from "../lib/sync-errors.server";

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

  // Per-event isolation: a failed event records a durable sync_error and does not
  // abort sibling events. If any event failed we still return 500 so Intuit
  // re-delivers the batch (upserts are idempotent, so re-applied events are safe).
  let hadFailure = false;
  for (const ev of parseQboWebhook(rawBody)) {
    const { data: conn, error: connErr } = await service.from("qbo_connections")
      .select("org_id").eq("realm_id", ev.realmId).eq("status", "connected").maybeSingle();
    if (connErr) {
      // A DB error here is NOT "unknown realm" — failing open via `continue` could
      // let the batch return 200 and stop Intuit retrying, desyncing permanently.
      // We can't recordSyncError (no org), so force a retry instead. No orgId to scope.
      hadFailure = true;
      console.error("Failed to look up QBO connection for realm", ev.realmId, connErr);
      continue;
    }
    if (!conn) continue; // unknown/disconnected realm — ignore
    const orgId = conn.org_id as string;
    const scope = `${ev.entityName.toLowerCase()}:${ev.id}`;
    try {
      if (ev.entityName === "Invoice") await applyInvoiceWebhook(deps, orgId, ev.id);
      else if (ev.entityName === "Customer") await applyCustomerWebhook(deps, orgId, ev.id);
      else if (ev.entityName === "Payment") await applyPaymentWebhook(deps, orgId, ev.id, "payment");
      else if (ev.entityName === "CreditMemo") await applyPaymentWebhook(deps, orgId, ev.id, "credit_memo");
      else continue; // other entity types are ignored — no record, no resolve
      await resolveSyncErrors(service, { orgId, scope }); // this entity is now consistent
    } catch (err) {
      hadFailure = true;
      console.error("QBO webhook event failed", ev.entityName, ev.id, err);
      await recordSyncError(service, {
        orgId, source: "webhook", scope,
        message: err instanceof Error ? err.message : String(err),
      }).catch(() => {});
    }
  }
  if (hadFailure) return new Response("processing error", { status: 500 });
  return new Response("ok", { status: 200 });
}
