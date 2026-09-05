import type { ActionFunctionArgs } from "react-router";
import { getEnv, getQboEnv, getEmailEnvOrNull, resendTransport } from "../lib/env.server";
import { createSupabaseServiceClient } from "../lib/supabase.server";
import { verifyQboSignature, parseQboWebhook } from "../lib/qbo-webhook.server";
import { qboApiBaseUrl } from "../lib/qbo-api.server";
import {
  applyInvoiceWebhook, applyCustomerWebhook, applyPaymentWebhook, type SyncDeps,
} from "../lib/qbo-sync.server";
import { recordSyncError, resolveSyncErrors } from "../lib/sync-errors.server";
import { sendBrokenPromiseAlerts } from "../lib/notifications.server";
import { requestIdFromContext, safeErrorDetails } from "../lib/log-redaction";

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
  const emailEnv = getEmailEnvOrNull(context as any);
  const notify = emailEnv
    ? (orgId: string, brokenDetails: any[], today: string) =>
        sendBrokenPromiseAlerts(
          { fetchFn: fetch, service, email: resendTransport(emailEnv), appUrl: emailEnv.APP_PUBLIC_BASE_URL ?? "" },
          orgId, brokenDetails, today,
        )
    : undefined;
  const deps: SyncDeps = {
    fetchFn: fetch,
    service,
    cfg: { clientId: qbo.QBO_CLIENT_ID, clientSecret: qbo.QBO_CLIENT_SECRET, redirectUri: qbo.QBO_REDIRECT_URI },
    api: { baseUrl: qboApiBaseUrl(qbo.QBO_SANDBOX) },
    key: qbo.QBO_ENCRYPTION_KEY,
    notify,
    errorSource: "webhook",
  };

  const waitUntil = (context as { cloudflare?: { ctx?: { waitUntil?: (p: Promise<unknown>) => void } } })
    .cloudflare?.ctx?.waitUntil;
  const requestId = requestIdFromContext(context);
  const work = applyQboWebhookEvents(deps, service, rawBody, requestId);
  if (typeof waitUntil === "function") {
    waitUntil(work.catch((err) => console.error({
      event: "qbo_webhook_background_apply_failed",
      requestId,
      ...safeErrorDetails(err),
    })));
    return new Response("ok", { status: 200 });
  }
  await work;
  return new Response("ok", { status: 200 });
}

async function applyQboWebhookEvents(
  deps: SyncDeps,
  service: ReturnType<typeof createSupabaseServiceClient>,
  rawBody: string,
  requestId?: string,
): Promise<void> {
  // Per-event isolation: a failed event records a durable sync_error and does not
  // abort sibling events. Upserts are idempotent so Intuit retries are safe.
  for (const ev of parseQboWebhook(rawBody)) {
    const { data: conn, error: connErr } = await service.from("qbo_connections")
      .select("org_id").eq("realm_id", ev.realmId).eq("status", "connected").maybeSingle();
    if (connErr) {
      console.error({
        event: "qbo_webhook_connection_lookup_failed",
        requestId,
        ...safeErrorDetails(connErr),
      });
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
      console.error({
        event: "qbo_webhook_event_failed",
        requestId,
        orgId,
        entityName: ev.entityName,
        ...safeErrorDetails(err),
      });
      await recordSyncError(service, {
        orgId, source: "webhook", scope,
        message: "Webhook event processing failed",
      }).catch(() => {});
    }
  }
}
